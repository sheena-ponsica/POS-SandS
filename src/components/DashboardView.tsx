import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Wallet as WalletIcon, ArrowUpRight, ArrowDownRight, Plus } from 'lucide-react';
import { formatDateTime, formatPeso, getCategoryLabel } from '../lib/money';
import type { DashboardSummary } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  data: DashboardSummary | null;
  loading: boolean;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  onSelectWallet: (walletId: number) => void;
  onSelectTransaction: (transactionId: number) => void;
  onQuickAdd: () => void;
}

const CATEGORY_COLORS = ['#0f766e', '#0369a1', '#4338ca', '#b45309'];

export function DashboardView({
  data,
  loading,
  selectedMonth,
  onMonthChange,
  onSelectWallet,
  onSelectTransaction,
  onQuickAdd,
}: Props) {
  const [trendMode, setTrendMode] = useState<'daily' | 'monthly'>('daily');

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const { kpis, wallets, category_breakdown, daily_trends, monthly_trends, recent_transactions } = data;

  const trendChartData = (trendMode === 'daily' ? daily_trends : monthly_trends).map((d) => ({
    label: d.label,
    Sales: Number((d.sales_cents / 100).toFixed(2)),
    Earnings: Number((d.earnings_cents / 100).toFixed(2)),
    Expenses: Number((d.expenses_cents / 100).toFixed(2)),
  }));

  const categoryChartData = category_breakdown.map((c) => ({
    name: c.label,
    Sales: Number((c.sales_cents / 100).toFixed(2)),
    Earnings: Number((c.earnings_cents / 100).toFixed(2)),
    count: c.transaction_count,
  }));

  return (
    <div className="space-y-6">
      {/* Top Action & Period Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Financial Overview</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live database figures · Independent wallet ledgers · Philippine Peso (₱)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span>Reporting Month</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-900"
            />
          </label>
          <button
            onClick={onQuickAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        </div>
      </div>

      {/* KPI Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Sales Today</p>
          <p className="text-2xl font-bold text-slate-900 money mt-1.5">
            {formatPeso(kpis.total_sales_today_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Completed customer sales ({data.today})</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Sales This Month</p>
          <p className="text-2xl font-bold text-slate-900 money mt-1.5">
            {formatPeso(kpis.total_sales_month_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Excludes internal transfers &amp; unpaid items</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Earnings This Month</p>
          <p className="text-2xl font-bold text-emerald-700 money mt-1.5">
            {formatPeso(kpis.total_earnings_month_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Service fees &amp; margins from completed services</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Expenses This Month</p>
          <p className="text-2xl font-bold text-red-700 money mt-1.5">
            {formatPeso(kpis.total_expenses_month_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Operational business expenses only</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Net Earnings</p>
          <p
            className={`text-2xl font-bold money mt-1.5 ${
              kpis.net_earnings_month_cents >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatPeso(kpis.net_earnings_month_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Monthly earnings minus business expenses</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Unpaid Transactions</p>
          <p
            className={`text-2xl font-bold money mt-1.5 ${
              kpis.total_unpaid_cents > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {formatPeso(kpis.total_unpaid_cents)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {kpis.unpaid_count} pending customer balance{kpis.unpaid_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Independent Wallet Balances */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Independent Wallet Balances</h3>
            <p className="text-xs text-slate-500">
              Each account maintains its own isolated ledger. Click any wallet to inspect its ledger history.
            </p>
          </div>
          <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl flex items-center gap-4 shrink-0">
            <div>
              <p className="text-[11px] text-slate-300">Total Recorded Balance (Summary Only)</p>
              <p className="text-lg font-bold money">{formatPeso(kpis.total_recorded_balance_cents)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {wallets.map((w) => (
            <button
              key={w.id}
              onClick={() => onSelectWallet(w.id)}
              className="text-left bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-4 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900">
                  {w.wallet_name}
                </span>
                <WalletIcon className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
              </div>
              <p
                className={`text-xl font-bold money mt-2 ${
                  w.current_balance_cents < 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {formatPeso(w.current_balance_cents)}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100">
                <span className="inline-flex items-center gap-0.5 text-emerald-700 money">
                  <ArrowUpRight className="w-3 h-3" />
                  {formatPeso(w.total_inflow_cents ?? 0)}
                </span>
                <span className="inline-flex items-center gap-0.5 text-red-700 money">
                  <ArrowDownRight className="w-3 h-3" />
                  {formatPeso(w.total_outflow_cents ?? 0)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Charts & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Daily / Monthly Trend */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Sales &amp; Earnings Trends</h3>
              <p className="text-xs text-slate-500">Recognized completed sales, earnings, and expenses</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => setTrendMode('daily')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  trendMode === 'daily'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Daily (14d)
              </button>
              <button
                onClick={() => setTrendMode('monthly')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  trendMode === 'monthly'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Monthly (6m)
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `₱${v}`} />
                <Tooltip
                  formatter={(value: any) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#cbd5e1' }}
                />
                <Area
                  type="monotone"
                  dataKey="Sales"
                  stroke="#0f172a"
                  fill="#cbd5e1"
                  fillOpacity={0.35}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Earnings"
                  stroke="#15803d"
                  fill="#86efac"
                  fillOpacity={0.35}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Expenses"
                  stroke="#dc2626"
                  fill="#fca5a5"
                  fillOpacity={0.2}
                  strokeWidth={1.75}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Distribution */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Category Breakdown ({selectedMonth})</h3>
            <p className="text-xs text-slate-500 mb-3">Sales &amp; earnings distribution by service</p>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryChartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v) => `₱${v}`} />
                <Tooltip
                  formatter={(value: any) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="Sales" fill="#0f172a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Earnings" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
            {category_breakdown.map((c, idx) => (
              <div key={c.category} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                  />
                  <span className="font-medium text-slate-800">{c.label}</span>
                  <span className="text-slate-400">({c.transaction_count})</span>
                </div>
                <div className="flex items-center gap-4 money">
                  <span className="text-slate-700">{formatPeso(c.sales_cents)}</span>
                  <span className="font-semibold text-emerald-700 w-20 text-right">
                    {formatPeso(c.earnings_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category Share Donut + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900">Earnings Share</h3>
          <p className="text-xs text-slate-500 mb-3">Proportion of earnings by service category</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryChartData}
                  dataKey="Earnings"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={76}
                  paddingAngle={3}
                >
                  {categoryChartData.map((_, index) => (
                    <Cell key={index} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Transactions</h3>
              <p className="text-xs text-slate-500">Click any row to inspect financial movements &amp; audit log</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">ID</th>
                  <th className="py-2.5 px-4 font-medium">Customer</th>
                  <th className="py-2.5 px-4 font-medium">Service</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-4 font-medium text-right">Earnings</th>
                  <th className="py-2.5 px-4 font-medium">Wallet</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {recent_transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No transactions recorded yet. Click Add Transaction to record your first sale.
                    </td>
                  </tr>
                ) : (
                  recent_transactions.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => onSelectTransaction(t.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4 font-semibold text-slate-900 money whitespace-nowrap">
                        {t.transaction_number}
                      </td>
                      <td className="py-2.5 px-4 text-slate-800 font-medium">{t.customer_name}</td>
                      <td className="py-2.5 px-4 text-slate-600">
                        <span className="font-medium text-slate-800">{getCategoryLabel(t.service_category)}</span>
                        <span className="text-slate-400"> · </span>
                        <span>{t.description}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-slate-900 money whitespace-nowrap">
                        {t.service_category === 'cash_in_out'
                          ? formatPeso(t.principal_amount_cents)
                          : formatPeso(t.total_amount_cents)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-emerald-700 money whitespace-nowrap">
                        {formatPeso(t.earnings_cents)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {t.assigned_wallet_name || t.payment_method}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusBadge status={t.payment_status} />
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 money whitespace-nowrap">
                        {formatDateTime(t.transaction_date)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
