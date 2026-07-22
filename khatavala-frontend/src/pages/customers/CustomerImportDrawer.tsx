import { ImportDrawer } from '@/components/ImportDrawer';
import * as customerService from '@/services/customer.service';

/** Customer wiring for the shared two-step Excel import flow. */
export function CustomerImportDrawer({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  return (
    <ImportDrawer
      open={open}
      onOpenChange={onOpenChange}
      onImported={onImported}
      title="Import customers from Excel"
      description="Download the template, fill it in, and upload it back. Rows that cannot be imported are listed with the reason — the rest still import."
      entityPlural="customer(s)"
      downloadTemplate={customerService.downloadTemplate}
      runImport={customerService.importCustomers}
    />
  );
}
