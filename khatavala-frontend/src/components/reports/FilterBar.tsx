import { useState } from 'react';
import { Download, Calendar, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface FilterBarProps {
  onFilterChange: (filters: { from?: string; to?: string; search?: string }) => void;
  onExportExcel?: () => void;
  loading?: boolean;
}

export function FilterBar({ onFilterChange, onExportExcel, loading }: FilterBarProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const apply = (newFrom?: string, newTo?: string) => {
    const f = newFrom !== undefined ? newFrom : from;
    const t = newTo !== undefined ? newTo : to;
    onFilterChange({ from: f || undefined, to: t || undefined, search: search || undefined });
  };

  const handlePreset = (preset: 'today' | 'month' | 'year' | 'all') => {
    const now = new Date();
    if (preset === 'all') {
      setFrom('');
      setTo('');
      apply('', '');
    } else if (preset === 'today') {
      const day = now.toISOString().split('T')[0];
      setFrom(day);
      setTo(day);
      apply(day, day);
    } else if (preset === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const todayStr = now.toISOString().split('T')[0];
      setFrom(first);
      setTo(todayStr);
      apply(first, todayStr);
    } else if (preset === 'year') {
      const first = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
      const todayStr = now.toISOString().split('T')[0];
      setFrom(first);
      setTo(todayStr);
      apply(first, todayStr);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card p-3 rounded-lg border shadow-xs text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1 bg-background text-xs">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              apply(e.target.value, to);
            }}
            className="bg-transparent outline-none text-foreground"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              apply(from, e.target.value);
            }}
            className="bg-transparent outline-none text-foreground"
          />
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => handlePreset('all')} className="h-7 px-2 text-xs">
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handlePreset('today')} className="h-7 px-2 text-xs">
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handlePreset('month')} className="h-7 px-2 text-xs">
            This Month
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handlePreset('year')} className="h-7 px-2 text-xs">
            This Year
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search records…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              apply(from, to);
            }}
            className="h-8 pl-8 text-xs w-48"
          />
        </div>

        {onExportExcel && (
          <Button variant="outline" size="sm" onClick={onExportExcel} disabled={loading} className="h-8 gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Excel Export
          </Button>
        )}
      </div>
    </div>
  );
}
