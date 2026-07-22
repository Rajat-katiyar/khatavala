import { Queue, Worker, type Processor } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

let _invoiceQueue: Queue | null = null;

export function getInvoiceQueue(): Queue {
  if (!_invoiceQueue) {
    _invoiceQueue = new Queue('invoice', { connection: redis });
  }
  return _invoiceQueue;
}

export function createInvoiceWorker(processor: Processor) {
  const worker = new Worker('invoice', processor, { connection: redis });
  worker.on('failed', (job, err) => logger.error(`Job ${job?.id} failed`, err));
  return worker;
}
