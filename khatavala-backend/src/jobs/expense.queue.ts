import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { processRecurringExpenses } from '../services/expense.service.js';

const QUEUE_NAME = 'recurring-expenses';
const JOB_NAME = 'process-recurring';

let _recurringExpenseQueue: Queue | null = null;

export function getRecurringExpenseQueue(): Queue {
  if (!_recurringExpenseQueue) {
    _recurringExpenseQueue = new Queue(QUEUE_NAME, { connection: redis });
  }
  return _recurringExpenseQueue;
}

export async function scheduleRecurringExpenseJob(): Promise<void> {
  const queue = getRecurringExpenseQueue();
  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: {
        pattern: '5 0 * * *',
      },
      jobId: 'recurring-expenses-daily',
    }
  );
  logger.info('Recurring expense job scheduled (daily 00:05 UTC)');
}

export function createRecurringExpenseWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info(`[RecurringExpenses] Job ${job.id} started`);
      const asOf = new Date();
      const generated = await processRecurringExpenses(asOf);
      logger.info(`[RecurringExpenses] Job ${job.id} complete — generated ${generated} expenses`);
      return { generated };
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[RecurringExpenses] Job ${job?.id} failed`, err);
  });

  worker.on('completed', (job, result: { generated: number }) => {
    logger.info(`[RecurringExpenses] Job ${job.id} completed`, result);
  });

  return worker;
}
