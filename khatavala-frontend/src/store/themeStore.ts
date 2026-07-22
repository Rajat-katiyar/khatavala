import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Light / dark / system theme.
 *
 * `system` is a real third option, not a synonym for light: a user whose OS
 * flips to dark at sunset expects the app to follow. So the stored value is the
 * user's CHOICE, and the class actually on <html> is derived from it.
 *
 * The storage key is shared with the inline boot script in index.html, which
 * applies the class before React mounts. Both must agree — see applyTheme.
 */

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'khatavala-theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Cycles light → dark → system, for the header button. */
  cycleTheme: () => void;
}

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Resolves a choice to the class that belongs on <html>. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved = resolveTheme(theme);
  root.classList.toggle('dark', resolved === 'dark');
  // Tells the browser to render native controls — scrollbars, date pickers,
  // form fields — in the matching scheme. Without it a dark page keeps a
  // glaring white scrollbar.
  root.style.colorScheme = resolved;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      cycleTheme: () => {
        const order: Theme[] = ['light', 'dark', 'system'];
        const next = order[(order.indexOf(get().theme) + 1) % order.length];
        get().setTheme(next);
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      // Rehydration happens after the boot script has already painted, so this
      // re-applies only to reconcile a value the script could not parse.
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);

/**
 * Keeps `system` live: when the OS scheme changes the class must follow,
 * without a reload. A no-op for explicit light/dark choices.
 *
 * Returns an unsubscribe function, so callers can clean up.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined') return () => {};

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system');
  };

  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
