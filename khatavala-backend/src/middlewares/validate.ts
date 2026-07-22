import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** What a validating middleware advertises about itself — see below. */
export interface ValidationMeta {
  schema: ZodTypeAny;
  source: 'body' | 'query' | 'params';
}

/** Set on the middleware function so docs/openapi.ts can read it back. */
export const VALIDATION_META = Symbol.for('khatavala.validationMeta');

// Validates req.body/query/params against a Zod schema and replaces them with parsed data.
export const validate = (
  schema: ZodTypeAny,
  source: 'body' | 'query' | 'params' = 'body'
) => {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    req[source] = result.data;
    next();
  };

  /**
   * The schema is stamped onto the middleware itself so the OpenAPI document
   * can recover it by walking the router, instead of a second hand-written map
   * of route -> schema that would silently rot the first time a route changed
   * validator. The contract a request must satisfy and the contract the docs
   * publish are then the same object, not two copies of it.
   */
  (middleware as any)[VALIDATION_META] = { schema, source } satisfies ValidationMeta;
  return middleware;
};
