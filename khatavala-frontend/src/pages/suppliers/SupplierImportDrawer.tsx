import { ImportDrawer } from '@/components/ImportDrawer';
import * as supplierService from '@/services/supplier.service';

/** Supplier wiring for the shared two-step Excel import flow. */
export function SupplierImportDrawer({
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
      title="Import suppliers from Excel"
      description="Download the template, fill it in, and upload it back. Opening Balance here means what you owe them — the opposite direction to the customer template."
      entityPlural="supplier(s)"
      downloadTemplate={supplierService.downloadTemplate}
      runImport={supplierService.importSuppliers}
    />
  );
}
