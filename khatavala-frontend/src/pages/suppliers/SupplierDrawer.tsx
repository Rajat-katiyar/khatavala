import { useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
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
import * as supplierService from '@/services/supplier.service';
import type { CustomerAddress, Supplier } from '@/types';

interface FormState {
  name: string;
  phone: string;
  email: string;
  gstNumber: string;
  pan: string;
  openingBalance: string;
  vendorRating: number | null;
  address: CustomerAddress;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  email: '',
  gstNumber: '',
  pan: '',
  openingBalance: '',
  vendorRating: null,
  address: {},
};

const toForm = (supplier: Supplier): FormState => ({
  name: supplier.name,
  phone: supplier.phone,
  email: supplier.email ?? '',
  gstNumber: supplier.gstNumber ?? '',
  pan: supplier.pan ?? '',
  openingBalance: String(supplier.openingBalance ?? ''),
  vendorRating: supplier.vendorRating,
  address: supplier.address ?? {},
});

function RatingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          // Clicking the current rating clears it — otherwise a rating set by
          // accident can never be removed.
          onClick={() => onChange(value === star ? null : star)}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          aria-pressed={value === star}
          className="p-0.5 text-muted-foreground hover:text-amber-500"
        >
          <Star
            className={`h-5 w-5 ${
              value !== null && star <= value ? 'fill-amber-400 text-amber-400' : ''
            }`}
          />
        </button>
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        {value === null ? 'Not rated' : `${value}/5 — click again to clear`}
      </span>
    </div>
  );
}

export function SupplierDrawer({
  open,
  onOpenChange,
  supplier,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null opens the drawer in create mode. */
  supplier: Supplier | null;
  onSaved: () => void;
}) {
  const isEdit = supplier !== null;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open so a previous edit's values never bleed into the next
  // one — the drawer stays mounted between opens.
  useEffect(() => {
    if (!open) return;
    setForm(supplier ? toForm(supplier) : EMPTY);
    setError(null);
  }, [open, supplier]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addressField = (key: keyof CustomerAddress, label: string, span?: boolean) => (
    <div className={span ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <Label htmlFor={`addr-${key}`}>{label}</Label>
      <Input
        id={`addr-${key}`}
        value={form.address[key] ?? ''}
        onChange={(e) => set('address', { ...form.address, [key]: e.target.value })}
      />
    </div>
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    // Strip blank strings so we send `{}` rather than a bag of empty keys.
    const addressEntries = Object.entries(form.address).filter(([, v]) => v && String(v).trim());

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      gstNumber: form.gstNumber.trim().toUpperCase(),
      pan: form.pan.trim().toUpperCase(),
      vendorRating: form.vendorRating,
      address: addressEntries.length > 0 ? Object.fromEntries(addressEntries) : undefined,
    };

    try {
      if (isEdit) {
        // openingBalance is deliberately absent: it is materialised as the
        // supplier's first ledger entry at creation, so the API rejects it here.
        await supplierService.updateSupplier(supplier._id, payload);
      } else {
        await supplierService.createSupplier({
          ...payload,
          openingBalance: Number(form.openingBalance || 0),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit supplier' : 'Add supplier'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Opening balance cannot be changed here — post an adjustment to the ledger instead.'
              : 'Name and phone are required. Everything else can be filled in later.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="s-name">Name *</Label>
                <Input
                  id="s-name"
                  required
                  maxLength={160}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-phone">Phone *</Label>
                <Input
                  id="s-phone"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{7,15}"
                  title="7 to 15 digits"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-email">Email</Label>
                <Input
                  id="s-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-gst">GST number</Label>
                <Input
                  id="s-gst"
                  maxLength={15}
                  placeholder="27AAPFU0939F1ZV"
                  className="font-mono uppercase"
                  value={form.gstNumber}
                  onChange={(e) => set('gstNumber', e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-pan">PAN</Label>
                <Input
                  id="s-pan"
                  maxLength={10}
                  placeholder="AAPFU0939F"
                  className="font-mono uppercase"
                  value={form.pan}
                  onChange={(e) => set('pan', e.target.value.toUpperCase())}
                />
              </div>
              {!isEdit && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="s-opening">Opening balance</Label>
                  <Input
                    id="s-opening"
                    type="number"
                    step="0.01"
                    value={form.openingBalance}
                    onChange={(e) => set('openingBalance', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Positive if <strong>you owe them</strong>; negative if you have already
                    paid in advance. Note this is the opposite direction to a customer.
                  </p>
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Vendor rating</Label>
                <RatingPicker
                  value={form.vendorRating}
                  onChange={(next) => set('vendorRating', next)}
                />
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Address</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {addressField('line1', 'Line 1', true)}
                {addressField('line2', 'Line 2', true)}
                {addressField('city', 'City')}
                {addressField('state', 'State')}
                {addressField('pincode', 'Pincode')}
              </div>
            </fieldset>

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
              {isEdit ? 'Save changes' : 'Add supplier'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
