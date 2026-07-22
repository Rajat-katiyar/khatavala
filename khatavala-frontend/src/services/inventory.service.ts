import { api } from './api';
import type {
  ApiResponse,
  CurrentStock,
  MovementHistory,
  MovementType,
  StockMovement,
  Warehouse,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

/* ---------------------------- Warehouses --------------------------- */

export async function listWarehouses(includeInactive = false): Promise<Warehouse[]> {
  const { data } = await api.get<ApiResponse<{ warehouses: Warehouse[] }>>('/warehouses', {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return data.data!.warehouses;
}

export async function createWarehouse(input: {
  name: string;
  address?: Warehouse['address'];
  isDefault?: boolean;
}): Promise<Warehouse> {
  const { data } = await api.post<ApiResponse<{ warehouse: Warehouse }>>(
    '/warehouses',
    input
  );
  return data.data!.warehouse;
}

/* ------------------------------ Stock ------------------------------ */

export interface CurrentStockParams {
  productId?: string;
  warehouseId?: string;
  search?: string;
  lowOnly?: boolean;
  includeZero?: boolean;
  page?: number;
  limit?: number;
}

export async function getCurrentStock(
  params: CurrentStockParams = {}
): Promise<CurrentStock> {
  const { data } = await api.get<ApiResponse<CurrentStock>>('/inventory/stock', { params });
  return data.data!;
}

export interface MovementHistoryParams {
  productId?: string;
  warehouseId?: string;
  movementType?: MovementType;
  /** ISO date strings — the API coerces them. */
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function getMovementHistory(
  params: MovementHistoryParams = {}
): Promise<MovementHistory> {
  const { data } = await api.get<ApiResponse<MovementHistory>>('/inventory/movements', {
    params,
  });
  return data.data!;
}

/* ---------------------------- Movements ---------------------------- */

export interface OpeningStockInput {
  productId: string;
  warehouseId: string;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string;
}

export async function recordOpeningStock(
  input: OpeningStockInput
): Promise<StockMovement> {
  const { data } = await api.post<ApiResponse<{ entry: StockMovement }>>(
    '/inventory/opening',
    input
  );
  return data.data!.entry;
}

export interface TransferInput {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  /** Always positive — the API owns the direction of each leg. */
  quantity: number;
  batchNumber?: string;
  reason?: string;
}

export async function transferStock(input: TransferInput) {
  const { data } = await api.post<
    ApiResponse<{ referenceId: string; out: StockMovement; in: StockMovement }>
  >('/inventory/transfer', input);
  return data.data!;
}

export interface AdjustmentInput {
  productId: string;
  warehouseId: string;
  /** SIGNED: positive writes stock on, negative writes it off. */
  quantity: number;
  reason: string;
  batchNumber?: string;
}

export async function adjustStock(input: AdjustmentInput): Promise<StockMovement> {
  const { data } = await api.post<ApiResponse<{ entry: StockMovement }>>(
    '/inventory/adjustment',
    input
  );
  return data.data!.entry;
}

export interface DamageInput extends Omit<AdjustmentInput, 'quantity'> {
  /** A positive magnitude — damage is always a write-off. */
  quantity: number;
}

export async function recordDamage(input: DamageInput): Promise<StockMovement> {
  const { data } = await api.post<ApiResponse<{ entry: StockMovement }>>(
    '/inventory/damage',
    input
  );
  return data.data!.entry;
}
