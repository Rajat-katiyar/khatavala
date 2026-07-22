import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Lock, Plus, Trash2, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { usePermissionStore } from '@/store/permissionStore';
import * as rbac from '@/services/rbac.service';
import type { CompanyRole, Permission, PermissionModule } from '@/types';

/**
 * The permission matrix. One row per module, one checkbox per action, plus a
 * per-row "all" toggle — with ~11 modules and 4-5 actions each, ticking 40+
 * boxes by hand to build a role is not a usable flow.
 */
function PermissionMatrix({
  modules,
  selected,
  onToggle,
  onToggleModule,
  readOnly = false,
}: {
  modules: PermissionModule[];
  selected: Set<Permission>;
  onToggle: (key: Permission) => void;
  onToggleModule: (module: PermissionModule, on: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-1 overflow-x-auto">
      {modules.map((module) => {
        const keys = module.actions.map((a) => a.key);
        const allOn = keys.every((k) => selected.has(k));
        const someOn = !allOn && keys.some((k) => selected.has(k));

        return (
          <div
            key={module.module}
            className="grid grid-cols-1 gap-2 border-b py-3 last:border-0 sm:grid-cols-[220px_1fr]"
          >
            <div>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input cursor-pointer"
                  checked={allOn}
                  disabled={readOnly}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn;
                  }}
                  onChange={(e) => onToggleModule(module, e.target.checked)}
                  aria-label={`All ${module.label} permissions`}
                />
                {module.label}
              </label>
              <p className="ml-6 text-xs text-muted-foreground">{module.description}</p>
            </div>

            <div className="ml-6 flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-0">
              {module.actions.map(({ action, key }) => (
                <label
                  key={key}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input cursor-pointer"
                    checked={selected.has(key)}
                    disabled={readOnly}
                    onChange={() => onToggle(key)}
                    aria-label={key}
                  />
                  {action}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const emptyForm = { name: '', description: '' };

export function SettingsRoles() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  usePermissionStore((s) => s.permissions);

  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [modules, setModules] = useState<PermissionModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  /** null = creating; a role = editing that role. */
  const [editing, setEditing] = useState<CompanyRole | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const [roleList, moduleList] = await Promise.all([
        rbac.listRoles(),
        rbac.listAvailablePermissions(),
      ]);
      setRoles(roleList);
      setModules(moduleList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load roles');
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    setRoles([]);
    void load();
  }, [load, tenantVersion]);

  const totalPermissions = useMemo(
    () => modules.reduce((sum, m) => sum + m.actions.length, 0),
    [modules]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSelected(new Set());
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (role: CompanyRole) => {
    setEditing(role);
    setForm({ name: role.name, description: role.description });
    // Seed from the EXPANDED list
    setSelected(new Set(role.effectivePermissions));
    setEditorError(null);
    setEditorOpen(true);
  };

  const toggle = (key: Permission) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleModule = (module: PermissionModule, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      module.actions.forEach(({ key }) => (on ? next.add(key) : next.delete(key)));
      return next;
    });

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setEditorError(null);
    setSaving(true);
    try {
      const permissions = [...selected];
      if (editing) {
        await rbac.updateRole(editing._id, {
          name: form.name.trim(),
          description: form.description.trim(),
          permissions,
        });
      } else {
        await rbac.createRole({
          name: form.name.trim(),
          description: form.description.trim(),
          permissions,
        });
      }
      setEditorOpen(false);
      await load();
      await rbac.loadPermissions();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Could not save the role');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (role: CompanyRole) => {
    const name = window.prompt(`Name for the copy of "${role.name}":`, `${role.name} (copy)`);
    if (!name) return;
    try {
      await rbac.duplicateRole(role._id, name.trim());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not duplicate the role');
    }
  };

  const handleDelete = async (role: CompanyRole) => {
    if (!window.confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;
    try {
      await rbac.deleteRole(role._id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the role');
    }
  };

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">Select a company to manage roles.</p>
    );
  }

  // Only Owner root role is read-only; all other built-in and custom roles are editable
  const readOnlyEditor = Boolean(editing?.isSystem && editing?.name === 'Owner');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Configure permissions for each role in {activeCompany.name}
          </p>
        </div>
        <Can permission="roles.create">
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New role
          </Button>
        </Can>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role._id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {role.name}
                    {role.isSystem && (
                      <Badge variant="secondary">
                        <Lock className="mr-1 h-3 w-3" />
                        Built-in
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{role.description}</CardDescription>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Can permission="roles.create">
                    <button
                      onClick={() => handleDuplicate(role)}
                      aria-label={`Duplicate ${role.name}`}
                      title="Duplicate Role"
                      className="text-muted-foreground hover:text-foreground p-1 rounded"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </Can>
                  {!role.isSystem && (
                    <Can permission="roles.delete">
                      <button
                        onClick={() => handleDelete(role)}
                        aria-label={`Delete ${role.name}`}
                        title="Delete Role"
                        className="text-muted-foreground hover:text-destructive p-1 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Can>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {role.effectivePermissions.length} of {totalPermissions || '—'}{' '}
                permissions · {role.userCount} user(s) assigned
              </p>
              <Button
                variant={role.name === 'Owner' ? 'outline' : 'default'}
                size="sm"
                onClick={() => openEdit(role)}
                className="gap-1.5 text-xs font-semibold"
              >
                {role.name === 'Owner' ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> View permissions
                  </>
                ) : (
                  <>
                    <Edit className="w-3.5 h-3.5" /> Edit Permissions
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `${readOnlyEditor ? 'Permissions for' : 'Edit Permissions —'} ${editing.name}` : 'New Role'}
        description={
          readOnlyEditor
            ? "The 'Owner' role is the root system role and cannot be modified."
            : 'Select or unselect permissions for this role below.'
        }
        className="max-w-3xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                required
                disabled={readOnlyEditor || Boolean(editing?.isSystem)}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Input
                id="role-description"
                disabled={readOnlyEditor}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border p-4 bg-background">
            <PermissionMatrix
              modules={modules}
              selected={selected}
              onToggle={toggle}
              onToggleModule={toggleModule}
              readOnly={readOnlyEditor}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {selected.size} permission(s) selected
          </p>

          {editorError && (
            <p className="text-sm text-destructive">{editorError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </Button>
            {!readOnlyEditor && (
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : 'Save permissions'}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
