import { useEffect, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { exportToCsv, exportToExcel, exportToPdf } from '../lib/exportReports';
import {
  formatDateTime,
  formatPeso,
  getCategoryLabel,
  getLocalTodayDateString,
  parseToCentavos,
} from '../lib/money';
import type { RefundCategory } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  onSelectTransaction: (id: number) => void;
}

export function ReportsView({ onSelectTransaction }: Props) {
  const [tab, setTab] = useState<'daily' | 'monthly' | 'wallets'>('monthly');

  // Daily state
  const [dailyDate, setDailyDate] = useState(() => getLocalTodayDateString());
  const [dailyData, setDailyData] = useState<any>(null);

  // Monthly state
  const [year, setYear] = useState(() => getLocalTodayDateString().slice(0, 4));
  const [selectedMonth, setSelectedMonth] = useState(() => getLocalTodayDateString().slice(0, 7));
  const [monthlyData, setMonthlyData] = useState<any>(null);

  // Refund category & obligation management
  const [newRefundCatName, setNewRefundCatName] = useState('');
  const [obMonth, setObMonth] = useState(() => getLocalTodayDateString().slice(0, 7));
  const [obCatId, setObCatId] = useState<number | ''>('');
  const [obAmount, setObAmount] = useState('');
  const [obNotes, setObNotes] = useState('');

  // Wallet report state
  const [walletStart, setWalletStart] = useState('');
  const [walletEnd, setWalletEnd] = useState('');
  const [walletData, setWalletData] = useState<any>(null);

  const loadDaily = async () => {
    const res = await api.getDailyReport(dailyDate);
    setDailyData(res);
  };

  const loadMonthly = async () => {
    const res = await api.getMonthlyReport(year, selectedMonth);
    setMonthlyData(res);
    if (res.refund_categories?.length > 0 && !obCatId) {
      setObCatId(res.refund_categories[0].id);
    }
  };

  const loadWalletReport = async () => {
    const res = await api.getWalletReport(walletStart, walletEnd);
    setWalletData(res);
  };

  useEffect(() => {
    if (tab === 'daily') loadDaily();
  }, [tab, dailyDate]);

  useEffect(() => {
    if (tab === 'monthly') loadMonthly();
  }, [tab, year, selectedMonth]);

  useEffect(() => {
    if (tab === 'wallets') loadWalletReport();
  }, [tab, walletStart, walletEnd]);

  const handleAddRefundCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRefundCatName.trim()) return;
    await api.createRefundCategory({ name: newRefundCatName.trim() });
    setNewRefundCatName('');
    await loadMonthly();
  };

  const handleSaveObligation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!obCatId) return;
    await api.saveRefundObligation({
      month_key: obMonth,
      refund_category_id: Number(obCatId),
      amount_cents: parseToCentavos(obAmount),
      notes: obNotes || undefined,
    });
    setObAmount('');
    setObNotes('');
    await loadMonthly();
  };

  const exportDaily = (kind: 'xlsx' | 'csv' | 'pdf') => {
    if (!dailyData) return;
    const s = dailyData.summary;
    const payload = {
      filename: `daily-sales-${dailyDate}`,
      title: `Daily Sales Report — ${dailyDate}`,
      subtitle: `Gross Sales: ${formatPeso(s.total_gross_sales_cents)} | Net Earnings: ${formatPeso(s.net_earnings_cents)}`,
      headers: ['Metric / Transaction', 'Details', 'Amount (₱)', 'Earnings (₱)', 'Wallet', 'Status'],
      rows: [
        ['Total Loading Sales', 'Mobile & TV Cable', (s.loading_sales_cents / 100).toFixed(2), '', '', ''],
        ['Cash-in / Cash-out Fees', 'GCash & Maya Service Fees', (s.cash_in_out_fees_cents / 100).toFixed(2), '', '', ''],
        ['Total Printing Sales', 'Printing & Photocopy', (s.printing_sales_cents / 100).toFixed(2), '', '', ''],
        ['Total Extra Services', 'Design, Resume, Formatting', (s.extra_services_sales_cents / 100).toFixed(2), '', '', ''],
        ['Total Gross Sales', 'Completed Services', (s.total_gross_sales_cents / 100).toFixed(2), '', '', ''],
        ['Total Earnings', 'Recognized Margins & Fees', (s.total_earnings_cents / 100).toFixed(2), '', '', ''],
        ['Total Expenses', 'Operational Expenses', (s.total_expenses_cents / 100).toFixed(2), '', '', ''],
        ['Net Earnings', 'Earnings - Expenses', (s.net_earnings_cents / 100).toFixed(2), '', '', ''],
        ...dailyData.transactions.map((t: any) => [
          t.transaction_number,
          `${t.customer_name} · ${t.description}`,
          ((t.service_category === 'cash_in_out' ? t.principal_amount_cents : t.total_amount_cents) / 100).toFixed(2),
          (t.earnings_cents / 100).toFixed(2),
          t.assigned_wallet_name || t.payment_method,
          t.payment_status,
        ]),
      ],
    };
    if (kind === 'xlsx') exportToExcel(payload);
    if (kind === 'csv') exportToCsv(payload);
    if (kind === 'pdf') exportToPdf(payload);
  };

  const exportMonthly = (kind: 'xlsx' | 'csv' | 'pdf') => {
    if (!monthlyData) return;
    const payload = {
      filename: `monthly-sales-report-${year}`,
      title: `Monthly Sales & Financial Report (${year})`,
      subtitle: `Generated for Sheena & Shelo's Business`,
      headers: [
        'Month',
        'Sales (₱)',
        'Earnings (₱)',
        'Expenses (₱)',
        'Net Earnings (₱)',
        'Refund Obligations (₱)',
        'Remaining (₱)',
      ],
      rows: monthlyData.months.map((m: any) => [
        m.month_label,
        (m.sales_cents / 100).toFixed(2),
        (m.earnings_cents / 100).toFixed(2),
        (m.expenses_cents / 100).toFixed(2),
        (m.net_earnings_cents / 100).toFixed(2),
        (m.refund_obligations_cents / 100).toFixed(2),
        (m.remaining_cents / 100).toFixed(2),
      ]),
    };
    if (kind === 'xlsx') exportToExcel(payload);
    if (kind === 'csv') exportToCsv(payload);
    if (kind === 'pdf') exportToPdf(payload);
  };

  const exportWallets = (kind: 'xlsx' | 'csv' | 'pdf') => {
    if (!walletData) return;
    const payload = {
      filename: `wallet-financial-report-${walletStart || 'all'}-${walletEnd || 'present'}`,
      title: 'Independent Wallet Financial Report',
      subtitle: `Period: ${walletStart || 'Inception'} to ${walletEnd || 'Present'} | Combined Closing Summary: ${formatPeso(walletData.total_combined_closing_cents)}`,
      headers: [
        'Wallet Account',
        'Opening (₱)',
        'Total Inflows (₱)',
        'Total Outflows (₱)',
        'Transfers In (₱)',
        'Transfers Out (₱)',
        'Adjustments (₱)',
        'Closing Balance (₱)',
      ],
      rows: walletData.wallets.map((w: any) => [
        w.wallet_name,
        (w.opening_balance_cents / 100).toFixed(2),
        (w.total_inflows_cents / 100).toFixed(2),
        (w.total_outflows_cents / 100).toFixed(2),
        (w.transfers_in_cents / 100).toFixed(2),
        (w.transfers_out_cents / 100).toFixed(2),
        (w.adjustments_net_cents / 100).toFixed(2),
        (w.closing_balance_cents / 100).toFixed(2),
      ]),
    };
    if (kind === 'xlsx') exportToExcel(payload);
    if (kind === 'csv') exportToCsv(payload);
    if (kind === 'pdf') exportToPdf(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Financial Reports &amp; Exports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Accurate daily, monthly, and independent wallet reports derived directly from ledger records
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          {(
            [
              { id: 'daily', label: 'Daily Report' },
              { id: 'monthly', label: 'Monthly Report' },
              { id: 'wallets', label: 'Wallet Reports' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* DAILY REPORT */}
      {tab === 'daily' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span>Report Date:</span>
              <input
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg money"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportDaily('xlsx')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
              <button
                onClick={() => exportDaily('csv')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => exportDaily('pdf')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          </div>

          {dailyData && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Total Loading Sales', val: dailyData.summary.loading_sales_cents },
                  { label: 'Cash-in / Out Fees', val: dailyData.summary.cash_in_out_fees_cents },
                  { label: 'Printing Sales', val: dailyData.summary.printing_sales_cents },
                  { label: 'Extra Services Sales', val: dailyData.summary.extra_services_sales_cents },
                  { label: 'Total Gross Sales', val: dailyData.summary.total_gross_sales_cents, bold: true },
                  { label: 'Total Earnings', val: dailyData.summary.total_earnings_cents, green: true },
                  { label: 'Total Expenses', val: dailyData.summary.total_expenses_cents, red: true },
                  {
                    label: 'Net Earnings',
                    val: dailyData.summary.net_earnings_cents,
                    green: dailyData.summary.net_earnings_cents >= 0,
                    red: dailyData.summary.net_earnings_cents < 0,
                  },
                  {
                    label: `Unpaid (${dailyData.summary.unpaid_count})`,
                    val: dailyData.summary.unpaid_total_cents,
                    red: dailyData.summary.unpaid_total_cents > 0,
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
                    <p className="text-xs text-slate-500">{item.label}</p>
                    <p
                      className={`text-lg font-bold money mt-1 ${
                        item.green ? 'text-emerald-700' : item.red ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatPeso(item.val)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 text-sm font-bold text-slate-900">
                  Transactions on {dailyDate}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-4">ID</th>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4">Category</th>
                        <th className="py-2.5 px-4">Description</th>
                        <th className="py-2.5 px-4 text-right">Amount</th>
                        <th className="py-2.5 px-4 text-right">Earnings</th>
                        <th className="py-2.5 px-4">Wallet</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dailyData.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            No transactions recorded on this date.
                          </td>
                        </tr>
                      ) : (
                        dailyData.transactions.map((t: any) => (
                          <tr
                            key={t.id}
                            onClick={() => onSelectTransaction(t.id)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-2.5 px-4 font-semibold money">{t.transaction_number}</td>
                            <td className="py-2.5 px-4">{t.customer_name}</td>
                            <td className="py-2.5 px-4">{getCategoryLabel(t.service_category)}</td>
                            <td className="py-2.5 px-4 text-slate-600">{t.description}</td>
                            <td className="py-2.5 px-4 text-right money font-semibold">
                              {formatPeso(
                                t.service_category === 'cash_in_out'
                                  ? t.principal_amount_cents
                                  : t.total_amount_cents
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right money font-semibold text-emerald-700">
                              {formatPeso(t.earnings_cents)}
                            </td>
                            <td className="py-2.5 px-4">{t.assigned_wallet_name || t.payment_method}</td>
                            <td className="py-2.5 px-4">
                              <StatusBadge status={t.payment_status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* MONTHLY REPORT */}
      {tab === 'monthly' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 font-semibold text-slate-700">
                <span>Year:</span>
                <select
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setSelectedMonth(`${e.target.value}-${selectedMonth.slice(5, 7)}`);
                  }}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg money"
                >
                  {['2024', '2025', '2026', '2027'].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 font-semibold text-slate-700">
                <span>Detail Month:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setYear(e.target.value.slice(0, 4));
                  }}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg money"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => exportMonthly('xlsx')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
              <button
                onClick={() => exportMonthly('csv')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => exportMonthly('pdf')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          </div>

          {monthlyData && (
            <>
              {/* 12-Month Summary Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Annual Monthly Summary ({year})</h3>
                    <p className="text-xs text-slate-500">
                      Net Earnings = Earnings - Expenses · Remaining = Net Earnings - Refund Obligations
                    </p>
                  </div>
                  <div className="text-xs text-slate-600">
                    Outstanding Customer Payments:{' '}
                    <strong className="money text-red-700">
                      {formatPeso(monthlyData.outstanding_customer_payments_cents)}
                    </strong>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-4 font-medium">Month</th>
                        <th className="py-2.5 px-4 font-medium text-right">Sales</th>
                        <th className="py-2.5 px-4 font-medium text-right">Earnings</th>
                        <th className="py-2.5 px-4 font-medium text-right">Expenses</th>
                        <th className="py-2.5 px-4 font-medium text-right">Net Earnings</th>
                        <th className="py-2.5 px-4 font-medium text-right">Refund Obligations</th>
                        <th className="py-2.5 px-4 font-medium text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyData.months.map((m: any) => (
                        <tr
                          key={m.month_key}
                          onClick={() => setSelectedMonth(m.month_key)}
                          className={`cursor-pointer ${
                            m.month_key === selectedMonth ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{m.month_label}</td>
                          <td className="py-2.5 px-4 text-right money">{formatPeso(m.sales_cents)}</td>
                          <td className="py-2.5 px-4 text-right money text-emerald-700 font-medium">
                            {formatPeso(m.earnings_cents)}
                          </td>
                          <td className="py-2.5 px-4 text-right money text-red-700">
                            {formatPeso(m.expenses_cents)}
                          </td>
                          <td className="py-2.5 px-4 text-right money font-semibold">
                            {formatPeso(m.net_earnings_cents)}
                          </td>
                          <td className="py-2.5 px-4 text-right money text-amber-700">
                            {formatPeso(m.refund_obligations_cents)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right money font-bold ${
                              m.remaining_cents >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {formatPeso(m.remaining_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Refund Categories & Monthly Refund Obligations Manager */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">Configurable Refund Categories</h3>
                  <form onSubmit={handleAddRefundCategory} className="flex gap-2">
                    <input
                      type="text"
                      value={newRefundCatName}
                      onChange={(e) => setNewRefundCatName(e.target.value)}
                      placeholder="e.g. GCash Dispute Refund"
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </form>
                  <div className="divide-y divide-slate-100 text-xs">
                    {monthlyData.refund_categories.map((rc: RefundCategory) => (
                      <div key={rc.id} className="py-2 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-800">{rc.name}</p>
                          {rc.description && <p className="text-[11px] text-slate-500">{rc.description}</p>}
                        </div>
                        <span className="text-emerald-700 font-medium">Active</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">
                    Set Monthly Refund Obligation ({selectedMonth})
                  </h3>
                  <form onSubmit={handleSaveObligation} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Month</label>
                      <input
                        type="month"
                        value={obMonth}
                        onChange={(e) => setObMonth(e.target.value)}
                        required
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg money"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Refund Category</label>
                      <select
                        value={obCatId}
                        onChange={(e) => setObCatId(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                      >
                        {monthlyData.refund_categories.map((rc: RefundCategory) => (
                          <option key={rc.id} value={rc.id}>
                            {rc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Amount (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={obAmount}
                        onChange={(e) => setObAmount(e.target.value)}
                        placeholder="0.00"
                        required
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg money"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                      >
                        Save Obligation
                      </button>
                    </div>
                  </form>

                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-700 mb-2">
                      {selectedMonth} Sales by Service Category
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {monthlyData.category_detail.map((c: any) => (
                        <div key={c.category} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                          <p className="font-semibold text-slate-800">{getCategoryLabel(c.category)}</p>
                          <p className="text-slate-600 mt-1 money">Sales: {formatPeso(c.sales_cents)}</p>
                          <p className="text-emerald-700 font-semibold money">
                            Earn: {formatPeso(c.earnings_cents)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* WALLET FINANCIAL REPORTS */}
      {tab === 'wallets' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 font-medium text-slate-700">
                <span>Start Date:</span>
                <input
                  type="date"
                  value={walletStart}
                  onChange={(e) => setWalletStart(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg money"
                />
              </label>
              <label className="flex items-center gap-1.5 font-medium text-slate-700">
                <span>End Date:</span>
                <input
                  type="date"
                  value={walletEnd}
                  onChange={(e) => setWalletEnd(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg money"
                />
              </label>
              {(walletStart || walletEnd) && (
                <button
                  onClick={() => {
                    setWalletStart('');
                    setWalletEnd('');
                  }}
                  className="text-red-700 hover:underline"
                >
                  Clear Range
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => exportWallets('xlsx')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
              <button
                onClick={() => exportWallets('csv')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => exportWallets('pdf')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          </div>

          {walletData && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Independent Wallet Financial Statement</h3>
                  <p className="text-xs text-slate-500">
                    Closing Balance = Opening + Total Inflows - Total Outflows (including transfers &amp; adjustments)
                  </p>
                </div>
                <div className="text-xs text-slate-600">
                  Combined Closing Summary:{' '}
                  <strong className="money text-slate-900 text-sm">
                    {formatPeso(walletData.total_combined_closing_cents)}
                  </strong>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Wallet Account</th>
                      <th className="py-2.5 px-4 font-medium text-right">Opening Balance</th>
                      <th className="py-2.5 px-4 font-medium text-right">Total Inflows</th>
                      <th className="py-2.5 px-4 font-medium text-right">Total Outflows</th>
                      <th className="py-2.5 px-4 font-medium text-right">Transfers In</th>
                      <th className="py-2.5 px-4 font-medium text-right">Transfers Out</th>
                      <th className="py-2.5 px-4 font-medium text-right">Adjustments</th>
                      <th className="py-2.5 px-4 font-medium text-right">Closing Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {walletData.wallets.map((w: any) => (
                      <tr key={w.wallet_id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">{w.wallet_name}</td>
                        <td className="py-3 px-4 text-right money">{formatPeso(w.opening_balance_cents)}</td>
                        <td className="py-3 px-4 text-right money text-emerald-700 font-medium">
                          {formatPeso(w.total_inflows_cents)}
                        </td>
                        <td className="py-3 px-4 text-right money text-red-700 font-medium">
                          {formatPeso(w.total_outflows_cents)}
                        </td>
                        <td className="py-3 px-4 text-right money text-slate-700">
                          {formatPeso(w.transfers_in_cents)}
                        </td>
                        <td className="py-3 px-4 text-right money text-slate-700">
                          {formatPeso(w.transfers_out_cents)}
                        </td>
                        <td className="py-3 px-4 text-right money text-slate-700">
                          {formatPeso(w.adjustments_net_cents, true)}
                        </td>
                        <td className="py-3 px-4 text-right money font-bold text-slate-900">
                          {formatPeso(w.closing_balance_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
