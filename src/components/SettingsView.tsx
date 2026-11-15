import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Save, ShieldCheck, CheckCircle2, Upload, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { centsToInputString, formatPeso, parseToCentavos } from '../lib/money';
import type { ReconciliationItem, Wallet } from '../types';

interface Props {
  wallets: Wallet[];
  onDataChanged: () => void;
}

export function SettingsView({ wallets, onDataChanged }: Props) {
  const [businessName, setBusinessName] = useState("Sheena & Shelo's Business");
  const [ownerName, setOwnerName] = useState('Sheena & Shelo');
  const [storeAddress, setStoreAddress] = useState('');
  const [savedNotice, setSavedNotice] = useState('');

  // Opening balance clean reset state
  const [openingInputs, setOpeningInputs] = useState<Record<string, string>>({});
  const [confirmMode, setConfirmMode] = useState<'none' | 'clean' | 'demo'>('none');
  const [reconciliation, setReconciliation] = useState<ReconciliationItem[]>([]);
  const [restoreError, setRestoreError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.getSettings().then((res) => {
      if (res.settings.business_name) setBusinessName(res.settings.business_name);
      if (res.settings.owner_name) setOwnerName(res.settings.owner_name);
      if (res.settings.store_address) setStoreAddress(res.settings.store_address);
    });
    api.reconcileWallets().then((res) => setReconciliation(res.items));
  }, [wallets]);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const w of wallets) {
      map[w.wallet_name] = centsToInputString(w.opening_balance_cents);
    }
    setOpeningInputs(map);
  }, [wallets]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.saveSettings({
      business_name: businessName,
      owner_name: ownerName,
      store_address: storeAddress,
    });
    setSavedNotice('Business settings saved.');
    setTimeout(() => setSavedNotice(''), 3000);
  };

  const handleDownloadBackup = async () => {
    const snapshot = await api.getBackup();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheena-shelo-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError('');
    setRestoring(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api.restoreBackup(parsed);
      setSavedNotice('JSON backup restored successfully.');
      setTimeout(() => setSavedNotice(''), 4000);
      onDataChanged();
    } catch (err: any) {
      setRestoreError(err.message || 'Failed to restore JSON backup.');
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCleanReset = async () => {
    const openingBalances: Record<string, number> = {};
    for (const [name, val] of Object.entries(openingInputs)) {
      openingBalances[name] = parseToCentavos(val);
    }
    await api.resetData({ mode: 'clean_with_balances', opening_balances: openingBalances });
    setConfirmMode('none');
    setSavedNotice('Ledger reset cleanly with your custom opening balances.');
    onDataChanged();
  };

  const handleDemoReset = async () => {
    await api.resetData({ mode: 'demo' });
    setConfirmMode('none');
    setSavedNotice('Sample dataset restored.');
    onDataChanged();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Settings, Backup &amp; Ledger Controls</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage store details, download complete financial backups, verify ledger math, or initialize clean starting balances.
        </p>
      </div>

      {savedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Business Profile */}
      <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Business Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Business Name</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Owners / Cashier</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Location / Label</label>
            <input
              type="text"
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
        >
          <Save className="w-4 h-4" />
          Save Business Info
        </button>
      </form>

      {/* Backup & Reconciliation */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              Database Backup &amp; Ledger Integrity
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Export all transactions, wallet ledgers, audit logs, and services as JSON at any time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleRestoreBackup}
              className="hidden"
            />
            <button
              type="button"
              disabled={restoring}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {restoring ? 'Restoring...' : 'Restore JSON Backup'}
            </button>
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
            >
              <Download className="w-4 h-4" />
              Download Full JSON Backup
            </button>
          </div>
        </div>

        {restoreError && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            <span>{restoreError}</span>
          </div>
        )}

        <div className="border-t border-slate-100 pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {reconciliation.map((r) => (
            <div key={r.wallet_id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <p className="font-bold text-slate-900">{r.wallet_name}</p>
              <p className="money text-slate-700 mt-1">Balance: {formatPeso(r.computed_balance_cents)}</p>
              <p className={`mt-0.5 font-medium ${r.is_reconciled ? 'text-emerald-700' : 'text-red-700'}`}>
                {r.is_reconciled ? 'Ledger Reconciled' : `Mismatch: ${formatPeso(r.discrepancy_cents)}`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Initialize Clean Production Balances or Restore Demo */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Start Fresh with Real Opening Balances</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ready to replace your Google Sheet? Clear the sample transactions and set your actual starting balances for each wallet (keeps your configured services &amp; refund categories).
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {wallets.map((w) => (
            <div key={w.id}>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {w.wallet_name} (₱)
              </label>
              <input
                type="number"
                step="0.01"
                value={openingInputs[w.wallet_name] ?? '0.00'}
                onChange={(e) =>
                  setOpeningInputs((prev) => ({ ...prev, [w.wallet_name]: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg money"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          {confirmMode === 'clean' ? (
            <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-xs font-semibold text-red-900">
                Clear all transactions &amp; apply these opening balances?
              </span>
              <button
                onClick={handleCleanReset}
                className="px-3 py-1.5 text-xs font-semibold bg-red-700 text-white rounded-md"
              >
                Confirm Clean Start
              </button>
              <button
                onClick={() => setConfirmMode('none')}
                className="px-2.5 py-1.5 text-xs text-slate-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmMode('clean')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg"
            >
              <RotateCcw className="w-4 h-4" />
              Clear Transactions &amp; Set Opening Balances
            </button>
          )}

          {confirmMode === 'demo' ? (
            <div className="flex items-center gap-2 p-2.5 bg-slate-100 border border-slate-300 rounded-lg">
              <span className="text-xs font-semibold text-slate-900">Restore sample demo records?</span>
              <button
                onClick={handleDemoReset}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-md"
              >
                Yes, Restore
              </button>
              <button
                onClick={() => setConfirmMode('none')}
                className="px-2.5 py-1.5 text-xs text-slate-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmMode('demo')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Restore Sample Dataset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
