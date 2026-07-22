import { offlineDb, type PendingTransaction } from '../db/db';
import { api } from './api';
import * as productService from './product.service';
import * as customerService from './customer.service';

/**
 * Caches catalog items (products & customers) into IndexedDB for offline access.
 */
export async function cacheCatalogLocally() {
  try {
    const productsRes: any = await productService.listProducts({ limit: 500 });
    const productList = productsRes.items || productsRes.products || [];
    if (productList.length > 0) {
      await offlineDb.products.bulkPut(
        productList.map((p: any) => ({
          _id: p._id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          sellingPrice: p.sellingPrice,
          currentStock: p.currentStock || 0,
        }))
      );
    }

    const customersRes: any = await customerService.listCustomers({ limit: 500 });
    const customerList = customersRes.items || customersRes.customers || [];
    if (customerList.length > 0) {
      await offlineDb.customers.bulkPut(
        customerList.map((c: any) => ({
          _id: c._id,
          name: c.name,
          phone: c.phone,
          email: c.email,
        }))
      );
    }
  } catch (err) {
    console.warn('Failed to cache catalog locally (offline mode active):', err);
  }
}

/**
 * Queues an offline transaction into Dexie.js.
 */
export async function queueOfflineTransaction(
  type: PendingTransaction['type'],
  payload: any
): Promise<PendingTransaction> {
  const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `idemp_${id}`;

  const pendingItem: PendingTransaction = {
    id,
    idempotencyKey,
    type,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await offlineDb.pendingTransactions.add(pendingItem);
  return pendingItem;
}

/**
 * Background Sync Engine: pushes queued transactions to backend in order.
 */
export async function syncPendingTransactions(): Promise<{ syncedCount: number; errorsCount: number }> {
  if (!navigator.onLine) {
    return { syncedCount: 0, errorsCount: 0 };
  }

  const pending = await offlineDb.pendingTransactions.where('status').equals('pending').toArray();
  if (pending.length === 0) {
    return { syncedCount: 0, errorsCount: 0 };
  }

  let syncedCount = 0;
  let errorsCount = 0;

  for (const item of pending) {
    try {
      await offlineDb.pendingTransactions.update(item.id, { status: 'syncing' });

      let endpoint = '';
      if (item.type === 'pos_checkout') {
        endpoint = '/sales/pos/checkout';
      } else if (item.type === 'sales_invoice') {
        endpoint = '/sales/invoices';
      } else if (item.type === 'payment') {
        endpoint = '/sales/payments';
      }

      await api.post(endpoint, item.payload, {
        headers: {
          'x-idempotency-key': item.idempotencyKey,
        },
      });

      // Remove successfully synced item from IndexedDB
      await offlineDb.pendingTransactions.delete(item.id);
      syncedCount++;
    } catch (err: any) {
      errorsCount++;
      const errorMessage = err?.response?.data?.message || err?.message || 'Sync failed';
      await offlineDb.pendingTransactions.update(item.id, {
        status: err?.response?.status === 409 ? 'conflict' : 'pending',
        error: errorMessage,
      });
    }
  }

  return { syncedCount, errorsCount };
}
