import type { Express } from 'express';
import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from './zodOpenapi.js';
import { collectRoutes, routeKey, type RouteEntry } from './routeInventory.js';
import { env } from '../config/env.js';

/**
 * THE OPENAPI DOCUMENT, generated from the running application.
 *
 * Nothing here is a transcription. The path list comes from the live Express
 * router (routeInventory.ts), the request schemas come from the very `validate()`
 * middleware that will reject a bad request, and the permission on each endpoint
 * comes from the `requirePermission()` guard that enforces it. A hand-written
 * spec drifts the first week; this one cannot describe an endpoint the server
 * does not serve, or miss one it does.
 *
 * What IS authored by hand is the prose: summaries and tag descriptions, in
 * SUMMARIES below. Those are the part a generator cannot infer, and an endpoint
 * missing one still appears — with a mechanical summary — rather than vanishing.
 */

/** `/api/sales/invoices/:id` → `sales`. The module an endpoint belongs to. */
function tagOf(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // segments[0] is always 'api'.
  return segments[1] ?? 'general';
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  auth: 'Registration, login, token refresh and session management.',
  companies: 'Companies (tenants), membership and the active-company switch.',
  users: 'User accounts and their company memberships.',
  roles: 'Roles and the permission catalogue they draw from.',
  customers: 'Customers and their receivable ledger.',
  suppliers: 'Suppliers and their payable ledger.',
  products: 'Products, variants, pricing and images.',
  catalog: 'Categories, brands, units and tax rates.',
  inventory: 'Stock balances, movements, transfers and adjustments.',
  warehouses: 'Storage locations stock is held against.',
  sales: 'Quotations, orders, invoices, POS, returns and receipts.',
  purchase: 'Purchase orders, GRNs, bills, debit notes and supplier payments.',
  accounting: 'Chart of accounts, journal entries and the cash/bank books.',
  reports: 'Trial balance, P&L, balance sheet, day book and their exports.',
  'audit-logs': 'The immutable record of who changed what.',
  health: 'Liveness and readiness probes.',
};

/**
 * Human summaries, keyed exactly as `routeKey()` renders a route.
 *
 * Deliberately partial: only where the mechanical summary would be unclear or
 * would hide something a caller needs to know (a write that moves stock, an
 * endpoint that returns a file rather than JSON).
 */
const SUMMARIES: Record<string, string> = {
  'POST /api/auth/register': 'Register a user and their first company',
  'POST /api/auth/login': 'Exchange credentials for an access and refresh token',
  'POST /api/auth/refresh': 'Rotate a refresh token for a new access token',
  'POST /api/auth/logout': 'Revoke the current refresh token',
  'POST /api/companies/:id/switch': 'Re-issue the token scoped to another company',

  'GET /api/inventory/stock': 'Current stock, optionally filtered by product or warehouse',
  'POST /api/inventory/transfer': 'Move stock between warehouses (transactional)',
  'POST /api/inventory/adjustment': 'Correct stock with a reason (transactional)',
  'POST /api/inventory/damage': 'Write stock off as damaged (transactional)',

  'POST /api/sales/pos/checkout':
    'Single-call POS sale: invoice, stock deduction and payment in one transaction',
  'POST /api/sales/invoices/:id/confirm':
    'Confirm an invoice — deducts stock, posts the customer ledger and the journal, all or nothing',
  'GET /api/sales/invoices/:id/pdf': 'Download the invoice as a PDF',

  'POST /api/purchase/grn/:id/receive': 'Receive goods against a GRN — increases stock',
  'POST /api/purchase/invoices/:id/confirm':
    'Confirm a purchase bill — posts the supplier ledger and the journal',

  'POST /api/accounting/journal-entries':
    'Post a manual journal entry (rejected unless debits equal credits)',
  'POST /api/accounting/contra': 'Post a cash/bank contra entry',

  'GET /api/reports/trial-balance': 'Trial balance — total debits always equal total credits',
  'GET /api/reports/profit-loss': 'Profit and loss for a period, grouped by role',
  'GET /api/reports/balance-sheet': 'Balance sheet as at a date, retained earnings computed',
  'GET /api/reports/day-book': 'Every journal entry posted on a day, in order',
  'GET /api/reports/drill-down': 'The transactions behind a single report line',
  'GET /api/reports/:kind/export': 'Download a report as PDF or Excel',
};

/** A readable fallback: `GET /api/sales/invoices/:id` → "Get a sales invoice". */
function mechanicalSummary(route: RouteEntry): string {
  const verb =
    { GET: 'Get', POST: 'Create', PUT: 'Update', PATCH: 'Update', DELETE: 'Delete' }[
      route.method
    ] ?? route.method;

  const segments = route.path.split('/').filter((s) => s && s !== 'api' && !s.startsWith(':'));
  const subject = segments.join(' ').replace(/-/g, ' ');
  const byId = route.path.includes('/:') ? ' by id' : '';
  return `${verb} ${subject}${byId}`.trim();
}

