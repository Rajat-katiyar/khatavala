import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import * as companyService from '@/services/company.service';
import { MONTHS, type Role } from '@/types';

// Mirrors COMPANY_EDITORS on the backend. This only hides the controls — the
// server enforces the rule regardless of what the client renders.
const EDITOR_ROLES: Role[] = ['SuperAdmin', 'Owner', 'Manager'];

export function CompanySettings() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const activeRole = useCompanyStore((s) => s.activeRole);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the active company changes — otherwise switching companies
  // while this page is open would leave the previous company's values in the
  // inputs and save them onto the new one.
  useEffect(() => {
    if (!activeCompany) return;
    setValues({
      name: activeCompany.name ?? '',
      gstNumber: activeCompany.gstNumber ?? '',
      panNumber: activeCompany.panNumber ?? '',
      line1: activeCompany.address?.line1 ?? '',
      city: activeCompany.address?.city ?? '',
      pincode: activeCompany.address?.pincode ?? '',
      state: activeCompany.state ?? '',
      financialYearStart: String(activeCompany.financialYearStart ?? 4),
      currency: activeCompany.currency ?? 'INR',
      timeZone: activeCompany.timeZone ?? 'Asia/Kolkata',
      invoicePrefix: activeCompany.invoicePrefix ?? 'INV',
      logoUrl: activeCompany.logoUrl ?? '',
    });
    setStatus('idle');
    setError(null);
  }, [activeCompany, tenantVersion]);

  const canEdit = !!activeRole && EDITOR_ROLES.includes(activeRole);

  const set = (field: string) => (event: React.ChangeEvent<HTMLElement>) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    setValues((prev) => ({ ...prev, [field]: target.value }));
    setStatus('idle');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeCompany) return;

    setStatus('saving');
    setError(null);
    try {
      await companyService.updateCompany(activeCompany._id, {
        name: values.name,
        // Omit blank optional fields rather than sending '' — the backend
        // validates the format of anything it receives.
        ...(values.gstNumber && { gstNumber: values.gstNumber.toUpperCase() }),
        ...(values.panNumber && { panNumber: values.panNumber.toUpperCase() }),
        address: {
          ...(values.line1 && { line1: values.line1 }),
          ...(values.city && { city: values.city }),
          ...(values.pincode && { pincode: values.pincode }),
        },
        ...(values.state && { state: values.state }),
        financialYearStart: Number(values.financialYearStart),
        currency: values.currency.toUpperCase(),
        timeZone: values.timeZone,
        invoicePrefix: values.invoicePrefix.toUpperCase(),
        ...(values.logoUrl && { logoUrl: values.logoUrl }),
      });
      setStatus('saved');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Could not save changes');
    }
  };

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Select or create a company to edit its profile.
      </p>
    );
  }

  const field = (name: string, label: string, props: React.ComponentProps<'input'> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        value={values[name] ?? ''}
        onChange={set(name)}
        disabled={!canEdit}
        {...props}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Company settings</CardTitle>
          <CardDescription>
            Editing <span className="font-medium">{activeCompany.name}</span> — you are{' '}
            {activeRole} here.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!canEdit && (
            <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Your role in this company does not allow editing the profile.
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            {field('name', 'Company name')}

            <div className="grid gap-4 sm:grid-cols-2">
              {field('gstNumber', 'GSTIN', { maxLength: 15, className: 'uppercase' })}
              {field('panNumber', 'PAN', { maxLength: 10, className: 'uppercase' })}
            </div>

            {field('line1', 'Address')}
            <div className="grid gap-4 sm:grid-cols-3">
              {field('city', 'City')}
              {field('state', 'State')}
              {field('pincode', 'Pincode')}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="financialYearStart">Financial year starts</Label>
                <select
                  id="financialYearStart"
                  value={values.financialYearStart ?? '4'}
                  onChange={set('financialYearStart')}
                  disabled={!canEdit}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                >
                  {MONTHS.map((month, i) => (
                    <option key={month} value={i + 1}>
                      {month}
                    </option>
                  ))}
                </select>
              </div>
              {field('currency', 'Currency', { maxLength: 3, className: 'uppercase' })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {field('timeZone', 'Time zone')}
              {field('invoicePrefix', 'Invoice prefix', {
                maxLength: 10,
                className: 'uppercase',
              })}
            </div>

            {field('logoUrl', 'Logo URL')}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {status === 'saved' && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">Company profile updated.</p>
            )}

            {canEdit && (
              <Button type="submit" disabled={status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
