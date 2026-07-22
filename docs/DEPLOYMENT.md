# Production Readiness & Deployment Checklist

## Environment Variable Audit

### Backend (`khatavala-backend`)
- `PORT`: Server HTTP port (default `5000`).
- `MONGO_URI`: MongoDB Atlas production cluster connection string.
- `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET`: Cryptographically secure secrets (min 64 chars).
- `REDIS_URL`: Production Redis instance URI.
- `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`: Live Razorpay API keys.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: Production email server settings.

### Frontend (`khatavala-frontend`)
- `VITE_API_URL`: Backend production API URL (`https://api.khatavala.com/api`).

---

## Security & Performance Checklist
1. **HTTPS Enforcement**: Reverse proxy (Nginx / Cloudflare) forcing TLS 1.3.
2. **Compression**: Enabled response compression middleware in Express.
3. **Database Indexing**: Compound indexes on `{ companyId: 1, createdAt: -1 }`, `{ companyId: 1, status: 1 }`.
4. **Error Monitoring**: Sentry integration for exception tracking.
5. **Rate Limiting**: `express-rate-limit` guarding `/api/auth/*` endpoints against brute force.
