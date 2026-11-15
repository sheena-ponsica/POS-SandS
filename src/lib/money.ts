export function parseToCentavos(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return Math.round(input * 100);
  }
  const cleaned = String(input).replace(/[₱,\s]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function formatPeso(cents: number, showSign = false): string {
  const safeCents = Math.round(Number.isFinite(cents) ? cents : 0);
  const absVal = Math.abs(safeCents) / 100;
  const formatted = absVal.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (safeCents < 0) return `-₱${formatted}`;
  if (showSign && safeCents > 0) return `+₱${formatted}`;
  return `₱${formatted}`;
}

export function centsToInputString(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export function getCategoryLabel(category: string): string {
  switch (category) {
    case 'loading':
      return 'Loading';
    case 'cash_in_out':
      return 'Cash-in / Cash-out';
    case 'printing':
      return 'Printing / Photocopy';
    case 'extra_services':
      return 'Extra Services';
    default:
      return category;
  }
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateShort(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function toLocalDateTimeInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getLocalTodayDateString(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getLocalMonthKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
