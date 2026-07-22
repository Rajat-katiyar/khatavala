import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import * as gstService from '@/services/gst.service';
import type { GSTRate } from '@/types';

/**
 * GST Rates settings page — Phase 14
 *
 * Manage the HSN/SAC rate master: add, edit, delete entries.
 * Each entry maps an HSN/SAC code to its CGST, SGST, IGST and CESS rates.
 * These rates are used automatically when building invoice line items.
 */

interface RateForm {
  hsnCode: string;
  description: string;
  cgstPercent: string;
  sgstPercent: string;
  igstPercent: string;
  cessPercent: string;
}

const EMPTY_FORM: RateForm = {
  hsnCode: '',
  description: '',
  cgstPercent: '0',
  sgstPercent: '0',
  igstPercent: '0',
  cessPercent: '0',
};

export function GstRates() {
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [rates, setRates] = useState<GSTRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GSTRate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRates(await gstService.getGSTRates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GST rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, tenantVersion]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (rate: GSTRate) => {
    setEditingId(rate._id);
    setForm({
      hsnCode: rate.hsnCode,
      description: rate.description ?? '',
      cgstPercent: String(rate.cgstPercent),
      sgstPercent: String(rate.sgstPercent),
      igstPercent: String(rate.igstPercent),
      cessPercent: String(rate.cessPercent),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        hsnCode: form.hsnCode.trim(),
        description: form.description.trim(),
        cgstPercent: Number(form.cgstPercent),
        sgstPercent: Number(form.sgstPercent),
        igstPercent: Number(form.igstPercent),
        cessPercent: Number(form.cessPercent),
      };
      if (editingId) {
        await gstService.updateGSTRate(editingId, payload);
      } else {
        await gstService.createGSTRate(payload);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await gstService.deleteGSTRate(deleteTarget._id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const field = (key: keyof RateForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  // When CGST changes, auto-sync SGST to the same value and IGST = CGST + SGST.
  const handleCGSTChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((prev) => ({
      ...prev,
      cgstPercent: v,
      sgstPercent: v,
      igstPercent: String(Number(v) * 2),
    }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GST Rates (HSN / SAC)</h1>
          <p className="text-sm text-muted-foreground">
            Map HSN or SAC codes to their CGST, SGST, IGST and CESS rates. These are applied
            automatically when invoicing.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rate
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className={`rounded-md border ${loading ? 'opacity-60' : ''}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>HSN / SAC</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-20">CGST %</TableHead>
              <TableHead className="text-right w-20">SGST %</TableHead>
              <TableHead className="text-right w-20">IGST %</TableHead>
              <TableHead className="text-right w-20">CESS %</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : rates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No GST rates configured. Click <strong>Add Rate</strong> to get started.
                </TableCell>
              </TableRow>
            ) : (
              rates.map((rate) => (
                <TableRow key={rate._id}>
                  <TableCell className="font-mono font-medium">{rate.hsnCode}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[250px] truncate">
                    {rate.description || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{rate.cgstPercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{rate.sgstPercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{rate.igstPercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{rate.cessPercent}%</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(rate)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(rate)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit modal */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? 'Edit GST Rate' : 'Add GST Rate'}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">HSN / SAC Code *</label>
              <Input
                className="mt-1"
                placeholder="e.g. 6403"
                disabled={!!editingId}
                {...field('hsnCode')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Input className="mt-1" placeholder="e.g. Leather footwear" {...field('description')} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">CGST %</label>
              <Input
                className="mt-1"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={form.cgstPercent}
                onChange={handleCGSTChange}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">SGST %</label>
              <Input
                className="mt-1"
                type="number"
                step="0.5"
                min="0"
                max="100"
                {...field('sgstPercent')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">IGST %</label>
              <Input
                className="mt-1"
                type="number"
                step="0.5"
                min="0"
                max="100"
                {...field('igstPercent')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">CESS %</label>
              <Input
                className="mt-1"
                type="number"
                step="0.25"
                min="0"
                max="100"
                {...field('cessPercent')}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Changing CGST auto-syncs SGST and IGST (IGST = CGST + SGST). Override manually if
            needed.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.hsnCode.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? 'Save Changes' : 'Add Rate'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete GST Rate"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Delete the rate for HSN/SAC code{' '}
          <span className="font-mono font-medium">{deleteTarget?.hsnCode}</span>? Existing
          invoices are not affected.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
