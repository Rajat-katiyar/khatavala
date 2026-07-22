import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import * as customerService from '@/services/customer.service';
import type { Customer, CustomerAddress } from '@/types';

interface FormState {
  name: string;
  phone: string;
  email: string;
  gstNumber: string;
  pan: string;
  creditLimit: string;
  openingBalance: string;
  billing: CustomerAddress;
  shipping: CustomerAddress;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  email: '',
  gstNumber: '',
  pan: '',
  creditLimit: '',
  openingBalance: '',
  billing: {},
  shipping: {},
};

const toForm = (customer: Customer): FormState => ({
  name: customer.name,
  phone: customer.phone,
  email: customer.email ?? '',
  gstNumber: customer.gstNumber ?? '',
  pan: customer.pan ?? '',
  creditLimit: String(customer.creditLimit ?? ''),
  openingBalance: String(customer.openingBalance ?? ''),
  billing: customer.billingAddress ?? {},
  shipping: customer.shippingAddress ?? {},
});

function AddressFields({
  legend,
  value,
  onChange,
  idPrefix,
}: {
  legend: string;
  value: CustomerAddress;
  onChange: (next: CustomerAddress) => void;
  idPrefix: string;
}) {
  const field = (key: keyof CustomerAddress, label: string, span?: boolean) => (
    <div className={span ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${key}`}
        value={value[key] ?? ''}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('line1', 'Line 1', true)}
        {field('line2', 'Line 2', true)}
        {field('city', 'City')}
        {field('state', 'State')}
        {field('pincode', 'Pincode')}
      </div>
    </fieldset>
  );
}

export function CustomerDrawer({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null opens the drawer in create mode. */
  customer: Customer | null;
  onSaved: () => void;
}) {
  const isEdit = customer !== null;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open so a previous edit's values never bleed into the next
  // one — the drawer stays mounted between opens.
  useEffect(() => {
    if (!open) return;
    setForm(customer ? toForm(customer) : EMPTY);
    setError(null);
  }, [open, customer]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Strips blank strings from an address so we send `{}` rather than a bag of
  // empty keys the API would faithfully store.
  const cleanAddress = (address: CustomerAddress) => {
    const entries = Object.entries(address).filter(([, v]) => v && String(v).trim());
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      gstNumber: form.gstNumber.trim().toUpperCase(),
      pan: form.pan.trim().toUpperCase(),
      creditLimit: Number(form.creditLimit || 0),
      billingAddress: cleanAddress(form.billing),
      shippingAddress: cleanAddress(form.shipping),
    };

    try {
      if (isEdit) {
        // openingBalance is deliberately absent: it is materialised as the
        // customer's first ledger entry at creation, so the API rejects it here.
        await customerService.updateCustomer(customer._id, payload);
      } else {
        await customerService.createCustomer({
          ...payload,
          openingBalance: Number(form.openingBalance || 0),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit customer' : 'Add customer'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Opening balance cannot be changed here — post an adjustment to the ledger instead.'
              : 'Name and phone are required. Everything else can be filled in later.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
          id="customer-form"
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-name">Name *</Label>
                <Input
                  id="c-name"
                  required
                  maxLength={160}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">Phone *</Label>
                <Input
                  id="c-phone"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{7,15}"
                  title="7 to 15 digits"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-gst">GST number</Label>
                <Input
                  id="c-gst"
                  maxLength={15}
                  placeholder="27AAPFU0939F1ZV"
                  className="font-mono uppercase"
                  value={form.gstNumber}
                  onChange={(e) => set('gstNumber', e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-pan">PAN</Label>
                <Input
                  id="c-pan"
                  maxLength={10}
                  placeholder="AAPFU0939F"
                  className="font-mono uppercase"
                  value={form.pan}
                  onChange={(e) => set('pan', e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-credit">Credit limit</Label>
                <Input
                  id="c-credit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.creditLimit}
                  onChange={(e) => set('creditLimit', e.target.value)}
                />
              </div>
              {!isEdit && (
                <div className="space-y-1.5">
                  <Label htmlFor="c-opening">Opening balance</Label>
                  <Input
                    id="c-opening"
                    type="number"
                    step="0.01"
                    value={form.openingBalance}
                    onChange={(e) => set('openingBalance', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Positive if they owe you; negative if they have paid in advance.
                  </p>
                </div>
              )}
            </div>

            <AddressFields
              legend="Billing address"
              idPrefix="bill"
              value={form.billing}
              onChange={(next) => set('billing', next)}
            />

            <div className="space-y-2">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => set('shipping', { ...form.billing })}
              >
                Copy billing address to shipping
              </button>
              <AddressFields
                legend="Shipping address"
                idPrefix="ship"
                value={form.shipping}
                onChange={(next) => set('shipping', next)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save changes' : 'Add customer'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
