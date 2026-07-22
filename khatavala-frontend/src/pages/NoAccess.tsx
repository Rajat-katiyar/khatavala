import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissionStore } from '@/store/permissionStore';

/**
 * Where `RequirePermission` sends a user who lacks a page's permission.
 *
 * Says which role they hold rather than just "denied" — the usual next step is
 * asking an admin for access, and that conversation goes better when the user
 * can name their current role.
 */
export function NoAccess() {
  const roleName = usePermissionStore((s) => s.roleName);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You don't have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {roleName
          ? `Your role in this company is ${roleName}, which doesn't include this area.`
          : "Your role in this company doesn't include this area."}{' '}
        Ask an Owner or Manager if you need it.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
