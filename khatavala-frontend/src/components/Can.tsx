import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePermissionStore } from '@/store/permissionStore';
import type { Permission } from '@/types';

/**
 * Conditional rendering by permission.
 *
 *   <Can permission="users.invite"><Button>Invite</Button></Can>
 *   <Can anyOf={['sales.create', 'sales.update']}>…</Can>
 *
 * Hiding a control is a courtesy, not a defence — the backend rejects the
 * request either way. See store/permissionStore.ts.
 */
export function Can({
  permission,
  anyOf,
  fallback = null,
  children,
}: {
  permission?: Permission;
  anyOf?: Permission[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const can = usePermissionStore((s) => s.can);
  const canAny = usePermissionStore((s) => s.canAny);
  // Subscribe to the set itself so a permission refresh re-renders: `can` is a
  // stable function reference, so depending on it alone would not re-run.
  usePermissionStore((s) => s.permissions);

  const allowed = permission ? can(permission) : anyOf ? canAny(...anyOf) : false;
  return <>{allowed ? children : fallback}</>;
}

/**
 * Route-level guard. Wrap a route element to keep a whole page out of reach:
 *
 *   { element: <RequirePermission permission="audit.view" />,
 *     children: [{ path: 'settings/activity-log', element: <ActivityLog /> }] }
 *
 * Waits for `loaded` before deciding. Redirecting during the initial fetch
 * would bounce legitimate users off the page they just navigated to.
 */
export function RequirePermission({
  permission,
  anyOf,
}: {
  permission?: Permission;
  anyOf?: Permission[];
}) {
  const loaded = usePermissionStore((s) => s.loaded);
  const can = usePermissionStore((s) => s.can);
  const canAny = usePermissionStore((s) => s.canAny);
  usePermissionStore((s) => s.permissions);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Checking permissions…</p>;
  }

  const allowed = permission ? can(permission) : anyOf ? canAny(...anyOf) : false;
  if (!allowed) return <Navigate to="/no-access" replace />;

  return <Outlet />;
}
