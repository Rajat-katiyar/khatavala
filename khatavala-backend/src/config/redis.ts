import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// lazyConnect: true prevents auto-connecting on module load.
// retryStrategy returns null after 3 attempts so it doesn't flood terminal when Redis is down.
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  retryStrategy: (times) => {
    if (times > 3) return null; // Stop retrying if Redis is not running
    return Math.min(times * 500, 2000);
  },
});

let loggedError = false;
redis.on('connect', () => {
  loggedError = false;
  logger.info('Redis connected');
});
redis.on('error', (err) => {
  if (!loggedError) {
    logger.warn(`Redis unavailable at ${env.REDIS_URL} (${(err as any).code ?? 'OFFLINE'}). Background queues will be disabled.`);
    loggedError = true;
  }
});
