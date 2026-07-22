import mongoose, { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { DeliveryChallanModel, DISPATCHED_STATUSES } from '../models/DeliveryChallan.js';
import { WarehouseModel } from '../models/Warehouse.js';
import * as stockService from './stock.service.js';
import * as salesService from './sales.service.js';
import { createSalesDocumentService } from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * DELIVERY CHALLANS — goods out before the bill.
 *
 * The one thing to keep straight here is WHO OWNS THE STOCK MOVEMENT. A challan
 * deducts stock when it is dispatched, because that is when the goods leave.
 * The invoice raised against it afterwards therefore must NOT deduct again —
 * it carries `deliveredByChallanId` and sales.service.postInvoice skips its
 * stock step for exactly that reason.
 *
 * Get this wrong in either direction and the error is silent: deduct twice and
 * the warehouse quietly runs negative; deduct never and it shows goods that
 * are already on a lorry.
 */

export const challanService = createSalesDocumentService({
  model: DeliveryChallanModel,
  label: 'Delivery challan',
  numbering: { key: 'DeliveryChallan', prefix: 'DC' },
  // Editable only before the goods leave. After dispatch the stock movement
  // exists and the paperwork has to match it.
  editableStatuses: ['Draft'],
});

/**
 * Dispatches a challan: stock out, status Dispatched, in one transaction.
 *
 * `referenceType: 'DeliveryChallan'` rather than 'Sale' so the movement history
 * shows what actually happened. A dispatch is not a sale yet — nothing has been
 * billed — and reporting it as one would double-count against the invoice that
 * follows.
 */
export async function dispatchChallan(tenant: TenantContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid challan id');

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const challan = (await challanService.getRaw(tenant, id, session)) as any;

      if (challan.status !== 'Draft') {
        throw ApiError.badRequest(`This challan is already ${challan.status}`);
      }

      const needsDefault = challan.lineItems.some((line: any) => !line.warehouseId);
      let defaultWarehouseId: Types.ObjectId | null = null;
      if (needsDefault) {
        const fallback = await WarehouseModel.findOne(
          tenantFilter(tenant, { isDefault: true, isActive: true })
        )
          .session(session)
          .lean();
        if (!fallback) {
          throw ApiError.badRequest('No default warehouse is set for this company.');
        }
        defaultWarehouseId = fallback._id;
      }

      /**
       * Pin the resolved warehouse onto each line before dispatching.
       *
       * Not cosmetic: if the line kept a null `warehouseId`, cancelling the
       * challan later would have nothing to return the stock TO, and the
       * company default may have changed in the meantime. The line has to
       * record where the goods actually went out from.
       */
      for (const line of challan.lineItems) {
        if (!line.warehouseId) line.warehouseId = defaultWarehouseId!;
      }

      await stockService.recordMovements(
        tenant,
        challan.lineItems.map((line: any) => ({
          productId: line.productId,
          warehouseId: line.warehouseId,
          batchNumber: line.batchNumber,
          movementType: 'Out' as const,
          quantity: -line.quantity,
          referenceType: 'DeliveryChallan' as const,
          referenceId: challan._id,
          reason: `Dispatch on challan ${challan.documentNumber}`,
          timestamp: challan.date,
        })),
        { session }
      );

      challan.status = 'Dispatched';
      challan.dispatchedAt = new Date();
      await challan.save({ session });

      result = challan.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Raises the invoice for a dispatched challan.
 *
 * The invoice posts the LEDGER only — the goods already left, so its stock step
 * is skipped via `deliveredByChallanId`. This is the pairing the whole challan
 * design rests on; see the header.
 */
export async function invoiceChallan(
  tenant: TenantContext,
  id: string,
  options: { dueDate?: Date } = {}
) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid challan id');

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const challan = (await challanService.getRaw(tenant, id, session)) as any;

      if (!DISPATCHED_STATUSES.includes(challan.status)) {
        throw ApiError.badRequest(
          `Only a dispatched challan can be invoiced — this one is ${challan.status}`
        );
      }
      if (challan.invoiceId) {
        throw ApiError.badRequest('This challan has already been invoiced', {
          invoiceId: String(challan.invoiceId),
        });
      }

      const invoice = await salesService.createInvoiceInSession(
        tenant,
        {
          customerId: String(challan.customerId),
          lineItems: challan.lineItems.map((line: any) => ({
            productId: String(line.productId),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            gstPercent: line.gstPercent,
            warehouseId: line.warehouseId ? String(line.warehouseId) : null,
            batchNumber: line.batchNumber,
          })),
          notes: challan.notes,
          termsAndConditions: challan.termsAndConditions,
          sourceDocumentId: challan._id,
          sourceDocumentModel: 'DeliveryChallan',
          // THE important field: tells postInvoice the stock is already gone.
          deliveredByChallanId: challan._id,
          ...(options.dueDate ? { dueDate: options.dueDate } : {}),
          confirm: true,
        } as never,
        session
      );

      challan.status = 'Invoiced';
      challan.invoiceId = invoice._id;
      await challan.save({ session });

      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Cancels a challan, returning the stock if it had been dispatched.
 *
 * Refused once invoiced: at that point the bill is the live document and
 * cancelling it is the invoice's job, not the challan's.
 */
export async function cancelChallan(tenant: TenantContext, id: string, reason?: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid challan id');

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const challan = (await challanService.getRaw(tenant, id, session)) as any;

      if (challan.status === 'Invoiced') {
        throw ApiError.badRequest(
          'This challan has been invoiced. Cancel the invoice instead.'
        );
      }
      if (challan.status === 'Cancelled') {
        throw ApiError.badRequest('This challan is already cancelled');
      }

      if (challan.status === 'Dispatched') {
        await stockService.recordMovements(
          tenant,
          challan.lineItems.map((line: any) => ({
            productId: line.productId,
            warehouseId: line.warehouseId,
            batchNumber: line.batchNumber,
            movementType: 'In' as const,
            quantity: line.quantity,
            referenceType: 'DeliveryChallan' as const,
            referenceId: challan._id,
            reason: `Cancelled challan ${challan.documentNumber}`,
          })),
          { session }
        );
      }

      challan.status = 'Cancelled';
      if (reason) {
        challan.notes = [challan.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n');
      }
      await challan.save({ session });
      result = challan.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}
