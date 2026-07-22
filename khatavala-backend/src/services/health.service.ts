import mongoose from 'mongoose';
import { redis } from '../config/redis.js';

// Business logic lives in services, separate from controllers.
export async function getHealth() {
  const mongoState = mongoose.connection.readyState === 1 ? 'up' : 'down';

  let redisState = 'down';
  try {
    if ((await redis.ping()) === 'PONG') redisState = 'up';
  } catch {
    redisState = 'down';
  }

  return {
    status: 'ok',
    uptime: process.uptime(),
    services: { mongo: mongoState, redis: redisState },
  };
}
