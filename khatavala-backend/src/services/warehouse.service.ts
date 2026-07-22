import mongoose, { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { WarehouseModel } from '../models/Warehouse.js';
import { StockBalanceModel } from '../models/StockBalance.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

export interface WarehouseInput {
  name: string;
  address?: Record<string, string | undefined>;
  isDefault?: boolean;
  isActive?: boolean;
}

export async function listWarehouses(tenant: TenantContext, includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  return WarehouseModel.find(tenantFilter(tenant, filter))
    .sort({ isDefault: -1, name: 1 })
    .lean();
}

export async function getWarehouse(tenant: TenantContext, id: string) {
  const warehouse = await WarehouseModel.findOne(tenantById(tenant, id)).lean();
  if (!warehouse) throw ApiError.notFound('Warehouse not found');
  return warehouse;
}

/**
 * The first warehouse a company creates becomes its default whether or not the
 * caller asked — otherwise a company can hold stock with no default, and every
 * module that needs "the obvious warehouse" has to handle a null.
 */
export async function createWarehouse(tenant: TenantContext, input: WarehouseInput) {
  const isFirst = (await WarehouseModel.countDocuments(tenantFilter(tenant, {}))) === 0;
  const isDefault = input.isDefault || isFirst;

  return withDefaultConsistency(tenant, isDefault, null, async (session) => {
    const [warehouse] = await WarehouseModel.create(
      [tenantStamp(tenant, { ...input, isDefault })],
      { session }
    );
    return warehouse.toObject();
  });
}

export async function updateWarehouse(
  tenant: TenantContext,
  id: string,
  input: Partial<WarehouseInput>
) {
  const existing = await getWarehouse(tenant, id);

  // Demoting the only default would leave the company without one. Promote a
  // different warehouse instead of clearing this flag.
  if (existing.isDefault && input.isDefault === false) {
    throw ApiError.badRequest(
      'A company must have a default warehouse. Make another one the default instead.'
    );
  }

  return withDefaultConsistency(tenant, input.isDefault === true, id, async (session) => {
    const warehouse = await WarehouseModel.findOneAndUpdate(
      tenantById(tenant, id),
      { $set: input },
      { new: true, session }
    ).lean();
    if (!warehouse) throw ApiError.notFound('Warehouse not found');
    return warehouse;
  });
}

/**
 * Clearing the previous default and setting the new one must be one operation:
 * the unique partial index on `{ companyId, isDefault: true }` rejects the
 * moment two rows claim it, so doing this in two statements fails roughly half
 * the time depending on the order. In a transaction the intermediate state is
 * never visible to the index check at commit.
 */
async function withDefaultConsistency<T>(
  tenant: TenantContext,
  becomingDefault: boolean,
  exceptId: string | null,
  work: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      if (becomingDefault) {
        await WarehouseModel.updateMany(
          tenantFilter(tenant, {
            isDefault: true,
            ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
          }),
          { $set: { isDefault: false } },
          { session }
        );
      }
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Warehouses that have ever held stock are deactivated, not deleted — their id
 * appears on every historic movement, and a ledger row pointing at a row that
 * no longer exists is an audit trail with a hole in it. Same rule the customer
 * master follows.
 */
export async function deleteWarehouse(tenant: TenantContext, id: string) {
  const warehouse = await getWarehouse(tenant, id);

  if (warehouse.isDefault) {
    throw ApiError.badRequest(
      'Cannot remove the default warehouse. Make another one the default first.'
    );
  }

  const holdsStock = await StockBalanceModel.exists(
    tenantFilter(tenant, {
      warehouseId: new Types.ObjectId(id),
      quantity: { $ne: 0 },
    })
  );
  if (holdsStock) {
    throw ApiError.badRequest(
      'This warehouse still holds stock. Transfer it out before removing the warehouse.'
    );
  }

  const hasHistory = await StockBalanceModel.exists(
    tenantFilter(tenant, { warehouseId: new Types.ObjectId(id) })
  );

  if (hasHistory) {
    await WarehouseModel.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return { deleted: false, deactivated: true };
  }

  await WarehouseModel.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false };
}
