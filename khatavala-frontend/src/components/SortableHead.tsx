import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';

/**
 * A sortable column header, shared by the customer and supplier tables.
 *
 * Declared at module scope, not inside a list component. A component defined
 * inside another's body is a new type on every render, so React unmounts and
 * remounts it — which would blur the sort button the moment it was clicked and
 * strand anyone navigating the table by keyboard.
 */
export function SortableHead<F extends string>({
  field,
  activeField,
  direction,
  onSort,
  className,
  children,
}: {
  field: F;
  activeField: F;
  direction: 'asc' | 'desc';
  onSort: (field: F) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const active = activeField === field;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {children}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}
