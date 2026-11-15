import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ListOrdered,
  PlusCircle,
  Tags,
  Wallet as WalletIcon,
  ArrowRightLeft,
  Receipt,
  BarChart3,
  Settings,
  Menu,
  X,
  Plus,
} from 'lucide-react';
import { api } from './lib/api';
import { formatPeso, getLocalMonthKey, getLocalTodayDateString } from './lib/money';
import type { DashboardSummary, ServiceItem, Wallet } from './types';
import { DashboardView } from './components/DashboardView';
import { AddTransactionView } from './components/AddTransactionView';
import { TransactionsView } from './components/TransactionsView';
import { WalletsView } from './components/WalletsView';
import { TransfersView } from './components/TransfersView';
import { ExpensesView } from './components/ExpensesView';
import { ServicesView } from './components/ServicesView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { TransactionDetailModal } from './components/TransactionDetailModal';

type NavKey =
  | 'dashboard'
  | 'transactions'
  | 'add_transaction'
  | 'services'
  | 'wallets'
  | 'transfers'
  | 'expenses'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: any }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'transactions', label: 'Transactions', icon: ListOrdered },
  { key: 'add_transaction', label: 'Add Transaction', icon: PlusCircle },
  { key: 'services', label: 'Services & Pricing', icon: Tags },
  { key: 'wallets', label: 'Wallet Management', icon: WalletIcon },
  { key: 'transfers', label: 'Wallet Transfers', icon: ArrowRightLeft },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(() => getLocalMonthKey());
  const [dashboardData, setDashboardData] = useState<DashboardSummary | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [selectedWalletId, setSelectedWalletId] = useState<number | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(null);
  const [selectedTransactionMode, setSelectedTransactionMode] = useState<'view' | 'edit'>('view');

  const openTransactionModal = (id: number, mode: 'view' | 'edit' = 'view') => {
    setSelectedTransactionMode(mode);
    setSelectedTransactionId(id);
  };

  const loadCoreData = useCallback(async () => {
    setLoadingDashboard(true);
    try {
      const today = getLocalTodayDateString();
      const [dashRes, walletsRes, servicesRes] = await Promise.all([
        api.getDashboard(selectedMonth, today),
        api.getWallets(),
        api.getServices(),
      ]);
      setDashboardData(dashRes);
      setWallets(walletsRes.wallets);
      setServices(servicesRes.services);
    } finally {
      setLoadingDashboard(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData, refreshSignal]);

  const triggerRefresh = () => {
    setRefreshSignal((n) => n + 1);
  };

  const handleSelectWalletFromDashboard = (walletId: number) => {
    setSelectedWalletId(walletId);
    setActiveNav('wallets');
  };

  const currentNavLabel = NAV_ITEMS.find((n) => n.key === activeNav)?.label ?? 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 shrink-0 sticky top-0 h-screen">
        <div className="px-6 py-5 border-b border-slate-200">
          <h1 className="text-base font-extrabold tracking-tight text-slate-900">
            Sheena &amp; Shelo&apos;s
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">POS &amp; Financial Ledger</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveNav(item.key)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 text-emerald-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Compact Wallet Balance Quick Reference in Sidebar */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/70 space-y-2">
          <p className="text-[11px] font-semibold text-slate-500">Wallet Balances</p>
          {wallets.slice(0, 4).map((w) => (
            <button
              key={w.id}
              onClick={() => handleSelectWalletFromDashboard(w.id)}
              className="w-full flex items-center justify-between text-xs hover:bg-slate-100 px-1.5 py-1 rounded transition-colors"
            >
              <span className="text-slate-700 truncate">{w.wallet_name}</span>
              <span
                className={`money font-semibold ${
                  w.current_balance_cents < 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {formatPeso(w.current_balance_cents)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h1 className="text-sm font-extrabold text-slate-900">Sheena &amp; Shelo&apos;s</h1>
                <p className="text-[11px] text-slate-500">POS &amp; Financial Ledger</p>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg ${
                      active
                        ? 'bg-emerald-50 text-emerald-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Sticky Top Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">Sheena &amp; Shelo&apos;s Business</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeNav !== 'add_transaction' && (
              <button
                onClick={() => setActiveNav('add_transaction')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add Transaction
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeNav === 'dashboard' && (
            <DashboardView
              data={dashboardData}
              loading={loadingDashboard}
              selectedMonth={selectedMonth}
              onMonthChange={setSelectedMonth}
              onSelectWallet={handleSelectWalletFromDashboard}
              onSelectTransaction={(id) => openTransactionModal(id, 'view')}
              onQuickAdd={() => setActiveNav('add_transaction')}
            />
          )}

          {activeNav === 'transactions' && (
            <TransactionsView
              wallets={wallets}
              refreshSignal={refreshSignal}
              onSelectTransaction={(id, mode) => openTransactionModal(id, mode || 'view')}
              onQuickAdd={() => setActiveNav('add_transaction')}
            />
          )}

          {activeNav === 'add_transaction' && (
            <AddTransactionView
              wallets={wallets}
              services={services}
              onSaved={() => triggerRefresh()}
              onViewTransaction={(id) => openTransactionModal(id, 'view')}
            />
          )}

          {activeNav === 'services' && (
            <ServicesView services={services} onDataChanged={triggerRefresh} />
          )}

          {activeNav === 'wallets' && (
            <WalletsView
              wallets={wallets}
              selectedWalletId={selectedWalletId}
              onSelectWallet={(id) => setSelectedWalletId(id)}
              onDataChanged={triggerRefresh}
            />
          )}

          {activeNav === 'transfers' && (
            <TransfersView wallets={wallets} onDataChanged={triggerRefresh} />
          )}

          {activeNav === 'expenses' && (
            <ExpensesView wallets={wallets} onDataChanged={triggerRefresh} />
          )}

          {activeNav === 'reports' && (
            <ReportsView onSelectTransaction={(id) => setSelectedTransactionId(id)} />
          )}

          {activeNav === 'settings' && (
            <SettingsView wallets={wallets} onDataChanged={triggerRefresh} />
          )}
        </main>
      </div>

      {/* Transaction Detail & Settlement / Edit / Void Modal */}
      <TransactionDetailModal
        transactionId={selectedTransactionId}
        initialMode={selectedTransactionMode}
        wallets={wallets}
        onClose={() => setSelectedTransactionId(null)}
        onUpdated={triggerRefresh}
      />
    </div>
  );
}
