import { api } from './api';
import { usePermissionStore } from '@/store/permissionStore';
import type {
  ApiResponse,
  AuditLogPage,
  CompanyRole,
  CompanyUser,
  CompanyUsersPayload,
  EffectivePermissions,
  InvitePreview,
  Permission,
  PermissionModule,
} from '@/types';

// No companyId travels from the client — the backend derives the tenant from
// the access token's claim. See khatavala-backend/docs/TENANCY.md.

/* ------------------------------------------------------------ permissions */

/**
 * Loads the caller's permissions for the active company into the store.
 * Called on boot and after every company switch — permissions are per-company,
 * so a switch invalidates them completely.
 */
export async function loadPermissions(): Promise<EffectivePermissions> {
  const { data } = await api.get<ApiResponse<EffectivePermissions>>(
    '/users/me/permissions'
  );
  const payload = data.data!;
  usePermissionStore
    .getState()
    .setPermissions(payload.roleName, payload.effectivePermissions);
  return payload;
}

export async function listAvailablePermissions(): Promise<PermissionModule[]> {
  const { data } = await api.get<ApiResponse<{ modules: PermissionModule[] }>>(
    '/roles/permissions'
  );
  return data.data!.modules;
}

/* ------------------------------------------------------------------ users */

export async function listCompanyUsers(): Promise<CompanyUsersPayload> {
  const { data } = await api.get<ApiResponse<CompanyUsersPayload>>('/users');
  return data.data!;
}

export interface InviteResult {
  _id: string;
  email: string;
  roleName: string;
  roleId: string;
  status: string;
  expiresAt: string;
  emailSent: boolean;
  emailError: string | null;
  rawToken: string;
  inviteLink: string;
}

export async function inviteUser(input: {
  email: string;
  roleId: string;
}): Promise<InviteResult> {
  const { data } = await api.post<ApiResponse<{ invite: InviteResult }>>('/users/invite', input);
  return data.data!.invite;
}

export async function updateUserRole(
  userId: string,
  roleIdOrIds: string | string[]
): Promise<void> {
  const payload = Array.isArray(roleIdOrIds)
    ? { roleIds: roleIdOrIds }
    : { roleId: roleIdOrIds };
  await api.patch(`/users/${userId}/role`, payload);
}

export async function revokeAccess(userId: string): Promise<void> {
  await api.delete(`/users/${userId}`);
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await api.delete(`/users/invites/${inviteId}`);
}

/* ------------------------------------------------------------------ roles */

export async function listRoles(): Promise<CompanyRole[]> {
  const { data } = await api.get<ApiResponse<{ roles: CompanyRole[] }>>('/roles');
  return data.data!.roles;
}

export async function createRole(input: {
  name: string;
  description?: string;
  permissions: Permission[];
}): Promise<CompanyRole> {
  const { data } = await api.post<ApiResponse<{ role: CompanyRole }>>('/roles', input);
  return data.data!.role;
}

export async function updateRole(
  roleId: string,
  input: { name?: string; description?: string; permissions?: Permission[] }
): Promise<CompanyRole> {
  const { data } = await api.patch<ApiResponse<{ role: CompanyRole }>>(
    `/roles/${roleId}`,
    input
  );
  return data.data!.role;
}

export async function duplicateRole(roleId: string, name: string): Promise<CompanyRole> {
  const { data } = await api.post<ApiResponse<{ role: CompanyRole }>>(
    `/roles/${roleId}/duplicate`,
    { name }
  );
  return data.data!.role;
}

export async function deleteRole(roleId: string): Promise<void> {
  await api.delete(`/roles/${roleId}`);
}

/* -------------------------------------------------------------- audit log */

export interface AuditFilters {
  action?: string;
  entityName?: string;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function listAuditLogs(filters: AuditFilters = {}): Promise<AuditLogPage> {
  // Empty strings are dropped rather than sent — the backend would treat
  // `?action=` as a filter for the literal empty action and return nothing.
  const params = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value != null)
  );
  const { data } = await api.get<ApiResponse<AuditLogPage>>('/audit-logs', { params });
  return data.data!;
}

export async function auditFilterOptions(): Promise<{
  actions: string[];
  entities: string[];
}> {
  const { data } = await api.get<ApiResponse<{ actions: string[]; entities: string[] }>>(
    '/audit-logs/filters'
  );
  return data.data!;
}

/* ------------------------------------------------- invitation acceptance */

// Public endpoints: the invitee has no session yet.

export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data } = await api.get<ApiResponse<{ invite: InvitePreview }>>(
    `/auth/invites/${token}`
  );
  return data.data!.invite;
}

export async function acceptInvite(input: {
  token: string;
  fullName?: string;
  password?: string;
}): Promise<{ email: string; roleName: string }> {
  const { data } = await api.post<ApiResponse<{ email: string; roleName: string }>>(
    '/auth/accept-invite',
    input
  );
  return data.data!;
}

export type { CompanyUser };
