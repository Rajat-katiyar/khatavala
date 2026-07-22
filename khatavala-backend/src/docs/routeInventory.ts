import type { Express } from 'express';
import type { ZodTypeAny } from 'zod';
import { VALIDATION_META } from '../middlewares/validate.js';
import { PERMISSION_META } from '../services/permission.service.js';

/**
 * THE LIST OF ENDPOINTS THIS API ACTUALLY SERVES, read from the live Express
 * router stack rather than written by hand.
 *
 * WHY DERIVE IT
 * -------------
 * A hand-maintained OpenAPI document has two failure modes and both are quiet:
 * an endpoint that exists but is undocumented, and an endpoint that is
 * documented but was renamed or removed. Readers trust the document either way,
 * which is worse than having no document.
 *
 * Walking the router means the path list cannot drift: every route reaching this
 * inventory is one Express will really match, and anything deleted from the code
 * disappears from the spec on the next boot. The per-endpoint DETAIL (summary,
 * request schema, permission) is still authored by hand in openapi.ts — but the
 * completeness check there compares the two, so a new route with no metadata is
 * reported rather than silently omitted.
 *
 * Express does not expose mount paths directly; it keeps them as the regexes it
 * matches with, so they have to be reconstructed. That is the awkward part
 * below, and it is why this lives in one place with tests behind it.
 */

export interface RouteEntry {
  method: string;
  /** Express-style path, e.g. `/api/sales/invoices/:id/pdf`. */
  path: string;
  /** True when `authenticate` guards the route, directly or by inheritance. */
  authenticated: boolean;
  /** `module.action` keys the caller must hold. Multiple = any one suffices. */
  permissions: string[];
  /** Request schemas recovered from the `validate()` middleware on the route. */
  validation: { schema: ZodTypeAny; source: 'body' | 'query' | 'params' }[];
}

/**
 * Middleware mounted with `router.use(...)` guards every route registered after
 * it in that router, and nested routers inherit their parent's. Collecting them
 * as the walk descends is what lets an endpoint report the auth and permission
 * it actually enforces, rather than only what is listed on its own line.
 */
function readMiddleware(handles: any[], into: RouteEntry): void {
  for (const handle of handles) {
    if (typeof handle !== 'function') continue;
    if (handle.name === 'authenticate') into.authenticated = true;

    const permissions = handle[PERMISSION_META];
    if (Array.isArray(permissions)) {
      for (const permission of permissions) {
        if (!into.permissions.includes(permission)) into.permissions.push(permission);
      }
      // Permission checks are unreachable without a caller, so an endpoint that
      // has one is authenticated even where the guard sits on an outer router.
      into.authenticated = true;
    }

    const validation = handle[VALIDATION_META];
    if (validation) into.validation.push(validation);
  }
}

/**
 * Turns a layer's regexp back into the literal path it was mounted at.
 *
 * Express compiles `router.use('/sales', ...)` into `/^\/sales\/?(?=\/|$)/i`.
 * There is no public API for the original string, so it is recovered from the
 * source. Layers that match everything (the app-level middleware) yield '' and
 * contribute nothing to the path.
 */
function mountPathOf(layer: any): string {
  if (layer.path) return layer.path;

  const source: string | undefined = layer.regexp?.source;
  if (!source) return '';

  // The catch-all Express uses for `app.use(fn)` — no path segment at all.
  if (source === '^\\/?$' || source === '^\\/?(?=\\/|$)') return '';

  const cleaned = source
    .replace('^', '')
    .replace('\\/?(?=\\/|$)', '')
    .replace('(?=\\/|$)', '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');

  // Anything still containing regex syntax is a pattern we cannot name; better
  // to return nothing than to invent a path that does not exist.
  return /[?+*()[\]|]/.test(cleaned) ? '' : cleaned;
}

/**
 * Restores `:param` names.
 *
 * A layer with parameters compiles them to `(?:([^\/]+?))`, losing the name —
 * but `layer.keys` preserves the names in order, so they can be substituted
 * back in.
 */
function withParamNames(path: string, keys: { name: string | number }[]): string {
  if (keys.length === 0) return path;

  let index = 0;
  return path.replace(/\(\?:\(\[\^\\?\/\]\+\?\)\)/g, () => {
    const key = keys[index++];
    return key ? `:${key.name}` : ':param';
  });
}

function walk(stack: any[], prefix: string, out: RouteEntry[], inherited: any[] = []): void {
  // Middleware seen so far in THIS router, which applies to routes below it.
  const scope = [...inherited];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path as string;
      const full = `${prefix}${routePath}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

      for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
        // Express registers a HEAD handler alongside every GET; documenting it
        // would double the spec for no reader benefit.
        if (!enabled || method === '_all' || method === 'head') continue;

        const entry: RouteEntry = {
          method: method.toUpperCase(),
          path: full,
          authenticated: false,
          permissions: [],
          validation: [],
        };
        readMiddleware(scope, entry);
        readMiddleware((layer.route.stack ?? []).map((l: any) => l.handle), entry);
        out.push(entry);
      }
      continue;
    }

    // A mounted sub-router: recurse with its path folded into the prefix.
    if (layer.name === 'router' && layer.handle?.stack) {
      const mounted = withParamNames(mountPathOf(layer), layer.keys ?? []);
      walk(layer.handle.stack, `${prefix}${mounted}`, out, scope);
      continue;
    }

    // A bare `router.use(fn)` — guards everything registered after it here.
    if (typeof layer.handle === 'function' && !layer.route) scope.push(layer.handle);
  }
}

/** Every endpoint the app serves, sorted for stable comparison. */
export function collectRoutes(app: Express): RouteEntry[] {
  const stack = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
  const routes: RouteEntry[] = [];
  walk(stack, '', routes);

  // Deduplicate: a path registered on several routers appears once per mount.
  const seen = new Set<string>();
  return routes
    .filter((route) => {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** `GET /api/sales/invoices/:id` — the key the OpenAPI registry is checked against. */
export const routeKey = (route: RouteEntry): string => `${route.method} ${route.path}`;
