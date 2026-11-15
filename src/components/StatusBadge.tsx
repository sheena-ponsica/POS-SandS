import type { PaymentStatus } from '../types';

export function StatusBadge({ status }: { status: PaymentStatus | string }) {
  switch (status) {
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
          Paid
        </span>
      );
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600" aria-hidden="true" />
          Partially Paid
        </span>
      );
    case 'unpaid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
          Unpaid
        </span>
      );
    case 'voided':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 line-through whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" aria-hidden="true" />
          Voided
        </span>
      );
    default:
      return <span className="text-xs font-medium text-slate-600">{status}</span>;
  }
}
