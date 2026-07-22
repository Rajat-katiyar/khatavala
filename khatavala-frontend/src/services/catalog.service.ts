import { api } from './api';
import type { ApiResponse, Brand, Category, Unit } from '@/types';

/**
 * Categories, brands and units share one API shape, so this is one set of
 * functions parameterised by path rather than three copies.
 */

export type MasterKind = 'categories' | 'brands' | 'units';

export interface DeleteMasterResult {
  deleted: boolean;
  deactivated: boolean;
  productCount: number;
  childCount: number;
}

async function listMasters<T>(kind: MasterKind, withUsage = false): Promise<T[]> {
  const { data } = await api.get<ApiResponse<{ items: T[] }>>(`/${kind}`, {
    params: withUsage ? { withUsage: true } : undefined,
  });
  return data.data!.items;
}

async function createMaster<T>(kind: MasterKind, input: Record<string, unknown>): Promise<T> {
  const { data } = await api.post<ApiResponse<{ item: T }>>(`/${kind}`, input);
  return data.data!.item;
}

async function updateMaster<T>(
  kind: MasterKind,
  id: string,
  input: Record<string, unknown>
): Promise<T> {
  const { data } = await api.patch<ApiResponse<{ item: T }>>(`/${kind}/${id}`, input);
  return data.data!.item;
}

async function deleteMaster(kind: MasterKind, id: string): Promise<DeleteMasterResult> {
  const { data } = await api.delete<ApiResponse<DeleteMasterResult>>(`/${kind}/${id}`);
  return data.data!;
}

export const categories = {
  list: (withUsage = false) => listMasters<Category>('categories', withUsage),
  create: (input: { name: string; description?: string; parentId?: string | null }) =>
    createMaster<Category>('categories', input),
  update: (id: string, input: Record<string, unknown>) =>
    updateMaster<Category>('categories', id, input),
  remove: (id: string) => deleteMaster('categories', id),
};

export const brands = {
  list: (withUsage = false) => listMasters<Brand>('brands', withUsage),
  create: (input: { name: string; description?: string }) => createMaster<Brand>('brands', input),
  update: (id: string, input: Record<string, unknown>) =>
    updateMaster<Brand>('brands', id, input),
  remove: (id: string) => deleteMaster('brands', id),
};

export const units = {
  list: (withUsage = false) => listMasters<Unit>('units', withUsage),
  create: (input: { name: string; symbol: string; allowsDecimal?: boolean }) =>
    createMaster<Unit>('units', input),
  update: (id: string, input: Record<string, unknown>) => updateMaster<Unit>('units', id, input),
  remove: (id: string) => deleteMaster('units', id),
  /**
   * Creates the eight units every Indian shop needs. Idempotent — returns
   * `created: 0` when the company already has any.
   */
  seedDefaults: async (): Promise<number> => {
    const { data } = await api.post<ApiResponse<{ created: number }>>('/units/seed-defaults');
    return data.data!.created;
  },
};
