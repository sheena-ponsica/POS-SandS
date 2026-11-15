import { useEffect, useState } from 'react';
import { Wallet as WalletIcon, Plus, ShieldCheck, SlidersHorizontal, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatPeso, parseToCentavos, toLocalDateTimeInputValue } from '../lib/money';
import type { ReconciliationItem, Wallet, WalletLedgerEntry } from '../types';

interface Props {
  wallets: Wallet[];
  selectedWalletId: number | null;
  onSelectWallet: (id: number) => void;
  onDataChanged: () => void;
}

export function WalletsView({ wallets, selectedWalletId, onSelectWallet, onDataChanged }: Props) {
  const activeWalletId = selectedWalletId ?? wallets[0]?.id ?? null;
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedgerEntry[]>([]);
  const [activeWalletDetail, setActiveWalletDetail] = useState<Wallet | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Balance adjustment modal/form
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjWalletId, setAdjWalletId] = useState<number>(activeWalletId ?? 1);
  const [adjType, setAdjType] = useState<'increase' | 'decrease'>('increase');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjDate, setAdjDate] = useState(() => toLocalDateTimeInputValue());
  const [adjIdemKey, setAdjIdemKey] = useState(() => crypto.randomUUID());
  const [adjSubmitting, setAdjSubmitting] = useState(false);
  const [adjError, setAdjError] = useState('');

  // Add new wallet modal
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletType, setNewWalletType] = useState<'cash' | 'ewallet' | 'bank'>('ewallet');
  const [newOpeningBalance, setNewOpeningBalance] = useState('0.00');
  const [walletError, setWalletError] = useState('');

  // Reconciliation
  const [reconciliation, setReconciliation] = useState<ReconciliationItem[] | null>(null);

  const loadLedger = async (wid: number) => {
    setLoadingLedger(true);
    try {
      const res = await api.getWalletLedger(wid, {
        start_date: startDate,
        end_date: endDate,
        type: typeFilter,
      });
      setActiveWalletDetail(res.wallet);
      setLedgerEntries(res.entries);
    } finally {
      setLoadingLedger(false);
    }
  };

  useEffect(() => {
    if (activeWalletId) {
      loadLedger(activeWalletId);
      setAdjWalletId(activeWalletId);
    }
  }, [activeWalletId, typeFilter, startDate, endDate, wallets]);

  const handleRunReconcile = async () => {
    const res = await api.reconcileWallets();
    setReconciliation(res.items);
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjSubmitting) return;
    setAdjSubmitting(true);
    setAdjError('');
    try {
      await api.createAdjustment({
        idempotency_key: adjIdemKey,
        wallet_id: adjWalletId,
        adjustment_type: adjType,
        amount_cents: parseToCentavos(adjAmount),
        reason: adjReason,
        adjustment_date: new Date(adjDate).toISOString(),
      });
      setAdjAmount('');
      setAdjReason('');
      setAdjIdemKey(crypto.randomUUID());
      setShowAdjust(false);
      onDataChanged();
      if (activeWalletId) loadLedger(activeWalletId);
    } catch (err: any) {
      setAdjError(err.message);
    } finally {
      setAdjSubmitting(false);
    }
  };

  const handleAddWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalletError('');
    try {
      const res = await api.createWallet({
        wallet_name: newWalletName,
        wallet_type: newWalletType,
        opening_balance_cents: parseToCentavos(newOpeningBalance),
      });
      setNewWalletName('');
      setNewOpeningBalance('0.00');
      setShowAddWallet(false);
      onDataChanged();
      onSelectWallet(res.wallet.id);
    } catch (err: any) {
      setWalletError(err.message);
    }
  };

  const totalCombinedCents = wallets
    .filter((w) => w.status === 'active')
    .reduce((acc, w) => acc + w.current_balance_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Independent Wallet Management</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Each wallet operates as an isolated financial ledger. Movements in one wallet never affect another unless explicitly transferred.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunReconcile}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-700"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            Verify Ledger Integrity
          </button>
          <button
            onClick={() => {
              setAdjWalletId(activeWalletId ?? wallets[0]?.id ?? 1);
              setShowAdjust(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-700"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Balance Adjustment
          </button>
          <button
            onClick={() => setShowAddWallet(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Add Wallet
          </button>
        </div>
      </div>

      {/* Total Summary Banner (Read-Only Aggregate) */}
      <div className="bg-slate-900 text-white rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-300">Total Recorded Balance Across All Active Wallets (Summary Only)</p>
          <p className="text-2xl font-bold money mt-1">{formatPeso(totalCombinedCents)}</p>
        </div>
        <p className="text-xs text-slate-300 max-w-md">
          Aggregate sum of individual wallet closing balances. Changing one account never alters another account.
        </p>
      </div>

      {/* Reconciliation Panel */}
      {reconciliation && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Ledger Reconciliation Audit</h3>
            <button
              onClick={() => setReconciliation(null)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Dismiss
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 px-3">Wallet</th>
                  <th className="py-2 px-3 text-right">Opening</th>
                  <th className="py-2 px-3 text-right">Total Inflows</th>
                  <th className="py-2 px-3 text-right">Total Outflows</th>
                  <th className="py-2 px-3 text-right">Ledger Computed</th>
                  <th className="py-2 px-3 text-right">Current Balance</th>
                  <th className="py-2 px-3">Audit Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliation.map((r) => (
                  <tr key={r.wallet_id}>
                    <td className="py-2 px-3 font-semibold text-slate-900">{r.wallet_name}</td>
                    <td className="py-2 px-3 text-right money">{formatPeso(r.opening_balance_cents)}</td>
                    <td className="py-2 px-3 text-right text-emerald-700 money">{formatPeso(r.total_in_cents)}</td>
                    <td className="py-2 px-3 text-right text-red-700 money">{formatPeso(r.total_out_cents)}</td>
                    <td className="py-2 px-3 text-right font-semibold money">{formatPeso(r.computed_balance_cents)}</td>
                    <td className="py-2 px-3 text-right font-semibold money">{formatPeso(r.cached_balance_cents)}</td>
                    <td className="py-2 px-3">
                      {r.is_reconciled ? (
                        <span className="font-semibold text-emerald-700">Reconciled (Exact Match)</span>
                      ) : (
                        <span className="font-semibold text-red-700">
                          Discrepancy ({formatPeso(r.discrepancy_cents)})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual Wallet Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {wallets.map((w) => {
          const isSelected = w.id === activeWalletId;
          return (
            <button
              key={w.id}
              onClick={() => onSelectWallet(w.id)}
              className={`text-left rounded-xl p-5 border transition-colors ${
                isSelected
                  ? 'bg-white border-emerald-700 ring-1 ring-emerald-700'
                  : 'bg-white border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">{w.wallet_name}</span>
                <WalletIcon className={`w-4 h-4 ${isSelected ? 'text-emerald-700' : 'text-slate-400'}`} />
              </div>
              <p className="text-xs text-slate-500 mt-0.5 capitalize">{w.wallet_type} account</p>

              <p
                className={`text-2xl font-bold money mt-3 ${
                  w.current_balance_cents < 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {formatPeso(w.current_balance_cents)}
              </p>

              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening Balance</span>
                  <span className="money text-slate-700">{formatPeso(w.opening_balance_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 inline-flex items-center gap-0.5">
                    <ArrowUpRight className="w-3 h-3 text-emerald-600" /> Total Inflows
                  </span>
                  <span className="money font-medium text-emerald-700">
                    {formatPeso(w.total_inflow_cents ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 inline-flex items-center gap-0.5">
                    <ArrowDownRight className="w-3 h-3 text-red-600" /> Total Outflows
                  </span>
                  <span className="money font-medium text-red-700">
                    {formatPeso(w.total_outflow_cents ?? 0)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Add Wallet Inline Form */}
      {showAddWallet && (
        <form
          onSubmit={handleAddWalletSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Configure New Wallet Account</h3>
            <button
              type="button"
              onClick={() => setShowAddWallet(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Close
            </button>
          </div>
          {walletError && <p className="text-xs text-red-700">{walletError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Account Name</label>
              <input
                type="text"
                value={newWalletName}
                onChange={(e) => setNewWalletName(e.target.value)}
                placeholder="e.g. GoTyme Bank, ShopeePay"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Account Type</label>
              <select
                value={newWalletType}
                onChange={(e) => setNewWalletType(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                <option value="ewallet">E-Wallet</option>
                <option value="bank">Digital / Bank Account</option>
                <option value="cash">Cash Drawer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Opening Balance (₱)</label>
              <input
                type="number"
                step="0.01"
                value={newOpeningBalance}
                onChange={(e) => setNewOpeningBalance(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg money"
              />
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
          >
            Create Wallet Account
          </button>
        </form>
      )}

      {/* Manual Balance Adjustment Modal/Form */}
      {showAdjust && (
        <form
          onSubmit={handleAdjustmentSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Auditable Balance Adjustment (Never Overwrites History)
            </h3>
            <button
              type="button"
              onClick={() => setShowAdjust(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Close
            </button>
          </div>
          {adjError && <p className="text-xs text-red-700">{adjError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Wallet</label>
              <select
                value={adjWalletId}
                onChange={(e) => setAdjWalletId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wallet_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Type</label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                <option value="increase">Increase (+)</option>
                <option value="decrease">Decrease (-)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount (₱)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg money"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={adjDate}
                onChange={(e) => setAdjDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg money"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason / Audit Remarks (Required)
              </label>
              <input
                type="text"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Cash drawer physical count reconciliation"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={adjSubmitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50"
          >
            {adjSubmitting ? 'Recording...' : 'Record Balance Adjustment'}
          </button>
        </form>
      )}

      {/* Dedicated Wallet Transaction History Ledger */}
      {activeWalletDetail && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {activeWalletDetail.wallet_name} — Dedicated Account Ledger
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Opening: <strong className="money">{formatPeso(activeWalletDetail.opening_balance_cents)}</strong> ·
                Transfers In: <strong className="money text-emerald-700">{formatPeso(activeWalletDetail.transfers_in_cents ?? 0)}</strong> ·
                Transfers Out: <strong className="money text-red-700">{formatPeso(activeWalletDetail.transfers_out_cents ?? 0)}</strong> ·
                Current Balance: <strong className="money text-slate-900">{formatPeso(activeWalletDetail.current_balance_cents)}</strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
              >
                <option value="all">All Ledger Movements</option>
                <option value="transaction_payment">Customer Payments</option>
                <option value="transaction">Cash-In / Cash-Out Movements</option>
                <option value="transfer">Wallet Transfers</option>
                <option value="expense">Expenses</option>
                <option value="refund">Refunds</option>
                <option value="adjustment">Adjustments</option>
                <option value="transaction_reversal">Reversals</option>
              </select>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Date &amp; Time</th>
                  <th className="py-2.5 px-4 font-medium">Reference ID</th>
                  <th className="py-2.5 px-4 font-medium">Transaction Type</th>
                  <th className="py-2.5 px-4 font-medium">Description</th>
                  <th className="py-2.5 px-4 font-medium text-right">Money In</th>
                  <th className="py-2.5 px-4 font-medium text-right">Money Out</th>
                  <th className="py-2.5 px-4 font-medium text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loadingLedger ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Loading wallet ledger...
                    </td>
                  </tr>
                ) : ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No ledger entries recorded for {activeWalletDetail.wallet_name} yet.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-slate-500 money whitespace-nowrap">
                        {formatDateTime(entry.entry_date)}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 money whitespace-nowrap">
                        {entry.reference_code}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 font-medium whitespace-nowrap">
                        {entry.transaction_type}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{entry.description}</td>
                      <td className="py-2.5 px-4 text-right font-semibold text-emerald-700 money whitespace-nowrap">
                        {entry.amount_in_cents > 0 ? `+${formatPeso(entry.amount_in_cents)}` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-red-700 money whitespace-nowrap">
                        {entry.amount_out_cents > 0 ? `-${formatPeso(entry.amount_out_cents)}` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900 money whitespace-nowrap">
                        {formatPeso(entry.running_balance_cents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
