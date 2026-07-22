import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { SalesInvoiceModel, type InvoiceStatus } from '../models/SalesInvoice.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();

/**
 * POST /api/payments/edc-callback
 *
 * Called by a physical card terminal SDK when a card payment is confirmed.
 * The terminal vendor posts { invoiceId, amount, transactionRef, terminalId }.
 *
 * In production, validate the x-edc-signature HMAC-SHA256 header using a
 * pre-shared secret configured in the company's hardware settings.
 */
router.post(
  '/edc-callback',
  asyncHandler(async (req, res) => {
    const { invoiceId, amount, transactionRef, terminalId } = req.body;

    if (!invoiceId || !amount || !transactionRef) {
      throw ApiError.badRequest('invoiceId, amount, and transactionRef are required');
    }

    const invoice = await SalesInvoiceModel.findById(invoiceId);
    if (!invoice) throw ApiError.notFound('Invoice not found');

    // Verify the amount matches (allow ±1 paisa tolerance for rounding)
    const diff = Math.abs(Number((invoice as any).grandTotal) - Number(amount));
    if (diff > 0.02) {
      throw ApiError.badRequest(
        `Amount mismatch: invoice total is ${(invoice as any).grandTotal}, terminal reports ${amount}`
      );
    }

    if ((invoice as any).status === 'Paid') {
      // Idempotent: already paid — return success without double-posting
      res.json({ success: true, message: 'Already paid', invoiceId });
      return;
    }

    // Mark invoice as paid via EDC terminal
    (invoice as any).status = 'Paid' as InvoiceStatus;
    await invoice.save();

    res.json({
      success: true,
      message: 'Invoice marked as Paid via EDC terminal',
      invoiceId: String(invoice._id),
      documentNumber: (invoice as any).documentNumber,
      grandTotal: (invoice as any).grandTotal,
      transactionRef,
      terminalId: terminalId ?? null,
    });
  })
);

export default router;
