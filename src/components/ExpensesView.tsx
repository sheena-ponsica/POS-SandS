import { useEffect, useState } from 'react';
import { Receipt, CheckCircle2, AlertCircle, Ban } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatPeso, parseToCentavos, toLocalDateTimeInputValue } from '../lib/money';
import type { ExpenseRecord, MovementType, RefundCategory, TransactionRecord, Wallet } from '../types';

interface Props {
  wallets: Wallet[];
  onDataChanged: () => void;
}

const EXPENSE_CATEGORIES = [
  'Bond Paper',
  'Printer Ink',
  'Printing Materials',
  'Business Supplies',
  'Utilities',
  'Other Operational',
];

export function ExpensesView({ wallets, onDataChanged }: Props) {
  const activeWallets = wallets.filter((w) => w.status === 'active');
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [refundCategories, setRefundCategories] = useState<RefundCategory[]>([]);
  const [recentTxns, setRecentTxns] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');

  // Form state
  const [movementType, setMovementType] = useState<MovementType>('expense');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Bond Paper');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState<number>(activeWallets[0]?.id ?? 1);
  const [refundCategoryId, setRefundCategoryId] = useState<number | ''>('');
  const [relatedTxnId, setRelatedTxnId] = useState<number | ''>('');
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateTimeInputValue());
  const [remarks, setRemarks] = useState('');
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [expRes, rcRes, txnRes] = await Promise.all([
        api.getExpenses({ movement_type: filterType }),
        api.getRefundCategories(),
        api.getTransactions({}),
      ]);
      setExpenses(expRes.expenses);
      setRefundCategories(rcRes.categories);
      setRecentTxns(txnRes.transactions.slice(0, 50));
      if (rcRes.categories.length > 0 && !refundCategoryId) {
        setRefundCategoryId(rcRes.categories[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterType]);

  const handleModeChange = (mode: MovementType) => {
    setMovementType(mode);
    if (mode === 'expense') setCategory('Bond Paper');
    if (mode === 'inventory_replenishment') setCategory('Loading Inventory');
    if (mode === 'refund') setCategory('Refund');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api.createExpense({
        idempotency_key: idemKey,
        description,
        category,
        movement_type: movementType,
        amount_cents: parseToCentavos(amount),
        wallet_id: walletId,
        related_transaction_id: movementType === 'refund' && relatedTxnId ? Number(relatedTxnId) : null,
        refund_category_id: movementType === 'refund' && refundCategoryId ? Number(refundCategoryId) : null,
        expense_date: new Date(expenseDate).toISOString(),
        remarks: remarks || null,
      });
      setSuccessMsg(`Recorded ${res.expense.expense_number} against selected wallet.`);
      setDescription('');
      setAmount('');
      setRemarks('');
      setRelatedTxnId('');
      setExpenseDate(toLocalDateTimeInputValue());
      setIdemKey(crypto.randomUUID());
      await load();
      onDataChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (exp: ExpenseRecord) => {
    setError('');
    try {
      await api.voidExpense(exp.id, 'Cancelled / Reversed');
      await load();
      onDataChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Expenses &amp; Money Outflows</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Distinguish operational expenses, loading inventory replenishments, and transaction refunds while keeping each wallet accurate.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit"
        >
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'expense', label: 'Expense' },
                { id: 'inventory_replenishment', label: 'Load Stock' },
                { id: 'refund', label: 'Refund' },
              ] as Array<{ id: MovementType; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleModeChange(m.id)}
                className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                  movementType === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                movementType === 'inventory_replenishment'
                  ? 'e.g. Retailer load wallet top-up ₱2,000'
                  : movementType === 'refund'
                    ? 'e.g. Refund for failed load / transfer'
                    : 'e.g. 2 reams bond paper / printer ink'
              }
              required
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {movementType === 'expense' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : movementType === 'refund' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Refund Category</label>
                <select
                  value={refundCategoryId}
                  onChange={(e) => setRefundCategoryId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {refundCategories.map((rc) => (
                    <option key={rc.id} value={rc.id}>
                      {rc.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <input
                  type="text"
                  value="Loading Inventory"
                  disabled
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Source Wallet</label>
              <select
                value={walletId}
                onChange={(e) => setWalletId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                {activeWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wallet_name} ({formatPeso(w.current_balance_cents)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {movementType === 'refund' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Original Transaction Reference (Recommended)
              </label>
              <select
                value={relatedTxnId}
                onChange={(e) => setRelatedTxnId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="">None / General Refund</option>
                {recentTxns.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.transaction_number} — {t.customer_name} ({t.description})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount (₱)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Remarks (Optional)</label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Receipt no. or notes"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <p className="text-[11px] text-slate-500">
            {movementType === 'inventory_replenishment'
              ? 'Note: Inventory replenishment deducts from the selected wallet without inflating business expenses or counting as customer sales.'
              : movementType === 'refund'
                ? 'Note: Refunds deduct from the selected wallet and appear in Refund Obligations on the Monthly Report.'
                : 'Note: Business expenses deduct from the selected wallet and reduce Net Earnings.'}
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50"
          >
            {submitting
              ? 'Recording...'
              : movementType === 'refund'
                ? 'Record Refund'
                : movementType === 'inventory_replenishment'
                  ? 'Record Inventory Purchase'
                  : 'Record Business Expense'}
          </button>
        </form>

        {/* Expense History */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-900">Expense &amp; Outflow History</h3>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              {[
                { id: 'all', label: 'All' },
                { id: 'expense', label: 'Expenses' },
                { id: 'inventory_replenishment', label: 'Load Stock' },
                { id: 'refund', label: 'Refunds' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilterType(t.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filterType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Ref #</th>
                  <th className="py-2.5 px-4 font-medium">Date</th>
                  <th className="py-2.5 px-4 font-medium">Category</th>
                  <th className="py-2.5 px-4 font-medium">Description</th>
                  <th className="py-2.5 px-4 font-medium">Wallet</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Loading expenses...
                    </td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No records found.
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp) => (
                    <tr key={exp.id} className={exp.status === 'voided' ? 'opacity-50' : 'hover:bg-slate-50'}>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 money whitespace-nowrap">
                        {exp.expense_number}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 money whitespace-nowrap">
                        {formatDateTime(exp.expense_date)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {exp.refund_category_name || exp.category}
                      </td>
                      <td className="py-2.5 px-4 text-slate-800">
                        <div>{exp.description}</div>
                        {exp.related_transaction_number && (
                          <span className="text-[11px] text-slate-500 money">
                            Ref: {exp.related_transaction_number}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">{exp.wallet_name}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-red-700 money whitespace-nowrap">
                        -{formatPeso(exp.amount_cents)}
                      </td>
                      <td className="py-2.5 px-4">
                        {exp.status === 'active' ? (
                          <button
                            onClick={() => handleVoid(exp)}
                            title="Void & Reverse"
                            className="inline-flex items-center gap-1 text-red-700 hover:underline"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </button>
                        ) : (
                          <span className="text-slate-400">Voided</span>
                        )}
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
