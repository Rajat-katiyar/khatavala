import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import type {
  ApiResponse,
  PaymentHistory,
  PaymentMode,
  PosCartLine,
  PosCheckoutResult,
  PosProduct,
  Receipt,
  ReturnableInvoice,
  ReturnReason,
  SalesDocument,
  SalesReturnResult,
  SalesDocumentDetail,
  SalesDocumentKind,
  SalesDocumentPage,
  SalesDocumentStatus,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

/**
 * The three document types share one API shape, so they share one client —
 * `kind` selects the sub-route. Mirrors the shared router and service on the
 * backend rather than triplicating the same six functions here.
 */

export interface ListSalesParams {
  status?: SalesDocumentStatus;
  customerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listDocuments(
  kind: SalesDocumentKind,
  params: ListSalesParams = {}
): Promise<SalesDocumentPage> {
  const { data } = await api.get<ApiResponse<SalesDocumentPage>>(`/sales/${kind}`, { params });
  return data.data!;
}

export async function getDocument(
  kind: SalesDocumentKind,
  id: string
): Promise<SalesDocumentDetail> {
  const { data } = await api.get<ApiResponse<SalesDocumentDetail>>(`/sales/${kind}/${id}`);
  return data.data!;
}

export interface LineItemInput {
  productId: string;
  quantity: number;
  /** Omit to take the product's selling price. */
  unitPrice?: number;
  discountPercent?: number;
  /** Omit to take the product's GST rate. */
  gstPercent?: number;
}

export interface SalesDocumentInput {
  customerId: string;
  lineItems: LineItemInput[];
  date?: string;
  dueDate?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  validUntil?: string | null;
  expectedDeliveryDate?: string | null;
  /** Invoices only. Defaults true server-side — posts stock and the ledger. */
  confirm?: boolean;
}

export async function createDocument(
  kind: SalesDocumentKind,
  input: SalesDocumentInput
): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/${kind}`,
    input
  );
  return data.data!.document;
}

export async function updateDocument(
  kind: SalesDocumentKind,
  id: string,
  input: Partial<SalesDocumentInput>
): Promise<SalesDocument> {
  const { data } = await api.patch<ApiResponse<{ document: SalesDocument }>>(
    `/sales/${kind}/${id}`,
    input
  );
  return data.data!.document;
}

export async function setStatus(
  kind: SalesDocumentKind,
  id: string,
  status: SalesDocumentStatus
): Promise<SalesDocument> {
  const { data } = await api.patch<ApiResponse<{ document: SalesDocument }>>(
    `/sales/${kind}/${id}/status`,
    { status }
  );
  return data.data!.document;
}

export async function deleteDocument(kind: SalesDocumentKind, id: string): Promise<void> {
  await api.delete(`/sales/${kind}/${id}`);
}

/* --------------------------- Conversions --------------------------- */

export async function convertQuotationToOrder(id: string): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/quotations/${id}/convert-to-order`,
    {}
  );
  return data.data!.document;
}

export async function convertQuotationToInvoice(id: string): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/quotations/${id}/convert-to-invoice`,
    {}
  );
  return data.data!.document;
}

export async function convertOrderToInvoice(id: string): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/orders/${id}/convert-to-invoice`,
    {}
  );
  return data.data!.document;
}

/* ----------------------------- Invoices ---------------------------- */

export async function getNextInvoiceNumber(): Promise<string> {
  const { data } = await api.get<ApiResponse<{ documentNumber: string }>>(
    '/sales/invoices/next-number'
  );
  return data.data!.documentNumber;
}

export async function confirmInvoice(id: string): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/invoices/${id}/confirm`,
    {}
  );
  return data.data!.document;
}

export async function cancelInvoice(id: string, reason: string): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/invoices/${id}/cancel`,
    { reason }
  );
  return data.data!.document;
}

export async function recordPayment(
  id: string,
  input: {
    amount: number;
    /** Required since Phase 10 — "how much cash is in the till" needs it. */
    mode: PaymentMode;
    date?: string;
    referenceNumber?: string | null;
    notes?: string | null;
  }
): Promise<SalesDocument> {
  const { data } = await api.post<ApiResponse<{ document: SalesDocument }>>(
    `/sales/invoices/${id}/payments`,
    input
  );
  return data.data!.document;
}

/**
 * Downloads the PDF.
 *
 * Uses fetch with an explicit Authorization header rather than a plain
 * `window.open`: the endpoint is authenticated, and a new tab carries no
 * bearer token. Goes through a blob URL so the browser's own save dialog
 * handles the file.
 */
export async function downloadInvoicePdf(id: string, documentNumber: string): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const baseURL = import.meta.env.VITE_API_URL ?? '/api';

  const response = await fetch(`${baseURL}/sales/invoices/${id}/pdf?download=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error('Could not generate the PDF');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${documentNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Send by email / WhatsApp. The backend returns 501 by design — the axios
 * interceptor surfaces its message, which is what the UI shows.
 */
export async function sendInvoice(id: string): Promise<void> {
  await api.post(`/sales/invoices/${id}/send`, {});
}

/* ------------------------------------------------------------------ *
 * Phase 10 — POS, payments, returns
 * ------------------------------------------------------------------ */

/**
 * POS checkout: ONE call creates the invoice, deducts stock and records the
 * payment, in one server-side transaction. The till never has to reason about
 * a half-completed sale — see pos.service.ts on the backend.
 */
export async function posCheckout(input: {
  lines: PosCartLine[];
  customerId?: string | null;
  payment: {
    mode: PaymentMode;
    amount?: number;
    referenceNumber?: string | null;
    tendered?: number;
  };
  notes?: string | null;
}): Promise<PosCheckoutResult> {
  const { data } = await api.post<ApiResponse<PosCheckoutResult>>('/sales/pos/checkout', input);
  return data.data!;
}

export async function getPosProducts(
  params: { search?: string; limit?: number } = {}
): Promise<PosProduct[]> {
  const { data } = await api.get<ApiResponse<{ products: PosProduct[] }>>(
    '/sales/pos/products',
    { params }
  );
  return data.data!.products;
}

export async function getReceipt(invoiceId: string): Promise<Receipt> {
  const { data } = await api.get<ApiResponse<Receipt>>(`/sales/invoices/${invoiceId}/receipt`);
  return data.data!;
}

export async function getPaymentHistory(invoiceId: string): Promise<PaymentHistory> {
  const { data } = await api.get<ApiResponse<PaymentHistory>>(
    `/sales/invoices/${invoiceId}/payments`
  );
  return data.data!;
}

export async function getReturnableLines(invoiceId: string): Promise<ReturnableInvoice> {
  const { data } = await api.get<ApiResponse<ReturnableInvoice>>(
    `/sales/returns/returnable/${invoiceId}`
  );
  return data.data!;
}

export async function createReturn(input: {
  invoiceId: string;
  lines: Array<{ lineItemId: string; quantity: number }>;
  reason: ReturnReason;
  reasonNotes?: string | null;
  restock?: boolean;
  refundAmount?: number;
  refundMode?: PaymentMode;
}): Promise<SalesReturnResult> {
  const { data } = await api.post<ApiResponse<SalesReturnResult>>('/sales/returns', input);
  return data.data!;
}
