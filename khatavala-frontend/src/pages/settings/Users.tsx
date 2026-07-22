import { useCallback, useEffect, useState } from 'react';
import { Mail, ShieldOff, UserPlus, X, Edit2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Can } from '@/components/Can';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { usePermissionStore } from '@/store/permissionStore';
import * as rbac from '@/services/rbac.service';
import type { CompanyRole, CompanyUser, PendingInvite } from '@/types';

/** Built-in roles get a distinct badge from custom ones, so the table shows
 *  at a glance which roles are the platform's and which the company invented. */
function RoleBadge({ name, isSystem }: { name: string; isSystem: boolean }) {
  return (
    <Badge variant={isSystem ? 'secondary' : 'outline'} title={isSystem ? 'Built-in role' : 'Custom role'}>
      {name}
    </Badge>
  );
}

export function SettingsUsers() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currentUserId = useAuthStore((s) => s.user?._id);
  const currentUserRole = useAuthStore((s) => s.user?.role);
  const can = usePermissionStore((s) => s.can);
  const roleName = usePermissionStore((s) => s.roleName);
  usePermissionStore((s) => s.permissions);

  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoleIds, setEditingRoleIds] = useState<string[]>([]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', roleId: '' });
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);
  const [createdInviteDetails, setCreatedInviteDetails] = useState<{ email: string; roleName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const [payload, roleList] = await Promise.all([
        rbac.listCompanyUsers(),
        rbac.listRoles().catch(() => []),
      ]);
      setUsers(payload.users);
      setInvites(payload.invites);
      setRoles(roleList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  // tenantVersion is the refetch trigger — same pattern as Products.
  useEffect(() => {
    setUsers([]);
    setInvites([]);
    void load();
  }, [load, tenantVersion]);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      const res = await rbac.inviteUser({
        email: inviteForm.email.trim(),
        roleId: inviteForm.roleId,
      });
      const link = `${window.location.origin}/accept-invite?token=${res.rawToken}`;
      setCreatedInviteLink(link);
      setCreatedInviteDetails({ email: res.email, roleName: res.roleName });
      setNotice(`Invitation created for ${res.email}`);
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, roleIds: string[]) => {
    if (roleIds.length === 0) {
      setError('Please select at least one role for the user.');
      return;
    }
    setError(null);
    try {
      await rbac.updateUserRole(userId, roleIds);
      setNotice('User roles updated successfully');
      setEditingUserId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update roles');
      await load();
    }
  };

  const toggleRoleSelection = (roleId: string) => {
    setEditingRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const handleRevoke = async (user: CompanyUser) => {
    if (!window.confirm(`Revoke ${user.fullName}'s access to ${activeCompany?.name}?`)) {
      return;
    }
    setError(null);
    try {
      await rbac.revokeAccess(user.userId);
      setNotice(`${user.fullName} no longer has access`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke access');
    }
  };

  const handleRevokeInvite = async (invite: PendingInvite) => {
    try {
      await rbac.revokeInvite(invite._id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the invitation');
    }
  };

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a company to manage its users.
      </p>
    );
  }

  const isOwnerOrAdmin = roleName === 'Owner' || roleName === 'SuperAdmin' || currentUserRole === 'SuperAdmin';
  const canUpdateRoles = isOwnerOrAdmin || can('users.update');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Company Users & Roles</h1>
          <p className="text-sm text-muted-foreground">
            Manage members and assigned roles for {activeCompany.name}
          </p>
        </div>
        <Can permission="users.invite">
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite user
          </Button>
        </Can>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 p-3 text-sm flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs hover:underline">Dismiss</button>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members & Assigned Roles</CardTitle>
          <CardDescription>
            {loading ? 'Loading…' : `${users.length} member(s) in this company`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!loading && users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2.5 font-medium">Member Name</th>
                    <th className="py-2.5 font-medium">Email</th>
                    <th className="py-2.5 font-medium">Assigned Role</th>
                    <th className="py-2.5 font-medium">Status</th>
                    <th className="py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.userId === currentUserId;
                    const isEditingThisUser = editingUserId === user.userId;

                    return (
                      <tr key={user.membershipId} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="py-3 font-medium">
                          {user.fullName}
                          {isSelf && (
                            <span className="ml-2 text-xs text-primary font-normal">(you)</span>
                          )}
                        </td>
                        <td className="py-3 text-muted-foreground">{user.email}</td>
                        <td className="py-3">
                          {isEditingThisUser && roles.length > 0 ? (
                            <div className="flex flex-col gap-2 bg-muted/30 p-2 rounded-md border">
                              <span className="text-xs font-medium text-muted-foreground">Select Role(s):</span>
                              <div className="flex flex-wrap gap-2 max-w-xs">
                                {roles.map((role) => {
                                  const checked = editingRoleIds.includes(role._id);
                                  return (
                                    <label
                                      key={role._id}
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer select-none transition-colors ${checked
                                        ? 'border-primary bg-primary/10 font-semibold text-primary'
                                        : 'border-border bg-background hover:bg-muted'
                                        }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleRoleSelection(role._id)}
                                        className="h-3.5 w-3.5 rounded border-muted text-primary focus:ring-primary"
                                      />
                                      {role.name}
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-7 px-2.5 text-xs gap-1"
                                  onClick={() => handleRoleChange(user.userId, editingRoleIds)}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Save Roles
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setEditingUserId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center flex-wrap gap-1.5">
                              {(user.roleNames ?? [user.roleName]).map((rName, idx) => (
                                <RoleBadge key={idx} name={rName} isSystem={user.isSystemRole} />
                              ))}
                              {canUpdateRoles && roles.length > 0 && user.isActive && !isSelf && (
                                <button
                                  onClick={() => {
                                    setEditingUserId(user.userId);
                                    setEditingRoleIds(user.roleIds && user.roleIds.length > 0 ? user.roleIds : user.roleId ? [user.roleId] : []);
                                  }}
                                  className="text-muted-foreground hover:text-primary p-1 rounded transition-colors"
                                  title="Change User Roles"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3">
                          {user.isActive ? (
                            <Badge variant="muted" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Active</Badge>
                          ) : (
                            <Badge variant="destructive">Revoked</Badge>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canUpdateRoles && roles.length > 0 && user.isActive && !isSelf && !isEditingThisUser && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => {
                                  setEditingUserId(user.userId);
                                  setEditingRoleIds(user.roleIds && user.roleIds.length > 0 ? user.roleIds : user.roleId ? [user.roleId] : []);
                                }}
                              >
                                <Edit2 className="w-3 h-3" /> Edit Roles
                              </Button>
                            )}
                            {user.isActive && !isSelf && (
                              <Can permission="users.revoke">
                                <button
                                  onClick={() => handleRevoke(user)}
                                  aria-label={`Revoke access for ${user.fullName}`}
                                  className="text-muted-foreground hover:text-destructive p-1 rounded"
                                  title="Revoke Access"
                                >
                                  <ShieldOff className="h-4 w-4" />
                                </button>
                              </Can>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              Invited but not yet accepted. Links expire 72 hours after sending.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite._id} className="border-b last:border-0">
                    <td className="py-2">
                      <Mail className="mr-2 inline h-3.5 w-3.5 text-muted-foreground" />
                      {invite.email}
                    </td>
                    <td className="py-2">
                      <Badge variant="outline">{invite.roleName}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      Expires {new Date(invite.expiresAt).toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <Can permission="users.invite">
                        <button
                          onClick={() => handleRevokeInvite(invite)}
                          aria-label={`Cancel invitation for ${invite.email}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setCreatedInviteLink(null);
          setCreatedInviteDetails(null);
        }}
        title={createdInviteLink ? 'User Registration Link' : 'Invite a user'}
        description={
          createdInviteLink
            ? `Share this link with ${createdInviteDetails?.email} to complete their registration.`
            : `They'll get an email with a link to join ${activeCompany.name}.`
        }
      >
        {createdInviteLink ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  Invitation Created Successfully!
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  User <span className="font-semibold">{createdInviteDetails?.email}</span> was assigned the{' '}
                  <span className="font-semibold">{createdInviteDetails?.roleName}</span> role.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Registration / Invite Link</Label>
              <div className="flex gap-2">
                <Input value={createdInviteLink} readOnly className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(createdInviteLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(createdInviteLink, '_blank')}
              >
                Open Registration Page ↗
              </Button>

              <Button
                type="button"
                onClick={() => {
                  setCreatedInviteLink(null);
                  setCreatedInviteDetails(null);
                  setInviteForm({ email: '', roleId: '' });
                  setInviteOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="person@example.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                id="invite-role"
                required
                value={inviteForm.roleId}
                onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}
              >
                <option value="" disabled>
                  Choose a role…
                </option>
                {roles.map((role) => (
                  <option key={role._id} value={role._id}>
                    {role.name}
                  </option>
                ))}
              </Select>
              {roles.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No roles available — you need permission to view roles in order to pick one.
                </p>
              )}
              {inviteForm.roleId && (
                <p className="text-xs text-muted-foreground">
                  {roles.find((r) => r._id === inviteForm.roleId)?.description}
                </p>
              )}
            </div>

            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteForm.roleId}>
                {inviting ? 'Sending…' : 'Send invitation'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