/** OpenAPI wants `{id}` where Express writes `:id`. */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
}

/**
 * Every response shares one envelope, so it is described once and referenced.
 * `data` is left open: typing all 187 response bodies by hand is exactly the
 * hand-maintained surface this file exists to avoid, and an inaccurate response
 * schema is worse than an honest `object`.
 */
function buildEnvelopes(registry: OpenAPIRegistry) {
  const error = registry.register(
    'ErrorResponse',
    z
      .object({
        success: z.literal(false),
        error: z.object({
          code: z.string().openapi({ example: 'FORBIDDEN' }),
          message: z.string().openapi({ example: 'Your role does not permit sales.create' }),
          details: z.unknown().optional(),
        }),
      })
      .openapi('ErrorResponse')
  );

  return { error };
}

const ERROR_RESPONSES = (authenticated: boolean, gated: boolean) => ({
  400: { description: 'Validation failed or the request was malformed' },
  ...(authenticated
    ? { 401: { description: 'Missing, expired or invalid bearer token' } }
    : {}),
  ...(gated ? { 403: { description: 'The caller’s role lacks the required permission' } } : {}),
  404: { description: 'Not found in the active company' },
});

export function buildOpenApiDocument(app: Express) {
  const registry = new OpenAPIRegistry();
  const routes = collectRoutes(app);

  const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'The access token from `POST /api/auth/login`. It carries the active company, ' +
      'so every request is already tenant-scoped.',
  });

  buildEnvelopes(registry);

  for (const route of routes) {
    const key = routeKey(route);
    const tag = tagOf(route.path);

    const body = route.validation.find((v) => v.source === 'body')?.schema;
    const query = route.validation.find((v) => v.source === 'query')?.schema;

    /**
     * Path params are declared from the URL rather than from the `params`
     * validator: not every route validates its params, but every route with a
     * `:segment` has that parameter, and omitting it makes the endpoint
     * untryable in the UI.
     */
    const params = pathParamNames(route.path);
    const paramsSchema =
      params.length > 0
        ? z.object(
            Object.fromEntries(
              params.map((name) => [
                name,
                z.string().openapi({ description: `The ${name} path parameter` }),
              ])
            )
          )
        : undefined;

    const description = [
      route.permissions.length > 0
        ? `**Permission required:** \`${route.permissions.join('` or `')}\``
        : null,
      route.authenticated
        ? 'Scoped to the caller’s active company; send `X-Company-Id` to override it.'
        : 'Public — no token required.',
    ]
      .filter(Boolean)
      .join('\n\n');

    registry.registerPath({
      method: route.method.toLowerCase() as 'get',
      path: toOpenApiPath(route.path),
      tags: [tag],
      summary: SUMMARIES[key] ?? mechanicalSummary(route),
      description,
      security: route.authenticated ? [{ [bearerAuth.name]: [] }] : [],
      request: {
        ...(paramsSchema ? { params: paramsSchema } : {}),
        ...(query ? { query: query as never } : {}),
        ...(body
          ? { body: { content: { 'application/json': { schema: body as never } } } }
          : {}),
      },
      responses: {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: z.object({ success: z.literal(true), data: z.unknown() }),
            },
          },
        },
        ...ERROR_RESPONSES(route.authenticated, route.permissions.length > 0),
      },
    });
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);

  const usedTags = [...new Set(routes.map((route) => tagOf(route.path)))].sort();

  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Khatavala API',
      version: '1.0.0',
      description: [
        'Billing, inventory and accounting for multi-company businesses.',
        '',
        '### How to use this page',
        '1. `POST /api/auth/login` with your credentials.',
        '2. Click **Authorize** and paste the `accessToken` from the response.',
        '3. Every endpoint below is then callable against your active company.',
        '',
        '### Conventions',
        '- Every response is `{ "success": true, "data": ... }` or ' +
          '`{ "success": false, "error": { "code", "message" } }`.',
        '- Money is in the company’s currency, rounded to two decimals.',
        '- Ledgers (stock, customer, supplier, journal) are append-only: ' +
          'corrections are posted as reversing entries, never as edits.',
        '',
        `This document is generated from the running server — ${routes.length} endpoints.`,
      ].join('\n'),
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: 'This server' }],
    tags: usedTags.map((name) => ({
      name,
      description: TAG_DESCRIPTIONS[name] ?? '',
    })),
  });
}

/**
 * Guards against the one failure a generated spec can still have: a route the
 * generator saw but could not name, which would publish a path nobody can call.
 * Returns the problems rather than throwing, so the caller decides whether a
 * boot should fail or merely warn.
 */
export function findSpecGaps(app: Express): string[] {
  const problems: string[] = [];

  for (const route of collectRoutes(app)) {
    if (!route.path.startsWith('/')) {
      problems.push(`${routeKey(route)}: path could not be resolved from the router`);
    }
    if (/[?+*()[\]|\\]/.test(route.path)) {
      problems.push(`${routeKey(route)}: path still contains regular-expression syntax`);
    }
  }

  return problems;
}
