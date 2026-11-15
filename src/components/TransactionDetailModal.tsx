import { useEffect, useState } from 'react';
import { X, CheckCircle2, Edit3, Ban, DollarSign, History, ArrowRightLeft } from 'lucide-react';
import { api } from '../lib/api';
import {
  centsToInputString,
  formatDateTime,
  formatPeso,
  getCategoryLabel,
  parseToCentavos,
  toLocalDateTimeInputValue,
} from '../lib/money';
import type { TransactionDetail, Wallet } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  transactionId: number | null;
  initialMode?: 'view' | 'edit';
  wallets: Wallet[];
  onClose: () => void;
  onUpdated: () => void;
}

export function TransactionDetailModal({
  transactionId,
  initialMode = 'view',
  wallets,
  onClose,
  onUpdated,
}: Props) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'view' | 'pay' | 'edit' | 'void'>(initialMode);
  const [submitting, setSubmitting] = useState(false);

  // Payment form state
  const [payWalletId, setPayWalletId] = useState<number>(wallets[0]?.id ?? 1);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // Edit form state
  const [editCustomer, setEditCustomer] = useState('');
  const [editServiceType, setEditServiceType] = useState('');
  const [editProvider, setEditProvider] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTotal, setEditTotal] = useState('');
  const [editPrincipal, setEditPrincipal] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editStatus, setEditStatus] = useState<'paid' | 'unpaid' | 'partial'>('paid');
  const [editAmountPaid, setEditAmountPaid] = useState('');
  const [editWalletId, setEditWalletId] = useState<number>(wallets[0]?.id ?? 1);
  const [editProviderWalletId, setEditProviderWalletId] = useState<number>(wallets[0]?.id ?? 1);
  const [editDate, setEditDate] = useState('');
  const [editReason, setEditReason] = useState('');

  // Void form state
  const [voidReason, setVoidReason] = useState('');

  const loadDetail = async (nextMode: 'view' | 'edit' = 'view') => {
    if (!transactionId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.getTransactionDetail(transactionId);
      setDetail(res.transaction);
      const t = res.transaction;
      const collectible =
        t.service_category === 'cash_in_out'
          ? t.principal_amount_cents + t.service_fee_cents
          : t.total_amount_cents;
      const remaining = Math.max(0, collectible - t.amount_paid_cents);
      setPayAmount(centsToInputString(remaining));
      setPayWalletId(t.assigned_wallet_id ?? wallets[0]?.id ?? 1);
      setEditCustomer(t.customer_name);
      setEditServiceType(t.service_type);
      setEditProvider(t.provider || '');
      setEditDescription(t.description);
      setEditTotal(centsToInputString(t.total_amount_cents));
      setEditPrincipal(centsToInputString(t.principal_amount_cents));
      setEditCost(centsToInputString(t.actual_cost_cents));
      setEditFee(centsToInputString(t.service_fee_cents));
      setEditStatus(t.payment_status === 'voided' ? 'paid' : t.payment_status);
      setEditAmountPaid(centsToInputString(t.amount_paid_cents));
      setEditWalletId(t.assigned_wallet_id ?? wallets[0]?.id ?? 1);
      setEditProviderWalletId(t.provider_wallet_id ?? wallets[0]?.id ?? 1);
      const parsedDate = new Date(t.transaction_date);
      setEditDate(
        Number.isNaN(parsedDate.getTime())
          ? toLocalDateTimeInputValue()
          : toLocalDateTimeInputValue(parsedDate)
      );
      setMode(t.payment_status === 'voided' ? 'view' : nextMode);
    } catch (err: any) {
      setError(err.message || 'Failed to load transaction details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail(initialMode);
  }, [transactionId, initialMode]);

  if (!transactionId) return null;

  const collectibleCents = detail
    ? detail.service_category === 'cash_in_out'
      ? detail.principal_amount_cents + detail.service_fee_cents
      : detail.total_amount_cents
    : 0;
  const remainingCents = detail ? Math.max(0, collectibleCents - detail.amount_paid_cents) : 0;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const amountCents = parseToCentavos(payAmount);
      await api.recordPayment(detail.id, {
        wallet_id: payWalletId,
        amount_paid_cents: amountCents,
        notes: payNotes || 'Balance payment collected',
        idempotency_key: crypto.randomUUID(),
      });
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        customer_name: editCustomer,
        service_type: editServiceType,
        provider: editProvider.trim() || null,
        description: editDescription,
        payment_status: editStatus,
        amount_paid_cents: editStatus === 'partial' ? parseToCentavos(editAmountPaid) : undefined,
        assigned_wallet_id:
          editStatus === 'unpaid' && detail.service_category !== 'cash_in_out' ? null : editWalletId,
        transaction_date: editDate ? new Date(editDate).toISOString() : detail.transaction_date,
        reason: editReason.trim() || 'Corrected inputted transaction details',
      };
      if (detail.service_category === 'cash_in_out') {
        payload.principal_amount_cents = parseToCentavos(editPrincipal);
        payload.service_fee_cents = parseToCentavos(editFee);
        payload.total_amount_cents = parseToCentavos(editFee);
        payload.provider_wallet_id = editProviderWalletId;
        const provWallet = wallets.find((w) => w.id === editProviderWalletId);
        if (provWallet) payload.provider = provWallet.wallet_name;
      } else {
        payload.total_amount_cents = parseToCentavos(editTotal);
        payload.actual_cost_cents = parseToCentavos(editCost);
      }
      await api.editTransaction(detail.id, payload);
      setEditReason('');
      await loadDetail('view');
      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await api.voidTransaction(detail.id, voidReason);
      setVoidReason('');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <p className="text-xs text-slate-500 font-medium">Transaction Record</p>
            <h2 className="text-lg font-bold text-slate-900 money">
              {detail ? detail.transaction_number : 'Loading...'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[80vh] overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {loading || !detail ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading transaction ledger details...</div>
          ) : (
            <>
              {/* Top Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-5 border-b border-slate-200">
                <div>
                  <p className="text-xs text-slate-500">Customer</p>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5">{detail.customer_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Category / Service</p>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5">
                    {getCategoryLabel(detail.service_category)} · {detail.service_type}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Date &amp; Time</p>
                  <p className="text-xs font-medium text-slate-700 mt-1 money">
                    {formatDateTime(detail.transaction_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Payment Status</p>
                  <div className="mt-1">
                    <StatusBadge status={detail.payment_status} />
                  </div>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
                {detail.service_category === 'cash_in_out' ? (
                  <>
                    <div>
                      <p className="text-xs text-slate-500">Principal Amount</p>
                      <p className="text-base font-bold text-slate-900 money mt-0.5">
                        {formatPeso(detail.principal_amount_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Service Fee (Sales)</p>
                      <p className="text-base font-bold text-emerald-700 money mt-0.5">
                        {formatPeso(detail.service_fee_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total Collected/Settled</p>
                      <p className="text-base font-bold text-slate-900 money mt-0.5">
                        {formatPeso(collectibleCents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Provider / Settlement</p>
                      <p className="text-sm font-semibold text-slate-800 mt-1">
                        {detail.provider_wallet_name || detail.provider || '—'} /{' '}
                        {detail.assigned_wallet_name || '—'}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-slate-500">Total Amount</p>
                      <p className="text-base font-bold text-slate-900 money mt-0.5">
                        {formatPeso(detail.total_amount_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Direct Cost</p>
                      <p className="text-base font-semibold text-slate-700 money mt-0.5">
                        {formatPeso(detail.actual_cost_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Business Earnings</p>
                      <p className="text-base font-bold text-emerald-700 money mt-0.5">
                        {formatPeso(detail.earnings_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Outstanding Balance</p>
                      <p
                        className={`text-base font-bold money mt-0.5 ${
                          remainingCents > 0 && detail.payment_status !== 'voided'
                            ? 'text-red-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {detail.payment_status === 'voided' ? '₱0.00' : formatPeso(remainingCents)}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">Description:</span> {detail.description}
                {detail.provider ? ` · Provider: ${detail.provider}` : ''}
                {detail.assigned_wallet_name ? ` · Wallet: ${detail.assigned_wallet_name}` : ''}
              </div>

              {/* Action Buttons */}
              {detail.payment_status !== 'voided' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {remainingCents > 0 && (
                    <button
                      onClick={() => setMode(mode === 'pay' ? 'view' : 'pay')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                    >
                      <DollarSign className="w-4 h-4" />
                      Record Payment ({formatPeso(remainingCents)} due)
                    </button>
                  )}
                  <button
                    onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit Transaction
                  </button>
                  <button
                    onClick={() => setMode(mode === 'void' ? 'view' : 'void')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                  >
                    <Ban className="w-4 h-4" />
                    Void &amp; Reverse
                  </button>
                </div>
              )}

              {/* Record Payment Form */}
              {mode === 'pay' && (
                <form
                  onSubmit={handleRecordPayment}
                  className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-4"
                >
                  <h3 className="text-sm font-bold text-slate-900">Settle Customer Payment</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Receiving Wallet
                      </label>
                      <select
                        value={payWalletId}
                        onChange={(e) => setPayWalletId(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        {wallets
                          .filter((w) => w.status === 'active')
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.wallet_name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Amount Received (₱)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={(remainingCents / 100).toFixed(2)}
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Notes (Optional)
                      </label>
                      <input
                        type="text"
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                        placeholder="e.g. Paid in full"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {submitting ? 'Recording...' : 'Confirm Payment'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('view')}
                      className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Edit Form */}
              {mode === 'edit' && (
                <form
                  onSubmit={handleEditSubmit}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4"
                >
                  <h3 className="text-sm font-bold text-slate-900">
                    Edit Transaction (Reverses &amp; Re-posts Ledger Automatically)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Customer Name</label>
                      <input
                        type="text"
                        value={editCustomer}
                        onChange={(e) => setEditCustomer(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Date &amp; Time
                      </label>
                      <input
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                      />
                    </div>

                    {detail.service_category === 'cash_in_out' ? (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Transaction Type
                          </label>
                          <select
                            value={editServiceType}
                            onChange={(e) => setEditServiceType(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                          >
                            <option value="Cash-in">Cash-in</option>
                            <option value="Cash-out">Cash-out</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            E-Wallet Provider
                          </label>
                          <select
                            value={editProviderWalletId}
                            onChange={(e) => setEditProviderWalletId(Number(e.target.value))}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                          >
                            {wallets
                              .filter((w) => w.status === 'active')
                              .map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.wallet_name}
                                </option>
                              ))}
                          </select>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Service Type
                          </label>
                          <input
                            type="text"
                            value={editServiceType}
                            onChange={(e) => setEditServiceType(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                          />
                        </div>
                        {detail.service_category === 'loading' && (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Network / Provider
                            </label>
                            <input
                              type="text"
                              value={editProvider}
                              onChange={(e) => setEditProvider(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>

                    {detail.service_category === 'cash_in_out' ? (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Principal Amount (₱)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editPrincipal}
                            onChange={(e) => setEditPrincipal(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Service Fee (₱)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editFee}
                            onChange={(e) => setEditFee(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Total Amount (₱)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editTotal}
                            onChange={(e) => setEditTotal(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Actual / Direct Cost (₱)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editCost}
                            onChange={(e) => setEditCost(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Payment Status
                      </label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as any)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="paid">Paid</option>
                        <option value="unpaid">Unpaid</option>
                        {detail.service_category !== 'cash_in_out' && (
                          <option value="partial">Partially Paid</option>
                        )}
                      </select>
                    </div>

                    {(editStatus !== 'unpaid' || detail.service_category === 'cash_in_out') && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {detail.service_category === 'cash_in_out'
                            ? 'Settlement Wallet'
                            : 'Assigned Payment Wallet'}
                        </label>
                        <select
                          value={editWalletId}
                          onChange={(e) => setEditWalletId(Number(e.target.value))}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        >
                          {wallets
                            .filter((w) => w.status === 'active')
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.wallet_name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {editStatus === 'partial' && detail.service_category !== 'cash_in_out' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Amount Paid So Far (₱)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editAmountPaid}
                          onChange={(e) => setEditAmountPaid(e.target.value)}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                        />
                      </div>
                    )}

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Reason for Correction (Required for Audit Log)
                      </label>
                      <input
                        type="text"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="e.g. Corrected inputted amount / customer payment wallet"
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : 'Save Correction'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('view')}
                      className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Void Form */}
              {mode === 'void' && (
                <form
                  onSubmit={handleVoidSubmit}
                  className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3"
                >
                  <h3 className="text-sm font-bold text-red-900">
                    Void Transaction &amp; Reverse Wallet Movements
                  </h3>
                  <p className="text-xs text-red-700">
                    Historical records are never deleted. Voiding records explicit reversal entries in the
                    affected wallet ledger(s) and logs the action.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-red-900 mb-1">
                      Reason for Voiding (Required)
                    </label>
                    <input
                      type="text"
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder="e.g. Customer cancelled order / duplicate entry"
                      required
                      className="w-full px-3 py-2 text-sm bg-white border border-red-300 rounded-lg"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50"
                    >
                      {submitting ? 'Voiding...' : 'Confirm Void & Reversal'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('view')}
                      className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Associated Wallet Ledger Movements */}
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 mb-2">
                  <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                  Associated Wallet Financial Movements
                </h3>
                {detail.ledger_entries.length === 0 ? (
                  <p className="text-xs text-slate-500 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    No wallet movements recorded yet (transaction is currently unpaid).
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                          <th className="py-2 px-3 font-medium">Wallet</th>
                          <th className="py-2 px-3 font-medium">Movement Type</th>
                          <th className="py-2 px-3 font-medium">Date</th>
                          <th className="py-2 px-3 font-medium text-right">Money In</th>
                          <th className="py-2 px-3 font-medium text-right">Money Out</th>
                          <th className="py-2 px-3 font-medium text-right">Balance After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {detail.ledger_entries.map((l) => (
                          <tr key={l.id}>
                            <td className="py-2 px-3 font-semibold text-slate-900">{l.wallet_name}</td>
                            <td className="py-2 px-3 text-slate-700">{l.transaction_type}</td>
                            <td className="py-2 px-3 text-slate-500 money">{formatDateTime(l.entry_date)}</td>
                            <td className="py-2 px-3 text-right font-semibold text-emerald-700 money">
                              {l.amount_in_cents > 0 ? `+${formatPeso(l.amount_in_cents)}` : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-red-700 money">
                              {l.amount_out_cents > 0 ? `-${formatPeso(l.amount_out_cents)}` : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-slate-900 money">
                              {formatPeso(l.running_balance_cents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Audit Trail */}
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 mb-2">
                  <History className="w-4 h-4 text-slate-500" />
                  Audit Trail
                </h3>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {detail.audit_logs.map((log) => (
                    <div key={log.id} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <span className="font-semibold text-slate-900 capitalize">
                          {log.action.replace('_', ' ')}
                        </span>
                        <span className="text-slate-500"> · by {log.actor}</span>
                        {log.reason && <p className="text-slate-600 mt-0.5">{log.reason}</p>}
                      </div>
                      <span className="text-slate-500 money shrink-0">{formatDateTime(log.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
