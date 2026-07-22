import type { Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument, findSpecGaps } from './openapi.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Serves the API reference at `/api/docs`, with the raw spec at
 * `/api/docs.json`.
 *
 * EXPOSURE. The docs are on by default outside production and off by default in
 * production, because the page enumerates every endpoint and the permission
 * each one needs — a fine reconnaissance map for an attacker and of no use to a
 * customer. `ENABLE_API_DOCS=true` turns them on in production for teams whose
 * API is the product; that has to be a deliberate act, not a default.
 *
 * The spec is built ONCE, at mount, rather than per request: it is derived from
 * the router, which cannot change after boot, and rebuilding it per request
 * would hand an unauthenticated caller a way to burn CPU.
 */
export function mountApiDocs(app: Express): void {
  const enabled = env.ENABLE_API_DOCS ?? env.NODE_ENV !== 'production';
  if (!enabled) return;

  const gaps = findSpecGaps(app);
  if (gaps.length > 0) {
    // Warn rather than throw: an unnameable route is a documentation defect,
    // and refusing to boot the API over it would be the wrong trade.
    logger.warn(`API docs: ${gaps.length} route(s) could not be documented cleanly`);
    for (const gap of gaps) logger.warn(`  ${gap}`);
  }

  const document = buildOpenApiDocument(app);
  const endpointCount = Object.values(document.paths ?? {}).reduce(
    (total, item) => total + Object.keys(item as object).length,
    0
  );

  app.get('/api/docs.json', (_req, res) => res.json(document));

  app.use(
    '/api/docs',
    /**
     * Swagger UI ships inline styles and needs to call this origin from the
     * "Try it out" button. helmet's global CSP forbids both, so it is relaxed
     * for this path only — the rest of the app keeps the strict policy.
     */
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Khatavala API',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    })
  );

  logger.info(`API docs at /api/docs — ${endpointCount} endpoints`);
}
