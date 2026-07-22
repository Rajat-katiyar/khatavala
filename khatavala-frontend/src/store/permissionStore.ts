import { create } from 'zustand';
import type { Permission } from '@/types';

interface PermissionState {
  /** Concrete `module.action` keys the user holds in the ACTIVE company. */
  permissions: Set<Permission>;
  roleName: string | null;

  /**
   * False until the first fetch resolves. UI must gate on this before deciding
   * something is forbidden — rendering a "no access" state during the initial
   * load would flash a denial at users who are in fact allowed.
   */
  loaded: boolean;

  setPermissions: (roleName: string, permissions: Permission[]) => void;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  /** Any permission in a module — "should this nav item exist at all?" */
  canModule: (module: string) => boolean;
  reset: () => void;
}

/**
  Client-side permissions are a UX affordance, NOT a security boundary.
  Everything here does is hide controls the user would be denied on anyway.
  The authoritative check lives in the backend's `requirePermission`
  middleware, which runs on every request regardless of what this store says.
 */
export const usePermissionStore = create<PermissionState>((set, get) => ({
  permissions: new Set(),
  roleName: null,
  loaded: false,

  setPermissions: (roleName, permissions) =>
    set({ roleName, permissions: new Set(permissions), loaded: true }),

  can: (permission) => {
    const { roleName, permissions: userPerms } = get();
    if (roleName === 'SuperAdmin') return true;
    return userPerms.has(permission);
  },

  canAny: (...permsToCheck) => {
    const { roleName, permissions: userPerms } = get();
    if (roleName === 'SuperAdmin') return true;
    return permsToCheck.some((p) => userPerms.has(p));
  },

  canModule: (moduleName) => {
    const { roleName, permissions: userPerms } = get();
    if (roleName === 'SuperAdmin') return true;
    const prefix = `${moduleName}.`;
    for (const p of userPerms) {
      if (p.startsWith(prefix)) return true;
    }
    return false;
  },

  reset: () => set({ permissions: new Set(), roleName: null, loaded: false }),
}));
