import { useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatPeso, parseToCentavos, toLocalDateTimeInputValue } from '../lib/money';
import type { Wallet, WalletTransfer } from '../types';

interface Props {
  wallets: Wallet[];
  onDataChanged: () => void;
}

export function TransfersView({ wallets, onDataChanged }: Props) {
  const activeWallets = wallets.filter((w) => w.status === 'active');
  const [transfers, setTransfers] = useState<WalletTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  const [sourceId, setSourceId] = useState<number>(activeWallets[1]?.id ?? activeWallets[0]?.id ?? 1);
  const [destId, setDestId] = useState<number>(activeWallets[2]?.id ?? activeWallets[0]?.id ?? 2);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transferDate, setTransferDate] = useState(() => toLocalDateTimeInputValue());
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getTransfers();
      setTransfers(res.transfers);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const srcWallet = activeWallets.find((w) => w.id === sourceId);
  const dstWallet = activeWallets.find((w) => w.id === destId);
  const amountCents = parseToCentavos(amount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSuccessMsg('');

    if (sourceId === destId) {
      setError('Source wallet and destination wallet must be different.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createTransfer({
        idempotency_key: idemKey,
        source_wallet_id: sourceId,
        destination_wallet_id: destId,
        amount_cents: amountCents,
        description: description.trim() || `Transfer from ${srcWallet?.wallet_name} to ${dstWallet?.wallet_name}`,
        transfer_date: new Date(transferDate).toISOString(),
      });
      setSuccessMsg(
        `Transfer ${res.transfer.transfer_number} recorded: ${formatPeso(amountCents)} moved from ${srcWallet?.wallet_name} to ${dstWallet?.wallet_name}.`
      );
      setAmount('');
      setDescription('');
      setTransferDate(toLocalDateTimeInputValue());
      setIdemKey(crypto.randomUUID());
      await load();
      onDataChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Wallet-to-Wallet Transfers</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Move funds between Physical Cash, GCash, Maya, and MariBank without generating sales, earnings, or expenses.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit"
        >
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-emerald-700" />
            Record Internal Transfer
          </h3>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
              <span>{successMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Source Wallet (Money Out)</label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {activeWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wallet_name} ({formatPeso(w.current_balance_cents)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Destination Wallet (Money In)
            </label>
            <select
              value={destId}
              onChange={(e) => setDestId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {activeWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wallet_name} ({formatPeso(w.current_balance_cents)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Transfer Amount (₱)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500.00"
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description / Remarks</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Move cash-in float from GCash to Maya"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          {amountCents > 0 && sourceId !== destId && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">{srcWallet?.wallet_name}</span>
                <span className="font-bold text-red-700 money">-{formatPeso(amountCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">{dstWallet?.wallet_name}</span>
                <span className="font-bold text-emerald-700 money">+{formatPeso(amountCents)}</span>
              </div>
              <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                Sales impact: ₱0.00 · Earnings impact: ₱0.00 · Expenses impact: ₱0.00
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || sourceId === destId}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50"
          >
            {submitting ? 'Processing Transfer...' : 'Execute Wallet Transfer'}
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Transfer History</h3>
            <p className="text-xs text-slate-500">Each transfer creates two linked ledger entries under one TRF reference</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Transfer ID</th>
                  <th className="py-2.5 px-4 font-medium">Date &amp; Time</th>
                  <th className="py-2.5 px-4 font-medium">From → To</th>
                  <th className="py-2.5 px-4 font-medium">Description</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Loading transfers...
                    </td>
                  </tr>
                ) : transfers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No wallet transfers recorded yet.
                    </td>
                  </tr>
                ) : (
                  transfers.map((tr) => (
                    <tr key={tr.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-semibold text-slate-900 money whitespace-nowrap">
                        {tr.transfer_number}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 money whitespace-nowrap">
                        {formatDateTime(tr.transfer_date)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        <span className="text-red-700">{tr.source_wallet_name}</span>
                        <span className="mx-1.5 text-slate-400">→</span>
                        <span className="text-emerald-700">{tr.destination_wallet_name}</span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{tr.description}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900 money whitespace-nowrap">
                        {formatPeso(tr.amount_cents)}
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
