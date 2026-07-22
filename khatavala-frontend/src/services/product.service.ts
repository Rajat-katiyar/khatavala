import { api } from './api';
import type {
  ApiResponse,
  Product,
  ProductImportResult,
  ProductPage,
  ProductStats,
  StockStatus,
  Symbology,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

export interface ListProductsParams {
  search?: string;
  categoryId?: string;
  brandId?: string;
  stockStatus?: StockStatus;
  isActive?: boolean;
  sortBy?: 'name' | 'sku' | 'sellingPrice' | 'purchasePrice' | 'currentStock' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Drops empty filters so the API never sees `categoryId=` or `stockStatus=all`. */
function clean(params: ListProductsParams) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    if (key === 'stockStatus' && value === 'all') continue;
    out[key] = value;
  }
  return out;
}

export async function listProducts(params: ListProductsParams = {}): Promise<ProductPage> {
  const { data } = await api.get<ApiResponse<ProductPage>>('/products', {
    params: clean(params),
  });
  return data.data!;
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await api.get<ApiResponse<{ product: Product }>>(`/products/${id}`);
  return data.data!.product;
}

export async function getStats(): Promise<ProductStats> {
  const { data } = await api.get<ApiResponse<ProductStats>>('/products/stats');
  return data.data!;
}

export async function searchProducts(q: string, limit = 10): Promise<Product[]> {
  const { data } = await api.get<ApiResponse<{ products: Product[] }>>('/products/search', {
    params: { q, limit },
  });
  return data.data!.products;
}

export interface ProductInput {
  name: string;
  sku: string;
  barcode?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  hsnCode?: string | null;
  gstPercentage?: number;
  primaryUnitId: string;
  secondaryUnitId?: string | null;
  conversionFactor?: number | null;
  purchasePrice?: number;
  sellingPrice?: number;
  mrp?: number;
  wholesalePrice?: number;
  /** Accepted on create only — the update endpoint rejects it. */
  openingStock?: number;
  minStockLevel?: number;
  maxStockLevel?: number;
  trackBatch?: boolean;
  trackExpiry?: boolean;
  trackSerial?: boolean;
  isActive?: boolean;
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const { data } = await api.post<ApiResponse<{ product: Product }>>('/products', input);
  return data.data!.product;
}

export async function updateProduct(
  id: string,
  input: Partial<Omit<ProductInput, 'openingStock'>>
): Promise<Product> {
  const { data } = await api.patch<ApiResponse<{ product: Product }>>(`/products/${id}`, input);
  return data.data!.product;
}

export async function deleteProduct(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean; reason: string | null }> {
  const { data } = await api.delete<
    ApiResponse<{ deleted: boolean; deactivated: boolean; reason: string | null }>
  >(`/products/${id}`);
  return data.data!;
}

/* -------------------------------- images -------------------------------- */

export async function uploadProductImage(id: string, file: File): Promise<Product> {
  const form = new FormData();
  form.append('image', file);
  const { data } = await api.post<ApiResponse<{ product: Product }>>(
    `/products/${id}/image`,
    form,
    // Undefined, not 'multipart/form-data': the browser must set this itself so
    // it can append the multipart boundary.
    { headers: { 'Content-Type': undefined } }
  );
  return data.data!.product;
}

export async function deleteProductImage(id: string): Promise<Product> {
  const { data } = await api.delete<ApiResponse<{ product: Product }>>(`/products/${id}/image`);
  return data.data!.product;
}

/**
 * Product images are served by the API host, not the SPA host, when the local
 * storage driver is active — so a stored "/uploads/..." path has to be
 * resolved against the API origin or it 404s against Vite.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/api\/?$/, '');
  return `${base}${url}`;
}

/* --------------------------------- excel -------------------------------- */

async function download(path: string, filename: string, params?: Record<string, unknown>) {
  // `responseType: 'blob'` matters — the default string transform would corrupt
  // the binary .xlsx and the saved file would fail to open in Excel.
  const { data } = await api.get(path, { responseType: 'blob', params });
  const href = URL.createObjectURL(data as Blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function downloadTemplate() {
  return download('/products/import/template', 'khatavala-product-import-template.xlsx');
}

export function exportProducts(params: ListProductsParams = {}) {
  return download('/products/export', 'khatavala-products.xlsx', clean(params));
}

export async function importProducts(file: File, dryRun = false): Promise<ProductImportResult> {
  const form = new FormData();
  form.append('file', file);

  const { data } = await api.post<ApiResponse<ProductImportResult>>('/products/import', form, {
    params: { dryRun },
    headers: { 'Content-Type': undefined },
    // A 422 (every row failed) still carries a usable report, so let it through
    // to be rendered rather than thrown as a bare error.
    validateStatus: (status) => (status >= 200 && status < 300) || status === 422,
  });
  return data.data!;
}

/* ------------------------------- barcodes ------------------------------- */

export interface BarcodeSheetRequest {
  items: Array<{ productId: string; quantity?: number }>;
  symbology?: Symbology;
  columns?: number;
  showPrice?: boolean;
  showName?: boolean;
}

/** Returns the label sheet as an SVG string, ready to drop into a print window. */
export async function renderBarcodeSheet(request: BarcodeSheetRequest): Promise<string> {
  const { data } = await api.post('/products/barcodes/sheet', request, {
    responseType: 'text',
  });
  return data as string;
}
