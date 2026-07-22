import Dexie, { type Table } from 'dexie';

export interface LocalProduct {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  sellingPrice: number;
  currentStock: number;
  taxRate?: number;
}

export interface LocalCustomer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
}

export interface PendingTransaction {
  id: string; // client UUID
  idempotencyKey: string;
  type: 'pos_checkout' | 'sales_invoice' | 'payment';
  payload: any;
  status: 'pending' | 'syncing' | 'synced' | 'conflict';
  error?: string;
  createdAt: string;
}

export class KhatavalaOfflineDB extends Dexie {
  products!: Table<LocalProduct, string>;
  customers!: Table<LocalCustomer, string>;
  pendingTransactions!: Table<PendingTransaction, string>;

  constructor() {
    super('KhatavalaOfflineDB');
    this.version(1).stores({
      products: '_id, name, sku, barcode',
      customers: '_id, name, phone',
      pendingTransactions: 'id, idempotencyKey, status, createdAt',
    });
  }
}

export const offlineDb = new KhatavalaOfflineDB();
