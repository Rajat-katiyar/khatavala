import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

/**
 * Adds `.openapi(...)` to every Zod schema in the process.
 *
 * It lives in its own module because it must run BEFORE any validator that
 * calls `.openapi()` is evaluated, and import order is the only ordering
 * guarantee available. Validators that want to document a field import this;
 * the patch is global and idempotent, so importing it twice is free.
 */
extendZodWithOpenApi(z);

export { z };
