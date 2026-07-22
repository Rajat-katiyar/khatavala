import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronDown, Plus, Settings } from 'lucide-react';
import { useCompanyStore } from '@/store/companyStore';
import * as companyService from '@/services/company.service';
import { cn } from '@/lib/utils';

export function CompanySwitcher() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const memberships = useCompanyStore((s) => s.memberships);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const activeRole = useCompanyStore((s) => s.activeRole);
  const isSwitching = useCompanyStore((s) => s.isSwitching);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = async (companyId: string) => {
    if (companyId === activeCompany?._id) return setOpen(false);
    setError(null);
    try {
      // Re-scopes the token and bumps tenantVersion, which is what makes every
      // mounted data hook refetch under the new company.
      await companyService.switchCompany(companyId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch company');
    }
  };

  if (!activeCompany) {
    return (
      <button
        onClick={() => navigate('/companies/new')}
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        <Plus className="h-4 w-4" />
        Create company
      </button>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isSwitching}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[240px] items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
      >
        {activeCompany.logoUrl ? (
          <img
            src={activeCompany.logoUrl}
            alt=""
            className="h-5 w-5 rounded object-cover"
          />
        ) : (
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{activeCompany.name}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border bg-background shadow-lg"
        >
          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your companies
          </div>

          <ul className="max-h-72 overflow-y-auto">
            {memberships.map(({ company, role }) => {
              const isActive = company._id === activeCompany._id;
              return (
                <li key={company._id}>
                  <button
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(company._id)}
                    disabled={isSwitching}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60',
                      isActive && 'bg-accent/50'
                    )}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        isActive ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{company.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {role}
                        {company.gstNumber ? ` · ${company.gstNumber}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {error && (
            <p className="border-t px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="border-t">
            <button
              onClick={() => {
                setOpen(false);
                navigate('/companies/new');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Create a company
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate('/settings/company');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <Settings className="h-4 w-4" />
              Company settings
              <span className="ml-auto text-xs text-muted-foreground">{activeRole}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
