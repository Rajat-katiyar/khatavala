import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import routes from './routes/index.js';
import { UPLOAD_ROOT } from './services/storage.service.js';
import { mountApiDocs } from './docs/mount.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      // X-Company-Id is the header fallback for selecting the active tenant.
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id'],
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);
  app.use('/api', rateLimiter);

  /**
   * Product images, when the local storage driver is active (the default —
   * see services/storage.service.ts). `crossOriginResourcePolicy` is relaxed
   * only for this path because helmet's default `same-origin` would stop the
   * Vite dev server on :5173 from rendering an image served from :4000.
   */
  app.use(
    '/uploads',
    helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
    express.static(UPLOAD_ROOT, {
      // These are content-addressed by a UUID filename, so they never change
      // under a given URL and can be cached hard.
      maxAge: '30d',
      index: false,
      // Never interpret an uploaded file as HTML/JS — a .png that is really a
      // script must download, not execute on our origin.
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  app.use('/api', routes);

  mountApiDocs(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
