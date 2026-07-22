import { api } from './api';
import type {
  ApiResponse,
  PaymentMode,
  PurchaseDocument,
  PurchaseDocumentKind,
  PurchaseDocumentPage,
  PurchaseReturnable,
  PurchaseReturnReason,
  SupplierPaymentHistory,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

/**
 * The buying-side client, mirroring sales.service. Document types share one
 * API shape, so `kind` selects the sub-route — same as the selling side.
 */

export interface ListPurchaseParams {
  status?: string;
  supplierId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listDocuments(
  kind: PurchaseDocumentKind,
  params: ListPurchaseParams = {}
): Promise<PurchaseDocumentPage> {
  const { data } = await api.get<ApiResponse<PurchaseDocumentPage>>(`/purchase/${kind}`, {
    params,
  });
  return data.data!;
}

export async function getDocument(
  kind: PurchaseDocumentKind,
  id: string
): Promise<PurchaseDocument> {
  const { data } = await api.get<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/${kind}/${id}`
  );
  return data.data!.document;
}

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  /** REQUIRED on the buying side — there is no sensible default rate. */
  unitPrice: number;
  discountPercent?: number;
  gstPercent?: number;
  sourceLineItemId?: string | null;
  orderedQuantity?: number | null;
  rejectedQuantity?: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface PurchaseDocumentInput {
  supplierId: string;
  lineItems: PurchaseLineInput[];
  date?: string;
  dueDate?: string | null;
  notes?: string | null;
  // Order-only.
  expectedDate?: string | null;
  warehouseId?: string | null;
  // GRN-only.
  purchaseOrderId?: string | null;
  supplierDocumentNumber?: string | null;
  vehicleNumber?: string | null;
  // Bill-only.
  grnId?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  receivesStock?: boolean;
  confirm?: boolean;
}

export async function createDocument(
  kind: PurchaseDocumentKind,
  input: PurchaseDocumentInput
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/${kind}`,
    input
  );
  return data.data!.document;
}

export async function updateDocument(
  kind: PurchaseDocumentKind,
  id: string,
  input: Partial<PurchaseDocumentInput>
): Promise<PurchaseDocument> {
  const { data } = await api.patch<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/${kind}/${id}`,
    input
  );
  return data.data!.document;
}

/* --------------------------- Conversions --------------------------- */

/** Order → receipt. Creates a DRAFT; receiving it is what moves stock. */
export async function convertOrderToGrn(
  id: string,
  input: { warehouseId?: string; supplierDocumentNumber?: string } = {}
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/orders/${id}/convert-to-grn`,
    input
  );
  return data.data!.document;
}

export async function convertOrderToInvoice(
  id: string,
  input: { receivesStock?: boolean; dueDate?: string } = {}
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/orders/${id}/convert-to-invoice`,
    input
  );
  return data.data!.document;
}

export async function convertGrnToInvoice(
  id: string,
  input: { supplierInvoiceNumber?: string; supplierInvoiceDate?: string; dueDate?: string } = {}
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/grn/${id}/convert-to-invoice`,
    input
  );
  return data.data!.document;
}

/* ------------------------------ Actions ---------------------------- */

/** THE stock-moving call on the buying side. */
export async function receiveGrn(id: string): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/grn/${id}/receive`,
    {}
  );
  return data.data!.document;
}

export async function confirmPurchaseInvoice(id: string): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/invoices/${id}/confirm`,
    {}
  );
  return data.data!.document;
}

export async function cancelDocument(
  kind: 'grn' | 'invoices',
  id: string,
  reason: string
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/${kind}/${id}/cancel`,
    { reason }
  );
  return data.data!.document;
}

/* ----------------------------- Payments ---------------------------- */

export async function recordSupplierPayment(
  purchaseInvoiceId: string,
  input: {
    amount: number;
    mode: PaymentMode;
    referenceNumber?: string | null;
    notes?: string | null;
  }
): Promise<PurchaseDocument> {
  const { data } = await api.post<ApiResponse<{ document: PurchaseDocument }>>(
    `/purchase/invoices/${purchaseInvoiceId}/payments`,
    input
  );
  return data.data!.document;
}

export async function getSupplierPaymentHistory(
  purchaseInvoiceId: string
): Promise<SupplierPaymentHistory> {
  const { data } = await api.get<ApiResponse<SupplierPaymentHistory>>(
    `/purchase/invoices/${purchaseInvoiceId}/payments`
  );
  return data.data!;
}

/* ------------------------------ Returns ---------------------------- */

export async function getReturnableLines(
  purchaseInvoiceId: string
): Promise<PurchaseReturnable> {
  const { data } = await api.get<ApiResponse<PurchaseReturnable>>(
    `/purchase/returns/returnable/${purchaseInvoiceId}`
  );
  return data.data!;
}

export async function createPurchaseReturn(input: {
  purchaseInvoiceId: string;
  lines: Array<{ lineItemId: string; quantity: number }>;
  reason: PurchaseReturnReason;
  reasonNotes?: string | null;
  returnsStock?: boolean;
  refundAmount?: number;
  refundMode?: PaymentMode;
}): Promise<{ debitNote: PurchaseDocument }> {
  const { data } = await api.post<ApiResponse<{ debitNote: PurchaseDocument }>>(
    '/purchase/returns',
    input
  );
  return data.data!;
}
