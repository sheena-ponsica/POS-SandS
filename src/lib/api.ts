import type {
  BalanceAdjustment,
  DashboardSummary,
  ExpenseRecord,
  ReconciliationItem,
  RefundCategory,
  ServiceItem,
  TransactionDetail,
  TransactionRecord,
  Wallet,
  WalletLedgerEntry,
  WalletTransfer,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getDashboard: (month?: string, today?: string) => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (today) params.set('today', today);
    return request<DashboardSummary>(`/api/dashboard?${params.toString()}`);
  },

  // Wallets
  getWallets: () => request<{ wallets: Wallet[] }>('/api/wallets'),
  createWallet: (payload: { wallet_name: string; wallet_type: string; opening_balance_cents: number }) =>
    request<{ wallet: Wallet }>('/api/wallets', { method: 'POST', body: JSON.stringify(payload) }),
  getWalletLedger: (
    walletId: number,
    filters?: { start_date?: string; end_date?: string; type?: string }
  ) => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    if (filters?.type) params.set('type', filters.type);
    return request<{ wallet: Wallet; entries: WalletLedgerEntry[] }>(
      `/api/wallets/${walletId}/ledger?${params.toString()}`
    );
  },
  reconcileWallets: () => request<{ items: ReconciliationItem[] }>('/api/wallets/reconcile'),
  getAdjustments: () => request<{ adjustments: BalanceAdjustment[] }>('/api/wallets/adjustments'),
  createAdjustment: (payload: {
    idempotency_key: string;
    wallet_id: number;
    adjustment_type: 'increase' | 'decrease';
    amount_cents: number;
    reason: string;
    adjustment_date?: string;
  }) =>
    request<{ adjustment: BalanceAdjustment; duplicate: boolean }>('/api/wallets/adjustments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Transfers
  getTransfers: () => request<{ transfers: WalletTransfer[] }>('/api/transfers'),
  createTransfer: (payload: {
    idempotency_key: string;
    source_wallet_id: number;
    destination_wallet_id: number;
    amount_cents: number;
    description: string;
    transfer_date?: string;
  }) =>
    request<{ transfer: WalletTransfer; duplicate: boolean }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Transactions
  getTransactions: (filters?: {
    search?: string;
    category?: string;
    status?: string;
    wallet_id?: string;
    payment_method?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters?.wallet_id && filters.wallet_id !== 'all') params.set('wallet_id', filters.wallet_id);
    if (filters?.payment_method && filters.payment_method !== 'all')
      params.set('payment_method', filters.payment_method);
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    return request<{ transactions: TransactionRecord[] }>(`/api/transactions?${params.toString()}`);
  },
  getTransactionDetail: (id: number) =>
    request<{ transaction: TransactionDetail }>(`/api/transactions/${id}`),
  createTransaction: (payload: Record<string, unknown>) =>
    request<{ transaction: TransactionRecord; duplicate: boolean }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  editTransaction: (id: number, payload: Record<string, unknown>) =>
    request<{ transaction: TransactionRecord }>(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  recordPayment: (
    id: number,
    payload: {
      wallet_id: number;
      amount_paid_cents: number;
      payment_method?: string;
      payment_date?: string;
      notes?: string;
      idempotency_key: string;
    }
  ) =>
    request<{ transaction: TransactionRecord; duplicate: boolean }>(`/api/transactions/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  voidTransaction: (id: number, reason: string) =>
    request<{ transaction: TransactionRecord }>(`/api/transactions/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Expenses
  getExpenses: (filters?: {
    movement_type?: string;
    wallet_id?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.movement_type && filters.movement_type !== 'all')
      params.set('movement_type', filters.movement_type);
    if (filters?.wallet_id && filters.wallet_id !== 'all') params.set('wallet_id', filters.wallet_id);
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    return request<{ expenses: ExpenseRecord[] }>(`/api/expenses?${params.toString()}`);
  },
  createExpense: (payload: Record<string, unknown>) =>
    request<{ expense: ExpenseRecord; duplicate: boolean }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  voidExpense: (id: number, reason: string) =>
    request<{ expense: ExpenseRecord }>(`/api/expenses/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Services
  getServices: () => request<{ services: ServiceItem[] }>('/api/services'),
  createService: (payload: Record<string, unknown>) =>
    request<{ service: ServiceItem }>('/api/services', { method: 'POST', body: JSON.stringify(payload) }),
  updateService: (id: number, payload: Record<string, unknown>) =>
    request<{ service: ServiceItem }>(`/api/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  toggleServiceStatus: (id: number, status: 'active' | 'inactive') =>
    request<{ service: ServiceItem }>(`/api/services/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Reports
  getDailyReport: (date: string) => request<any>(`/api/reports/daily?date=${encodeURIComponent(date)}`),
  getMonthlyReport: (year: string, month?: string) => {
    const params = new URLSearchParams({ year });
    if (month) params.set('month', month);
    return request<any>(`/api/reports/monthly?${params.toString()}`);
  },
  getWalletReport: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    return request<any>(`/api/reports/wallets?${params.toString()}`);
  },
  getRefundCategories: () => request<{ categories: RefundCategory[] }>('/api/reports/refund-categories'),
  createRefundCategory: (payload: { name: string; description?: string }) =>
    request<{ category: RefundCategory }>('/api/reports/refund-categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRefundCategory: (id: number, payload: { name?: string; description?: string; is_active?: boolean }) =>
    request<{ category: RefundCategory }>(`/api/reports/refund-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  saveRefundObligation: (payload: {
    month_key: string;
    refund_category_id: number;
    amount_cents: number;
    notes?: string;
  }) =>
    request<{ ok: boolean }>('/api/reports/refund-obligations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Settings & Backup
  getSettings: () => request<{ settings: Record<string, string> }>('/api/settings'),
  saveSettings: (settings: Record<string, string>) =>
    request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),
  getBackup: () => request<any>('/api/settings/backup'),
  restoreBackup: (snapshot: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/settings/restore', { method: 'POST', body: JSON.stringify(snapshot) }),
  resetData: (payload: { mode: 'demo' | 'clean_with_balances'; opening_balances?: Record<string, number> }) =>
    request<{ ok: boolean }>('/api/settings/reset', { method: 'POST', body: JSON.stringify(payload) }),
};
