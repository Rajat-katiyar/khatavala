import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { redis } from './config/redis.js';
import {
  createRecurringExpenseWorker,
  scheduleRecurringExpenseJob,
} from './jobs/expense.queue.js';
import {
  createNotificationWorker,
  scheduleNotificationJobs,
} from './jobs/notification.queue.js';
import type { Worker } from 'bullmq';

async function bootstrap() {
  await connectDatabase();

  let expenseWorker: Worker | null = null;
  let notificationWorker: Worker | null = null;

  try {
    await redis.connect();
    const ping = await redis.ping();
    if (ping === 'PONG') {
      expenseWorker = createRecurringExpenseWorker();
      await scheduleRecurringExpenseJob();

      notificationWorker = createNotificationWorker();
      await scheduleNotificationJobs();
    }
  } catch (_err) {
    logger.info('Redis server not detected locally — background BullMQ jobs disabled for this dev session.');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Khatavala API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    if (expenseWorker) {
      await expenseWorker.close().catch(() => {});
    }
    if (notificationWorker) {
      await notificationWorker.close().catch(() => {});
    }
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
