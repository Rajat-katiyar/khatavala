import { useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeStore, watchSystemTheme, type Theme } from '@/store/themeStore';

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Three-state theme switch: light / dark / follow the OS.
 *
 * A segmented control rather than a single toggle button, because with three
 * states a lone icon cannot show which one is active — a moon could equally
 * mean "dark is on" or "click for dark". Here the selected segment is visible
 * at a glance and each state is one click away.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Keeps `system` live: if the OS flips to dark at sunset the app follows
  // without a reload. Mounted once here, with the header.
  useEffect(() => watchSystemTheme(), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex rounded-md border p-0.5 ${className ?? ''}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={`rounded-sm p-1.5 transition-colors ${
              active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
