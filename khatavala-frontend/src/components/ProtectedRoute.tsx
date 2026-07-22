import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { usePermissionStore } from '@/store/permissionStore';
import { bootstrapCompanies } from '@/services/company.service';
import type { Role } from '@/types';

interface ProtectedRouteProps {
  /** When set, the signed-in user must hold one of these roles. */
  allowedRoles?: Role[];
  children?: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const permissionsLoaded = usePermissionStore((s) => s.loaded);

  const bootstrappedRef = useRef(false);
  const [loading, setLoading] = useState(!permissionsLoaded);

  useEffect(() => {
    if (isAuthenticated && user && !bootstrappedRef.current) {
      bootstrappedRef.current = true;
      bootstrapCompanies()
        .catch((err) => {
          console.error('Failed to bootstrap companies/permissions', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isAuthenticated, user]);

  if (!isAuthenticated || !user) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (loading && !permissionsLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-muted-foreground text-sm gap-3">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>Loading workspace...</span>
      </div>
    );
  }

  // If user has no active company and is not on company wizard page, direct them to create one
  if (!activeCompany && location.pathname !== '/companies/new') {
    return <Navigate to="/companies/new" replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
