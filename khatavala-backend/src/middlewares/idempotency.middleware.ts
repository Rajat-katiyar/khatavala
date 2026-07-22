import type { Request, Response, NextFunction } from 'express';
import { IdempotencyKeyModel } from '../models/IdempotencyKey.js';

export function handleIdempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers['x-idempotency-key'] as string) || req.body?.idempotencyKey;
    const companyId = req.tenant?.companyId;

    if (!key || !companyId) {
      return next();
    }

    try {
      const existing = await IdempotencyKeyModel.findOne({ key, companyId }).lean();
      if (existing) {
        return res.status(existing.statusCode).json(existing.responseBody);
      }

      // Intercept res.json to cache response
      const originalJson = res.json.bind(res);
      res.json = ((body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          IdempotencyKeyModel.create({
            key,
            companyId,
            statusCode: res.statusCode,
            responseBody: body,
          }).catch((err) => console.error('Failed to cache idempotency key:', err));
        }
        return originalJson(body);
      }) as any;

      next();
    } catch (err) {
      next(err);
    }
  };
}
