import { Types } from 'mongoose';
import { OnlineStoreModel } from '../models/OnlineStore.js';
import { ProductModel } from '../models/Product.js';
import { CustomerModel } from '../models/Customer.js';
import { CompanyModel } from '../models/Company.js';
import { tenantFilter, tenantStamp, type TenantContext } from '../middlewares/tenantScope.js';
import { ApiError } from '../utils/ApiError.js';

/* ── Owner / admin operations ──────────────────────────────────────────── */

export async function getOrCreateStore(tenant: TenantContext) {
  let store = await OnlineStoreModel.findOne(tenantFilter(tenant, {})).lean();
  if (!store) {
    const company = await CompanyModel.findById(tenant.companyId).lean();
    const slug = (company?.name || 'store')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);

    const uniqueSlug = `${slug}-${String(tenant.companyId).slice(-4)}`;
    store = await OnlineStoreModel.create(
      tenantStamp(tenant, {
        storeSlug: uniqueSlug,
        storeName: company?.name || 'My Store',
        themeColor: '#6366f1',
        isActive: false,
      })
    );
  }
  return store;
}

export async function updateStore(tenant: TenantContext, updates: Record<string, any>) {
  const store = await OnlineStoreModel.findOneAndUpdate(
    tenantFilter(tenant, {}),
    { $set: updates },
    { new: true, upsert: false }
  );
  if (!store) throw ApiError.notFound('Online store not found. Create it first.');
  return store;
}

/* ── Public / unauthenticated operations ───────────────────────────────── */

export async function getPublicStoreBySlug(slug: string) {
  const store = await OnlineStoreModel.findOne({ storeSlug: slug.toLowerCase(), isActive: true }).lean();
  if (!store) throw ApiError.notFound('Store not found or is offline');
  return store;
}

export async function listPublicProducts(storeSlug: string, search?: string) {
  const store = await getPublicStoreBySlug(storeSlug);

  const filter: Record<string, any> = {
    companyId: store.companyId,
    isActive: true,
    isOnlineStoreVisible: true,
  };
  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }

  const products = await ProductModel.find(filter)
    .select('name sku sellingPrice mrp imageUrl onlineStoreDescription currentStock gstPercentage')
    .lean();

  return { store, products };
}

/**
 * Creates a pending SalesOrder from a public cart checkout.
 * Tagged source="OnlineStore" so owner can filter these orders.
 */
export async function publicCheckout(
  storeSlug: string,
  payload: {
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    items: Array<{ productId: string; quantity: number }>;
    notes?: string;
  }
) {
  const store = await getPublicStoreBySlug(storeSlug);
  const companyId = String(store.companyId);

  // Validate all items exist and are visible
  const productIds = payload.items.map((i) => new Types.ObjectId(i.productId));
  const products = await ProductModel.find({
    companyId: store.companyId,
    _id: { $in: productIds },
    isOnlineStoreVisible: true,
    isActive: true,
  }).lean();

  if (products.length !== payload.items.length) {
    throw ApiError.badRequest('One or more products are unavailable in this store');
  }

  const byId = new Map(products.map((p) => [String(p._id), p]));

  let grandTotal = 0;
  const lineItems = payload.items.map((item) => {
    const product = byId.get(item.productId)!;
    const lineTotal = product.sellingPrice * item.quantity;
    grandTotal += lineTotal;
    return {
      productId: product._id,
      name: product.name,
      sku: product.sku,
      hsnCode: product.hsnCode ?? null,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      discountPercent: 0,
      gstPercent: product.gstPercentage ?? 0,
      cgstPercent: (product.gstPercentage ?? 0) / 2,
      sgstPercent: (product.gstPercentage ?? 0) / 2,
      igstPercent: 0,
      cessPercent: 0,
      discountAmount: 0,
      taxableAmount: lineTotal,
      taxAmount: lineTotal * (product.gstPercentage ?? 0) / 100,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      cessAmount: 0,
      lineTotal,
      warehouseId: null,
      batchNumber: null,
      expiryDate: null,
      sourceLineItemId: null,
      orderedQuantity: null,
      rejectedQuantity: 0,
    };
  });

  // Find or create a walk-in customer record
  let customer = await CustomerModel.findOne({
    companyId: store.companyId,
    phone: payload.customerPhone,
  }).lean();

  if (!customer) {
    customer = await CustomerModel.create({
      companyId: store.companyId,
      name: payload.customerName,
      phone: payload.customerPhone,
      address: { line1: payload.customerAddress || '' },
      isActive: true,
    });
  }

  // Import SalesOrder model dynamically to avoid circular deps
  const { SalesOrderModel } = await import('../models/SalesOrder.js');

  const order = await (SalesOrderModel as any).create({
    companyId: store.companyId,
    customerId: customer._id,
    customerName: customer.name,
    documentNumber: `ONL-${Date.now()}`,
    date: new Date(),
    lineItems,
    subTotal: grandTotal,
    totalDiscount: 0,
    totalTax: 0,
    roundOff: 0,
    grandTotal,
    status: 'Draft',
    notes: `Online Store Order. Customer: ${payload.customerName} | Phone: ${payload.customerPhone} | ${payload.customerAddress ? `Address: ${payload.customerAddress}` : ''} | ${payload.notes || ''}`,
    source: 'OnlineStore',
  });

  return {
    orderId: String(order._id),
    documentNumber: order.documentNumber,
    grandTotal,
    customerName: payload.customerName,
    message: 'Order placed successfully! The shop will confirm your order shortly.',
  };
}
