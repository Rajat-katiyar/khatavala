# Khatavala

SaaS billing & inventory — MERN (MongoDB, Express, React, Node) + TypeScript.

```
Khatavala/
├── docker-compose.yml          # Mongo (single-node replica set) + Redis
├── khatavala-backend/          # Node + Express + TS
│   └── src/
│       ├── config/             # env, database, redis, logger
│       ├── models/             # Mongoose schemas
│       ├── routes/             # /api routes
│       ├── controllers/        # thin HTTP handlers
│       ├── services/           # business logic
│       ├── middlewares/        # auth, error handler, validate, rate limiter, request logger
│       ├── validators/         # Zod schemas per module
│       ├── utils/              # ApiError, asyncHandler
│       ├── jobs/               # BullMQ queues
│       ├── app.ts              # express app (helmet, cors, rate limit)
│       └── server.ts           # bootstrap + graceful shutdown
└── khatavala-frontend/         # React 18 + Vite + TS
    └── src/
        ├── pages/ components/ features/
        ├── services/           # Axios api.ts (auth + error interceptors)
        ├── hooks/ store/ (Zustand) lib/ types/
```

## Run locally

1. **Infra** (optional if using Atlas): `docker compose up -d`
2. **Backend**: `cd khatavala-backend && npm i && cp .env.example .env && npm run dev` → http://localhost:4000
3. **Frontend**: `cd khatavala-frontend && npm i && npm run dev` → http://localhost:5173

Health check: `GET http://localhost:4000/api/health`. The frontend dashboard pings it on load (via Vite `/api` proxy).
