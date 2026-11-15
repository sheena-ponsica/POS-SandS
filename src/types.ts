export type ServiceCategory =
  | 'loading'
  | 'cash_in_out'
  | 'printing'
  | 'extra_services';

export type PaymentStatus = 'paid' | 'unpaid' | 'partial' | 'voided';

export type WalletType = 'cash' | 'ewallet' | 'bank';

export type MovementType = 'expense' | 'inventory_replenishment' | 'refund';

export interface Wallet {
  id: number;
  wallet_name: string;
  wallet_type: WalletType;
  opening_balance_cents: number;
  current_balance_cents: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  // Computed aggregates
  total_inflow_cents?: number;
  total_outflow_cents?: number;
  transfers_in_cents?: number;
  transfers_out_cents?: number;
  adjustments_net_cents?: number;
  recent_ledger?: WalletLedgerEntry[];
}

export interface WalletLedgerEntry {
  id: number;
  wallet_id: number;
  wallet_name?: string;
  reference_type: string;
  reference_id: number;
  reference_code: string;
  transaction_type: string;
  amount_in_cents: number;
  amount_out_cents: number;
  description: string;
  running_balance_cents: number;
  entry_date: string;
  created_at: string;
}

export interface ServiceItem {
  id: number;
  service_name: string;
  category: ServiceCategory;
  provider: string | null;
  default_price_cents: number;
  actual_cost_cents: number;
  description: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface TransactionRecord {
  id: number;
  transaction_number: string;
  idempotency_key: string | null;
  customer_name: string;
  service_category: ServiceCategory;
  service_type: string;
  description: string;
  provider: string | null;
  quantity: number;
  unit_price_cents: number;
  total_amount_cents: number;
  principal_amount_cents: number;
  actual_cost_cents: number;
  service_fee_cents: number;
  earnings_cents: number;
  payment_status: PaymentStatus;
  amount_paid_cents: number;
  assigned_wallet_id: number | null;
  assigned_wallet_name?: string | null;
  provider_wallet_id: number | null;
  provider_wallet_name?: string | null;
  payment_method: string;
  metadata_json: string | null;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionPayment {
  id: number;
  transaction_id: number;
  wallet_id: number;
  wallet_name?: string;
  amount_paid_cents: number;
  payment_method: string;
  payment_date: string;
  notes: string | null;
  created_at: string;
}

export interface TransactionAuditLog {
  id: number;
  transaction_id: number;
  action: string;
  actor: string;
  old_values_json: string | null;
  new_values_json: string | null;
  reason: string | null;
  created_at: string;
}

export interface TransactionDetail extends TransactionRecord {
  payments: TransactionPayment[];
  ledger_entries: WalletLedgerEntry[];
  audit_logs: TransactionAuditLog[];
}

export interface WalletTransfer {
  id: number;
  transfer_number: string;
  source_wallet_id: number;
  source_wallet_name?: string;
  destination_wallet_id: number;
  destination_wallet_name?: string;
  amount_cents: number;
  description: string;
  transfer_date: string;
  status: 'completed' | 'reversed';
  created_at: string;
}

export interface ExpenseRecord {
  id: number;
  expense_number: string;
  description: string;
  category: string;
  movement_type: MovementType;
  amount_cents: number;
  wallet_id: number;
  wallet_name?: string;
  related_transaction_id: number | null;
  related_transaction_number?: string | null;
  refund_category_id: number | null;
  refund_category_name?: string | null;
  expense_date: string;
  remarks: string | null;
  status: 'active' | 'voided';
  created_at: string;
}

export interface BalanceAdjustment {
  id: number;
  adjustment_number: string;
  wallet_id: number;
  wallet_name?: string;
  adjustment_type: 'increase' | 'decrease';
  amount_cents: number;
  reason: string;
  adjustment_date: string;
  created_at: string;
}

export interface RefundCategory {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
  created_at: string;
}

export interface RefundObligation {
  id: number;
  month_key: string; // YYYY-MM
  refund_category_id: number;
  refund_category_name?: string;
  amount_cents: number;
  notes: string | null;
  updated_at: string;
}

export interface DashboardSummary {
  month: string;
  today: string;
  kpis: {
    total_sales_today_cents: number;
    total_sales_month_cents: number;
    total_earnings_month_cents: number;
    total_expenses_month_cents: number;
    net_earnings_month_cents: number;
    total_unpaid_cents: number;
    total_recorded_balance_cents: number;
    unpaid_count: number;
  };
  wallets: Wallet[];
  category_breakdown: Array<{
    category: ServiceCategory;
    label: string;
    sales_cents: number;
    earnings_cents: number;
    transaction_count: number;
  }>;
  daily_trends: Array<{
    date: string;
    label: string;
    sales_cents: number;
    earnings_cents: number;
    expenses_cents: number;
  }>;
  monthly_trends: Array<{
    month: string;
    label: string;
    sales_cents: number;
    earnings_cents: number;
    expenses_cents: number;
  }>;
  recent_transactions: TransactionRecord[];
}

export interface ReconciliationItem {
  wallet_id: number;
  wallet_name: string;
  opening_balance_cents: number;
  total_in_cents: number;
  total_out_cents: number;
  computed_balance_cents: number;
  cached_balance_cents: number;
  is_reconciled: boolean;
  discrepancy_cents: number;
}
