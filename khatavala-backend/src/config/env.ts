import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  // Off in production unless set — see docs/mount.ts for why.
  ENABLE_API_DOCS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MONGO_URI: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  LOG_LEVEL: z.string().default('info'),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  // Tokens carrying an active-company claim expire sooner: the claim is
  // trusted without a DB lookup, so this bounds how long a revoked membership
  // remains usable.
  JWT_ACTIVE_COMPANY_EXPIRES_IN: z.string().default('5m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  PASSWORD_RESET_TTL_MIN: z.coerce.number().default(30),

  // Mail (Mailtrap, Brevo, or any test SMTP)
  BREVO_EMAIL_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().optional(),
  BREVO_SENDER_NAME: z.string().optional(),
  SMTP_HOST: z.string().default('sandbox.smtp.mailtrap.io'),
  SMTP_PORT: z.coerce.number().default(2525),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Khatavala <no-reply@khatavala.local>'),
  APP_URL: z.string().default('http://localhost:5173'),

  // Image storage. Leave the Cloudinary trio unset and uploads fall back to
  // the local-disk driver under ./uploads — see services/storage.service.ts.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
