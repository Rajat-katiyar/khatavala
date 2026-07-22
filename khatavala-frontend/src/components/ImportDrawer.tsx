import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ImportResult } from '@/types';

/**
 * Two-step Excel import, shared by customers and suppliers.
 *
 * The file is always validated (`dryRun`) first and the result shown, so the
 * user sees exactly what will and will not import before anything is written.
 * Committing re-parses server-side rather than trusting the preview — the
 * master list may have changed in between.
 *
 * The two sides differ only in wording and which service functions to call, so
 * those are props and the flow itself lives here once.
 */
export function ImportDrawer({
  open,
  onOpenChange,
  onImported,
  title,
  description,
  entityPlural,
  downloadTemplate,
  runImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  title: string;
  description: string;
  /** Lower-case plural used in the commit button, e.g. "suppliers". */
  entityPlural: string;
  downloadTemplate: () => Promise<void>;
  runImport: (file: File, dryRun: boolean) => Promise<ImportResult>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'template' | 'validate' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    // Clear on close so reopening starts fresh rather than showing the last
    // import's report.
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  const handleFile = async (chosen: File | null) => {
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setError(null);
    if (!chosen) return;

    setBusy('validate');
    try {
      setPreview(await runImport(chosen, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const outcome = await runImport(file, false);
      setResult(outcome);
      if (outcome.imported > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed');
    } finally {
      setBusy(null);
    }
  };

  const handleTemplate = async () => {
    setBusy('template');
    setError(null);
    try {
      await downloadTemplate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the template');
    } finally {
      setBusy(null);
    }
  };

  const report = result ?? preview;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="rounded-md border border-dashed p-4">
            <p className="text-sm font-medium">Step 1 — get the template</p>
            <p className="mb-3 text-sm text-muted-foreground">
              Includes every supported column, with notes on the required ones.
            </p>
            <Button variant="outline" onClick={handleTemplate} disabled={busy !== null}>
              {busy === 'template' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download template (.xlsx)
            </Button>
          </div>

          <div className="rounded-md border border-dashed p-4">
            <p className="text-sm font-medium">Step 2 — upload your file</p>
            <p className="mb-3 text-sm text-muted-foreground">
              .xlsx, up to 5 MB. It is checked before anything is saved.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              disabled={busy !== null}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
            {busy === 'validate' && (
              <p className="mt-2 flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking {file?.name}…
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {report && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4 rounded-md border p-3 text-sm">
                {result ? (
                  <span className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Imported {result.imported} of {result.totalRows} rows
                  </span>
                ) : (
                  <span className="font-medium">
                    {report.imported} of {report.totalRows} rows are ready to import
                  </span>
                )}
                {report.failed > 0 && (
                  <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    {report.failed} row(s) {result ? 'were skipped' : 'will be skipped'}
                  </span>
                )}
              </div>

              {report.errors.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.errors.map((rowError) => (
                        <TableRow key={`${rowError.row}-${rowError.message}`}>
                          <TableCell className="font-mono text-xs">{rowError.row}</TableCell>
                          <TableCell>
                            {rowError.name || <span className="text-muted-foreground">—</span>}
                            {rowError.phone && (
                              <span className="block font-mono text-xs text-muted-foreground">
                                {rowError.phone}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {rowError.message}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={busy !== null || !preview || preview.imported === 0}
            >
              {busy === 'import' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import {preview?.imported ?? 0} {entityPlural}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
