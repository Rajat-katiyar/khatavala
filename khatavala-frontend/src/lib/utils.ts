import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats an amount for display. Uses the Indian digit grouping (1,25,000)
 * that this app's users read balances in, and always shows two decimals so a
 * column of figures aligns on the decimal point.
 */
export function formatMoney(amount: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

/**
 * A date as `YYYY-MM-DD` in the USER'S timezone.
 *
 * `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong: it
 * returns the UTC date, so anywhere east of UTC "today" flips to yesterday for
 * the first hours of every local day. On an IST machine at 00:40 that made the
 * day book ask the server for the previous date and come back empty.
 */
export function toLocalDateInput(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
