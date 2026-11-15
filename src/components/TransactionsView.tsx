import { useEffect, useState } from 'react';
import { Search, Download, Plus, Edit3 } from 'lucide-react';
import { api } from '../lib/api';
import { exportToCsv, exportToExcel, exportToPdf } from '../lib/exportReports';
import { formatDateTime, formatPeso, getCategoryLabel } from '../lib/money';
import type { TransactionRecord, Wallet } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  wallets: Wallet[];
  refreshSignal: number;
  onSelectTransaction: (id: number, mode?: 'view' | 'edit') => void;
  onQuickAdd: () => void;
}

export function TransactionsView({ wallets, refreshSignal, onSelectTransaction, onQuickAdd }: Props) {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [walletId, setWalletId] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getTransactions({
        search,
        category,
        status,
        wallet_id: walletId,
        start_date: startDate,
        end_date: endDate,
      });
      setTransactions(res.transactions);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [category, status, walletId, startDate, endDate, refreshSignal]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const buildExport = () => ({
    filename: `transactions-${new Date().toISOString().slice(0, 10)}`,
    title: 'Transaction History Report',
    subtitle: `Filtered Records (${transactions.length} transactions)`,
    headers: [
      'Transaction ID',
      'Date & Time',
      'Customer',
      'Category',
      'Service',
      'Description',
      'Amount (₱)',
      'Earnings (₱)',
      'Wallet',
      'Status',
    ],
    rows: transactions.map((t) => [
      t.transaction_number,
      formatDateTime(t.transaction_date),
      t.customer_name,
      getCategoryLabel(t.service_category),
      t.service_type,
      t.description,
      ((t.service_category === 'cash_in_out' ? t.principal_amount_cents : t.total_amount_cents) / 100).toFixed(2),
      (t.earnings_cents / 100).toFixed(2),
      t.assigned_wallet_name || t.payment_method,
      t.payment_status,
    ]),
  });

  const totals = transactions.reduce(
    (acc, t) => {
      if (t.payment_status === 'voided') return acc;
      if (t.payment_status === 'paid') {
        acc.sales += t.total_amount_cents;
        acc.earnings += t.earnings_cents;
      }
      if (t.payment_status === 'unpaid' || t.payment_status === 'partial') {
        const collectible =
          t.service_category === 'cash_in_out'
            ? t.principal_amount_cents + t.service_fee_cents
            : t.total_amount_cents;
        acc.unpaid += Math.max(0, collectible - t.amount_paid_cents);
      }
      return acc;
    },
    { sales: 0, earnings: 0, unpaid: 0 }
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Transaction History</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Search, filter, settle unpaid balances, edit with audit logs, or export records
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => exportToExcel(buildExport())}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-700"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            onClick={() => exportToCsv(buildExport())}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-700"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={() => exportToPdf(buildExport())}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-700"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            onClick={onQuickAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        </div>
      </div>

      {/* Filters */}
      <form
        onSubmit={handleSearchSubmit}
        className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"
      >
        <div className="lg:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, description, or TXN ID..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          />
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
        >
          <option value="all">All Categories</option>
          <option value="loading">Loading</option>
          <option value="cash_in_out">Cash-in / Cash-out</option>
          <option value="printing">Printing / Photocopy</option>
          <option value="extra_services">Extra Services</option>
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
        >
          <option value="all">All Statuses</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially Paid</option>
          <option value="voided">Voided</option>
        </select>

        <select
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
        >
          <option value="all">All Wallets</option>
          {wallets.map((w) => (
            <option key={w.id} value={String(w.id)}>
              {w.wallet_name}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
        >
          Apply Search
        </button>

        <div className="lg:col-span-6 flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">
            <span>From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1 border border-slate-300 rounded-md"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-600">
            <span>To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1 border border-slate-300 rounded-md"
            />
          </label>
          {(search || category !== 'all' || status !== 'all' || walletId !== 'all' || startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategory('all');
                setStatus('all');
                setWalletId('all');
                setStartDate('');
                setEndDate('');
              }}
              className="text-xs font-medium text-red-700 hover:underline"
            >
              Reset Filters
            </button>
          )}
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="text-slate-600">
              Completed Sales: <strong className="money text-slate-900">{formatPeso(totals.sales)}</strong>
            </span>
            <span className="text-slate-600">
              Earnings: <strong className="money text-emerald-700">{formatPeso(totals.earnings)}</strong>
            </span>
            <span className="text-slate-600">
              Unpaid: <strong className="money text-red-700">{formatPeso(totals.unpaid)}</strong>
            </span>
          </div>
        </div>
      </form>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <th className="py-3 px-4 font-medium">Transaction ID</th>
                <th className="py-3 px-4 font-medium">Date &amp; Time</th>
                <th className="py-3 px-4 font-medium">Customer</th>
                <th className="py-3 px-4 font-medium">Category</th>
                <th className="py-3 px-4 font-medium">Description</th>
                <th className="py-3 px-4 font-medium text-right">Amount</th>
                <th className="py-3 px-4 font-medium text-right">Earnings</th>
                <th className="py-3 px-4 font-medium">Assigned Wallet</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    Loading transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    No transactions match the current filters.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => {
                  const displayAmount =
                    t.service_category === 'cash_in_out' ? t.principal_amount_cents : t.total_amount_cents;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onSelectTransaction(t.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 money whitespace-nowrap">
                        {t.transaction_number}
                      </td>
                      <td className="py-3 px-4 text-slate-500 money whitespace-nowrap">
                        {formatDateTime(t.transaction_date)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{t.customer_name}</td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {getCategoryLabel(t.service_category)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {t.service_type} — {t.description}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900 money whitespace-nowrap">
                        {formatPeso(displayAmount)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-700 money whitespace-nowrap">
                        {formatPeso(t.earnings_cents)}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {t.service_category === 'cash_in_out'
                          ? `${t.provider_wallet_name || t.provider} / ${t.assigned_wallet_name || '—'}`
                          : t.assigned_wallet_name || t.payment_method}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={t.payment_status} />
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {t.payment_status !== 'voided' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTransaction(t.id, 'edit');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
