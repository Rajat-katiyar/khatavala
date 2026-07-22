import { ImportDrawer } from '@/components/ImportDrawer';
import * as productService from '@/services/product.service';

/** Product wiring for the shared two-step Excel import flow. */
export function ProductImportDrawer({
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
      title="Import products from Excel"
      description="Download the template, fill it in, and upload it back. Categories and brands are created automatically; units must already exist."
      entityPlural="product(s)"
      downloadTemplate={productService.downloadTemplate}
      runImport={productService.importProducts}
    />
  );
}
