import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import {
  centsToInputString,
  formatPeso,
  parseToCentavos,
  toLocalDateTimeInputValue,
} from '../lib/money';
import type { ServiceCategory, ServiceItem, TransactionRecord, Wallet } from '../types';

interface Props {
  wallets: Wallet[];
  services: ServiceItem[];
  onSaved: (txn: TransactionRecord) => void;
  onViewTransaction: (id: number) => void;
}

const NETWORK_OPTIONS = ['Globe', 'Smart', 'DITO', 'TNT', 'TM', 'GOMO', 'Cignal', 'SatLite', 'Other'];

export function AddTransactionView({ wallets, services, onSaved, onViewTransaction }: Props) {
  const activeWallets = useMemo(() => wallets.filter((w) => w.status === 'active'), [wallets]);
  const cashWallet = activeWallets.find((w) => w.wallet_type === 'cash') ?? activeWallets[0];
  const gcashWallet = activeWallets.find((w) => w.wallet_name.toLowerCase().includes('gcash')) ?? activeWallets[0];
  const mayaWallet = activeWallets.find((w) => w.wallet_name.toLowerCase().includes('maya')) ?? activeWallets[0];

  const [category, setCategory] = useState<ServiceCategory>('loading');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedTxn, setSavedTxn] = useState<TransactionRecord | null>(null);

  // Common fields
  const [customerName, setCustomerName] = useState('');
  const [txnDate, setTxnDate] = useState(() => toLocalDateTimeInputValue());
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid' | 'partial'>('paid');
  const [partialPaid, setPartialPaid] = useState('');
  const [assignedWalletId, setAssignedWalletId] = useState<number>(cashWallet?.id ?? 1);

  // Loading fields
  const [loadingKind, setLoadingKind] = useState<'Mobile Load' | 'TV Cable Load'>('Mobile Load');
  const [provider, setProvider] = useState('Globe');
  const [loadProduct, setLoadProduct] = useState('');
  const [loadPrice, setLoadPrice] = useState('');
  const [loadCost, setLoadCost] = useState('');

  // Cash-in / Cash-out fields
  const [cashFlowType, setCashFlowType] = useState<'Cash-in' | 'Cash-out'>('Cash-in');
  const [cashProvider, setCashProvider] = useState<'GCash' | 'Maya'>('GCash');
  const [cashPrincipal, setCashPrincipal] = useState('');
  const [cashFee, setCashFee] = useState('');
  const [feeWalletMode, setFeeWalletMode] = useState<'settlement' | 'provider'>('settlement');

  // Printing fields
  const [printServiceType, setPrintServiceType] = useState('Document Printing');
  const [printDescription, setPrintDescription] = useState('');
  const [printCopies, setPrintCopies] = useState('');
  const [printUnitPrice, setPrintUnitPrice] = useState('');
  const [printTotal, setPrintTotal] = useState('');
  const [printCost, setPrintCost] = useState('0.00');

  // Extra Services fields
  const [extraServiceName, setExtraServiceName] = useState('Layouting & Graphic Design');
  const [extraDescription, setExtraDescription] = useState('');
  const [extraTotal, setExtraTotal] = useState('');
  const [extraCost, setExtraCost] = useState('0.00');

  useEffect(() => {
    if (!assignedWalletId && cashWallet) {
      setAssignedWalletId(cashWallet.id);
    }
  }, [cashWallet, assignedWalletId]);

  const categoryPresets = useMemo(
    () => services.filter((s) => s.status === 'active' && s.category === category),
    [services, category]
  );

  const applyPreset = (s: ServiceItem) => {
    if (category === 'loading') {
      setLoadProduct(s.service_name);
      setProvider(s.provider || 'Globe');
      setLoadingKind(s.provider === 'Cignal' || s.provider === 'SatLite' ? 'TV Cable Load' : 'Mobile Load');
      setLoadPrice(centsToInputString(s.default_price_cents));
      setLoadCost(centsToInputString(s.actual_cost_cents));
    } else if (category === 'cash_in_out') {
      const isOut = s.service_name.toLowerCase().includes('out');
      setCashFlowType(isOut ? 'Cash-out' : 'Cash-in');
      setCashProvider(s.provider === 'Maya' ? 'Maya' : 'GCash');
      setCashFee(centsToInputString(s.default_price_cents));
    } else if (category === 'printing') {
      setPrintServiceType(s.service_name);
      setPrintDescription(s.service_name);
      setPrintUnitPrice(centsToInputString(s.default_price_cents));
      const qty = Math.max(1, Number(printCopies || 1));
      setPrintCopies(String(qty));
      setPrintTotal(centsToInputString(s.default_price_cents * qty));
      setPrintCost(centsToInputString(s.actual_cost_cents * qty));
    } else {
      setExtraServiceName(s.service_name);
      setExtraDescription(s.description || s.service_name);
      setExtraTotal(centsToInputString(s.default_price_cents));
      setExtraCost(centsToInputString(s.actual_cost_cents));
    }
  };

  // Auto-calculate printing total when copies & unit price are both entered
  const handleCopiesOrPriceChange = (copiesStr: string, priceStr: string) => {
    setPrintCopies(copiesStr);
    setPrintUnitPrice(priceStr);
    const qty = Number(copiesStr);
    const unitCents = parseToCentavos(priceStr);
    if (qty > 0 && unitCents > 0) {
      setPrintTotal(centsToInputString(Math.round(qty) * unitCents));
    }
  };

  // Live financial preview calculation
  const preview = useMemo(() => {
    if (category === 'loading') {
      const gross = parseToCentavos(loadPrice);
      const cost = parseToCentavos(loadCost);
      const earnings = gross - cost;
      return {
        grossCents: gross,
        costCents: cost,
        earningsCents: earnings,
        collectibleCents: gross,
      };
    }
    if (category === 'cash_in_out') {
      const principal = parseToCentavos(cashPrincipal);
      const fee = parseToCentavos(cashFee);
      return {
        grossCents: fee, // Recognized service fee sales
        principalCents: principal,
        costCents: 0,
        earningsCents: fee,
        collectibleCents: principal + fee,
      };
    }
    if (category === 'printing') {
      const gross = parseToCentavos(printTotal);
      const cost = parseToCentavos(printCost);
      return {
        grossCents: gross,
        costCents: cost,
        earningsCents: gross - cost,
        collectibleCents: gross,
      };
    }
    const gross = parseToCentavos(extraTotal);
    const cost = parseToCentavos(extraCost);
    return {
      grossCents: gross,
      costCents: cost,
      earningsCents: gross - cost,
      collectibleCents: gross,
    };
  }, [category, loadPrice, loadCost, cashPrincipal, cashFee, printTotal, printCost, extraTotal, extraCost]);

  const providerWalletObj = cashProvider === 'Maya' ? mayaWallet : gcashWallet;
  const settlementWalletObj = activeWallets.find((w) => w.id === assignedWalletId) ?? cashWallet;

  const resetFormForNext = () => {
    setIdempotencyKey(crypto.randomUUID());
    setCustomerName('');
    setTxnDate(toLocalDateTimeInputValue());
    setPaymentStatus('paid');
    setPartialPaid('');
    setLoadProduct('');
    setLoadPrice('');
    setLoadCost('');
    setCashPrincipal('');
    setCashFee('');
    setPrintDescription('');
    setPrintCopies('');
    setPrintUnitPrice('');
    setPrintTotal('');
    setPrintCost('0.00');
    setExtraDescription('');
    setExtraTotal('');
    setExtraCost('0.00');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSavedTxn(null);
    setSubmitting(true);

    try {
      const isoDate = new Date(txnDate).toISOString();
      const payload: Record<string, unknown> = {
        idempotency_key: idempotencyKey,
        customer_name: customerName.trim() || 'Walk-in Customer',
        service_category: category,
        payment_status: paymentStatus,
        amount_paid_cents:
          paymentStatus === 'partial' ? parseToCentavos(partialPaid) : undefined,
        assigned_wallet_id: paymentStatus === 'unpaid' && category !== 'cash_in_out' ? null : assignedWalletId,
        transaction_date: isoDate,
      };

      if (category === 'loading') {
        payload.service_type = loadingKind;
        payload.provider = provider;
        payload.description = loadProduct.trim() || `${provider} ${loadingKind}`;
        payload.total_amount_cents = parseToCentavos(loadPrice);
        payload.actual_cost_cents = parseToCentavos(loadCost);
        payload.payment_method = paymentStatus === 'unpaid' ? 'Unpaid' : settlementWalletObj?.wallet_name;
      } else if (category === 'cash_in_out') {
        const feeWalletId =
          cashFlowType === 'Cash-out' && feeWalletMode === 'provider'
            ? providerWalletObj?.id
            : assignedWalletId;
        payload.service_type = cashFlowType;
        payload.provider = cashProvider;
        payload.description = `${cashProvider} ${cashFlowType} ₱${(parseToCentavos(cashPrincipal) / 100).toLocaleString('en-PH')}`;
        payload.principal_amount_cents = parseToCentavos(cashPrincipal);
        payload.service_fee_cents = parseToCentavos(cashFee);
        payload.total_amount_cents = parseToCentavos(cashFee);
        payload.provider_wallet_id = providerWalletObj?.id;
        payload.fee_wallet_id = feeWalletId;
        payload.payment_method =
          paymentStatus === 'unpaid'
            ? 'Unpaid'
            : cashFlowType === 'Cash-in'
              ? settlementWalletObj?.wallet_name
              : cashProvider;
      } else if (category === 'printing') {
        payload.service_type = printServiceType.trim() || 'Printing / Photocopy';
        payload.description = printDescription.trim() || printServiceType;
        payload.quantity = Math.max(1, Math.round(Number(printCopies || 1)));
        payload.unit_price_cents = parseToCentavos(printUnitPrice || printTotal);
        payload.total_amount_cents = parseToCentavos(printTotal);
        payload.actual_cost_cents = parseToCentavos(printCost);
        payload.payment_method = paymentStatus === 'unpaid' ? 'Unpaid' : settlementWalletObj?.wallet_name;
      } else {
        payload.service_type = extraServiceName.trim() || 'Extra Service';
        payload.description = extraDescription.trim() || extraServiceName;
        payload.total_amount_cents = parseToCentavos(extraTotal);
        payload.actual_cost_cents = parseToCentavos(extraCost);
        payload.payment_method = paymentStatus === 'unpaid' ? 'Unpaid' : settlementWalletObj?.wallet_name;
      }

      const res = await api.createTransaction(payload);
      setSavedTxn(res.transaction);
      onSaved(res.transaction);
      resetFormForNext();
    } catch (err: any) {
      setError(err.message || 'Failed to record transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Quick Transaction Entry</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select a service category to display relevant fields. Every entry automatically updates the assigned wallet ledger.
        </p>
      </div>

      {savedTxn && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <div className="text-sm">
              <span className="font-bold money">{savedTxn.transaction_number}</span> recorded for{' '}
              <span className="font-semibold">{savedTxn.customer_name}</span>.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onViewTransaction(savedTxn.id)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline"
          >
            Inspect Ledger &amp; Receipt
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-sm text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Category Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-slate-100 rounded-xl">
        {(
          [
            { id: 'loading', label: 'Loading' },
            { id: 'cash_in_out', label: 'GCash / Maya Cash-in/out' },
            { id: 'printing', label: 'Printing / Photocopy' },
            { id: 'extra_services', label: 'Extra Services' },
          ] as Array<{ id: ServiceCategory; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setCategory(tab.id);
              setError('');
            }}
            className={`px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              category === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Preset Products */}
      {categoryPresets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 mb-2.5">
            Quick-Fill from Configured Services
          </p>
          <div className="flex flex-wrap gap-2">
            {categoryPresets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => applyPreset(s)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-800 transition-colors"
              >
                {s.service_name} · <span className="money text-emerald-700">{formatPeso(s.default_price_cents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Form Fields */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in Customer"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Transaction Date &amp; Time
              </label>
              <input
                type="datetime-local"
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
          </div>

          {/* LOADING FIELDS */}
          {category === 'loading' && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Load Type</label>
                  <select
                    value={loadingKind}
                    onChange={(e) => setLoadingKind(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Mobile Load">All-Network Mobile Load</option>
                    <option value="TV Cable Load">TV Cable Loading</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Network / Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {NETWORK_OPTIONS.map((net) => (
                      <option key={net} value={net}>
                        {net}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Load Product / Description
                </label>
                <input
                  type="text"
                  value={loadProduct}
                  onChange={(e) => setLoadProduct(e.target.value)}
                  placeholder="e.g. Go50, Giga Video 99, Cignal 300"
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Customer Payment Amount (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={loadPrice}
                    onChange={(e) => setLoadPrice(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Actual Load Cost (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={loadCost}
                    onChange={(e) => setLoadCost(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
              </div>
            </div>
          )}

          {/* CASH-IN / CASH-OUT FIELDS */}
          {category === 'cash_in_out' && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Transaction Type
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                    {(['Cash-in', 'Cash-out'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setCashFlowType(type)}
                        className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                          cashFlowType === type
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    E-Wallet Provider
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                    {(['GCash', 'Maya'] as const).map((prov) => (
                      <button
                        key={prov}
                        type="button"
                        onClick={() => setCashProvider(prov)}
                        className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                          cashProvider === prov
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        {prov}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Transaction Amount (Principal ₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={cashPrincipal}
                    onChange={(e) => setCashPrincipal(e.target.value)}
                    placeholder="1000.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Service Fee (Business Earnings ₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashFee}
                    onChange={(e) => setCashFee(e.target.value)}
                    placeholder="20.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
              </div>

              {cashFlowType === 'Cash-out' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Where is the Service Fee Collected?
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={feeWalletMode === 'settlement'}
                        onChange={() => setFeeWalletMode('settlement')}
                      />
                      Collected in Settlement Cash ({settlementWalletObj?.wallet_name})
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={feeWalletMode === 'provider'}
                        onChange={() => setFeeWalletMode('provider')}
                      />
                      Sent inside {cashProvider} E-Wallet
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PRINTING FIELDS */}
          {category === 'printing' && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Service Type
                  </label>
                  <input
                    type="text"
                    value={printServiceType}
                    onChange={(e) => setPrintServiceType(e.target.value)}
                    placeholder="Photocopy, Document Printing, 2x2 ID Picture"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Service Description
                  </label>
                  <input
                    type="text"
                    value={printDescription}
                    onChange={(e) => setPrintDescription(e.target.value)}
                    placeholder="e.g. 15 pages B&W printing"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Copies / Pages (Opt.)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={printCopies}
                    onChange={(e) => handleCopiesOrPriceChange(e.target.value, printUnitPrice)}
                    placeholder="1"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Price / Copy (Opt.)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={printUnitPrice}
                    onChange={(e) => handleCopiesOrPriceChange(printCopies, e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Amount (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={printTotal}
                    onChange={(e) => setPrintTotal(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Material Cost (Opt.)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={printCost}
                    onChange={(e) => setPrintCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
              </div>
            </div>
          )}

          {/* EXTRA SERVICES FIELDS */}
          {category === 'extra_services' && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Service Name
                  </label>
                  <input
                    type="text"
                    value={extraServiceName}
                    onChange={(e) => setExtraServiceName(e.target.value)}
                    placeholder="Layouting, Graphic Design, Resume Making"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Description / Remarks
                  </label>
                  <input
                    type="text"
                    value={extraDescription}
                    onChange={(e) => setExtraDescription(e.target.value)}
                    placeholder="Details of design or document work"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Amount Charged (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={extraTotal}
                    onChange={(e) => setExtraTotal(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    Direct Expenses (Optional ₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={extraCost}
                    onChange={(e) => setExtraCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT STATUS & WALLET ASSIGNMENT */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Payment Status</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid (Utang / Receivable)</option>
                {category !== 'cash_in_out' && <option value="partial">Partially Paid</option>}
              </select>
            </div>

            {(paymentStatus !== 'unpaid' || category === 'cash_in_out') && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {category === 'cash_in_out'
                    ? cashFlowType === 'Cash-in'
                      ? 'Settlement Wallet (Cash Received)'
                      : 'Disbursement Wallet (Cash Released)'
                    : 'Assigned Payment Wallet'}
                </label>
                <select
                  value={assignedWalletId}
                  onChange={(e) => setAssignedWalletId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {activeWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.wallet_name} ({formatPeso(w.current_balance_cents)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {paymentStatus === 'partial' && category !== 'cash_in_out' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Amount Collected Now (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={partialPaid}
                  onChange={(e) => setPartialPaid(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
                />
              </div>
            )}
          </div>
        </div>

        {/* Live Accounting & Wallet Movement Preview */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Accounting &amp; Wallet Preview</h3>

            <div className="space-y-2.5 text-xs">
              {category === 'cash_in_out' ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Transaction Principal</span>
                    <span className="font-semibold text-slate-900 money">
                      {formatPeso(preview.principalCents ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Service Fee (Sales &amp; Earnings)</span>
                    <span className="font-bold text-emerald-700 money">
                      {formatPeso(preview.earningsCents)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-100">
                    <span className="font-semibold text-slate-800">
                      Total {cashFlowType === 'Cash-in' ? 'Collected' : 'Settled'}
                    </span>
                    <span className="font-bold text-slate-900 money">
                      {formatPeso(preview.collectibleCents)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Customer Charge</span>
                    <span className="font-bold text-slate-900 money">
                      {formatPeso(preview.grossCents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Actual / Direct Cost</span>
                    <span className="font-medium text-slate-700 money">
                      {formatPeso(preview.costCents)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-100">
                    <span className="font-semibold text-slate-800">Business Earnings</span>
                    <span
                      className={`font-bold money ${
                        preview.earningsCents >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {formatPeso(preview.earningsCents)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Expected Wallet Impact</p>
              {paymentStatus === 'unpaid' && category !== 'cash_in_out' ? (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  No wallet balances will change. ₱{(preview.collectibleCents / 100).toFixed(2)} will be
                  recorded under Unpaid Transactions.
                </p>
              ) : category === 'cash_in_out' ? (
                <div className="space-y-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {cashFlowType === 'Cash-in' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-700">{providerWalletObj?.wallet_name}</span>
                        <span className="font-semibold text-red-700 money">
                          -{formatPeso(preview.principalCents ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-700">{settlementWalletObj?.wallet_name}</span>
                        <span className="font-semibold text-emerald-700 money">
                          {paymentStatus === 'unpaid'
                            ? '₱0.00 (Unpaid)'
                            : `+${formatPeso(preview.collectibleCents)}`}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-700">{providerWalletObj?.wallet_name}</span>
                        <span className="font-semibold text-emerald-700 money">
                          +
                          {formatPeso(
                            (preview.principalCents ?? 0) +
                              (feeWalletMode === 'provider' ? preview.earningsCents : 0)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-700">{settlementWalletObj?.wallet_name}</span>
                        <span className="font-semibold text-red-700 money">
                          -{formatPeso(preview.principalCents ?? 0)}
                          {feeWalletMode === 'settlement' && preview.earningsCents > 0
                            ? ` / +${formatPeso(preview.earningsCents)} fee`
                            : ''}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs flex justify-between items-center">
                  <span className="font-medium text-slate-800">{settlementWalletObj?.wallet_name}</span>
                  <span className="font-bold text-emerald-700 money">
                    +
                    {formatPeso(
                      paymentStatus === 'partial'
                        ? parseToCentavos(partialPaid)
                        : preview.collectibleCents
                    )}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Unrelated wallets remain completely untouched.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving Transaction...' : 'Confirm & Record Transaction'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
