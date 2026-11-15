import express from 'express';
import { getDb, initSchema, runInTransaction } from './db.ts';
import {
  bootstrapAndSeedDatabase,
  createBalanceAdjustment,
  createExpense,
  createTransaction,
  createWalletTransfer,
  editTransaction,
  ensureDatabaseReady,
  getCollectibleCents,
  reconcileAllWallets,
  recordTransactionPayment,
  recomputeWalletLedger,
  resetInitCache,
  restoreSnapshotFromJson,
  voidExpense,
  voidTransaction,
} from './accounting.ts';

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMonthKeyString(): string {
  return getTodayDateString().slice(0, 7);
}

async function enrichWallets() {
  const db = await getDb();
  const wallets = await db.all<any>('SELECT * FROM wallets ORDER BY id ASC');
  const enriched = [];

  for (const w of wallets) {
    const agg = (await db.get<any>(
      `SELECT
        COALESCE(SUM(amount_in_cents), 0) AS total_inflow_cents,
        COALESCE(SUM(amount_out_cents), 0) AS total_outflow_cents,
        COALESCE(SUM(CASE WHEN reference_type = 'transfer' THEN amount_in_cents ELSE 0 END), 0) AS transfers_in_cents,
        COALESCE(SUM(CASE WHEN reference_type = 'transfer' THEN amount_out_cents ELSE 0 END), 0) AS transfers_out_cents,
        COALESCE(SUM(CASE WHEN reference_type = 'adjustment' THEN amount_in_cents - amount_out_cents ELSE 0 END), 0) AS adjustments_net_cents
      FROM wallet_ledger
      WHERE wallet_id = ?`,
      [w.id]
    )) ?? {
      total_inflow_cents: 0,
      total_outflow_cents: 0,
      transfers_in_cents: 0,
      transfers_out_cents: 0,
      adjustments_net_cents: 0,
    };

    const recentLedger = await db.all<any>(
      `SELECT l.*, w.wallet_name
       FROM wallet_ledger l
       JOIN wallets w ON w.id = l.wallet_id
       WHERE l.wallet_id = ?
       ORDER BY l.entry_date DESC, l.id DESC
       LIMIT 5`,
      [w.id]
    );

    enriched.push({
      ...w,
      opening_balance_cents: Number(w.opening_balance_cents),
      current_balance_cents: Number(w.current_balance_cents),
      total_inflow_cents: Number(agg.total_inflow_cents),
      total_outflow_cents: Number(agg.total_outflow_cents),
      transfers_in_cents: Number(agg.transfers_in_cents),
      transfers_out_cents: Number(agg.transfers_out_cents),
      adjustments_net_cents: Number(agg.adjustments_net_cents),
      recent_ledger: recentLedger,
    });
  }

  return enriched;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureDatabaseReady();
      next();
    } catch (err) {
      next(err);
    }
  });

  // ---------------- DASHBOARD ----------------
  app.get('/api/dashboard', async (req, res) => {
    try {
      const db = await getDb();
      const today =
        typeof req.query.today === 'string' && req.query.today ? req.query.today : getTodayDateString();
      const month =
        typeof req.query.month === 'string' && req.query.month ? req.query.month : today.slice(0, 7);

      const salesTodayRow = (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(total_amount_cents), 0) AS total
         FROM transactions
         WHERE payment_status = 'paid' AND substr(transaction_date, 1, 10) = ?`,
        [today]
      )) ?? { total: 0 };

      const salesMonthRow = (await db.get<{ total_sales: number; total_earnings: number }>(
        `SELECT
          COALESCE(SUM(total_amount_cents), 0) AS total_sales,
          COALESCE(SUM(earnings_cents), 0) AS total_earnings
         FROM transactions
         WHERE payment_status = 'paid' AND substr(transaction_date, 1, 7) = ?`,
        [month]
      )) ?? { total_sales: 0, total_earnings: 0 };

      const expensesMonthRow = (await db.get<{ total_expenses: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_expenses
         FROM expenses
         WHERE status = 'active' AND movement_type = 'expense' AND substr(expense_date, 1, 7) = ?`,
        [month]
      )) ?? { total_expenses: 0 };

      const unpaidRows = await db.all<any>(
        `SELECT service_category, total_amount_cents, principal_amount_cents, service_fee_cents, amount_paid_cents
         FROM transactions
         WHERE payment_status IN ('unpaid', 'partial')`
      );

      let totalUnpaidCents = 0;
      for (const r of unpaidRows) {
        const collectible = getCollectibleCents(r);
        totalUnpaidCents += Math.max(0, collectible - Number(r.amount_paid_cents));
      }

      const wallets = await enrichWallets();
      const totalRecordedBalanceCents = wallets
        .filter((w) => w.status === 'active')
        .reduce((acc, w) => acc + Number(w.current_balance_cents), 0);

      const categories: Array<{ key: string; label: string }> = [
        { key: 'loading', label: 'Loading' },
        { key: 'cash_in_out', label: 'Cash-in / Cash-out' },
        { key: 'printing', label: 'Printing / Photocopy' },
        { key: 'extra_services', label: 'Extra Services' },
      ];

      const categoryBreakdown = [];
      for (const cat of categories) {
        const row = (await db.get<any>(
          `SELECT
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount_cents ELSE 0 END), 0) AS sales_cents,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN earnings_cents ELSE 0 END), 0) AS earnings_cents,
            COUNT(*) AS transaction_count
           FROM transactions
           WHERE service_category = ? AND payment_status != 'voided' AND substr(transaction_date, 1, 7) = ?`,
          [cat.key, month]
        )) ?? { sales_cents: 0, earnings_cents: 0, transaction_count: 0 };

        categoryBreakdown.push({
          category: cat.key,
          label: cat.label,
          sales_cents: Number(row.sales_cents),
          earnings_cents: Number(row.earnings_cents),
          transaction_count: Number(row.transaction_count),
        });
      }

      const dailyTrends: Array<any> = [];
      const baseDate = new Date(`${today}T00:00:00`);
      for (let i = 13; i >= 0; i--) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        const tRow = (await db.get<any>(
          `SELECT
            COALESCE(SUM(total_amount_cents), 0) AS sales_cents,
            COALESCE(SUM(earnings_cents), 0) AS earnings_cents
           FROM transactions
           WHERE payment_status = 'paid' AND substr(transaction_date, 1, 10) = ?`,
          [dateStr]
        )) ?? { sales_cents: 0, earnings_cents: 0 };

        const eRow = (await db.get<any>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS expenses_cents
           FROM expenses
           WHERE status = 'active' AND movement_type = 'expense' AND substr(expense_date, 1, 10) = ?`,
          [dateStr]
        )) ?? { expenses_cents: 0 };

        dailyTrends.push({
          date: dateStr,
          label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
          sales_cents: Number(tRow.sales_cents),
          earnings_cents: Number(tRow.earnings_cents),
          expenses_cents: Number(eRow.expenses_cents),
        });
      }

      const monthlyTrends: Array<any> = [];
      const [yrStr, moStr] = month.split('-');
      const baseMonthDate = new Date(Number(yrStr), Number(moStr) - 1, 1);
      for (let i = 5; i >= 0; i--) {
        const md = new Date(baseMonthDate.getFullYear(), baseMonthDate.getMonth() - i, 1);
        const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
        const tRow = (await db.get<any>(
          `SELECT
            COALESCE(SUM(total_amount_cents), 0) AS sales_cents,
            COALESCE(SUM(earnings_cents), 0) AS earnings_cents
           FROM transactions
           WHERE payment_status = 'paid' AND substr(transaction_date, 1, 7) = ?`,
          [mk]
        )) ?? { sales_cents: 0, earnings_cents: 0 };

        const eRow = (await db.get<any>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS expenses_cents
           FROM expenses
           WHERE status = 'active' AND movement_type = 'expense' AND substr(expense_date, 1, 7) = ?`,
          [mk]
        )) ?? { expenses_cents: 0 };

        monthlyTrends.push({
          month: mk,
          label: md.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
          sales_cents: Number(tRow.sales_cents),
          earnings_cents: Number(tRow.earnings_cents),
          expenses_cents: Number(eRow.expenses_cents),
        });
      }

      const recentTransactions = await db.all<any>(
        `SELECT t.*,
                aw.wallet_name AS assigned_wallet_name,
                pw.wallet_name AS provider_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         LEFT JOIN wallets pw ON pw.id = t.provider_wallet_id
         ORDER BY t.transaction_date DESC, t.id DESC
         LIMIT 10`
      );

      res.json({
        month,
        today,
        kpis: {
          total_sales_today_cents: Number(salesTodayRow.total),
          total_sales_month_cents: Number(salesMonthRow.total_sales),
          total_earnings_month_cents: Number(salesMonthRow.total_earnings),
          total_expenses_month_cents: Number(expensesMonthRow.total_expenses),
          net_earnings_month_cents: Number(salesMonthRow.total_earnings) - Number(expensesMonthRow.total_expenses),
          total_unpaid_cents: totalUnpaidCents,
          total_recorded_balance_cents: totalRecordedBalanceCents,
          unpaid_count: unpaidRows.length,
        },
        wallets,
        category_breakdown: categoryBreakdown,
        daily_trends: dailyTrends,
        monthly_trends: monthlyTrends,
        recent_transactions: recentTransactions,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load dashboard data' });
    }
  });

  // ---------------- WALLETS & LEDGER ----------------
  app.get('/api/wallets', async (_req, res) => {
    try {
      res.json({ wallets: await enrichWallets() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/wallets', async (req, res) => {
    try {
      const db = await getDb();
      const { wallet_name, wallet_type, opening_balance_cents } = req.body;
      if (!wallet_name || !wallet_name.trim()) {
        return res.status(400).json({ error: 'Wallet name is required.' });
      }
      const type = wallet_type || 'ewallet';
      const openingCents = Math.round(Number(opening_balance_cents || 0));
      const now = new Date().toISOString();

      const walletId = await db.insertAndGetId(
        `INSERT INTO wallets (wallet_name, wallet_type, opening_balance_cents, current_balance_cents, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [wallet_name.trim(), type, openingCents, openingCents, now, now]
      );

      const created = await db.get<any>('SELECT * FROM wallets WHERE id = ?', [walletId]);
      res.status(201).json({ wallet: created });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/wallets/reconcile', async (_req, res) => {
    try {
      res.json({ items: await reconcileAllWallets() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/wallets/adjustments', async (_req, res) => {
    try {
      const db = await getDb();
      const rows = await db.all<any>(
        `SELECT a.*, w.wallet_name
         FROM balance_adjustments a
         JOIN wallets w ON w.id = a.wallet_id
         ORDER BY a.adjustment_date DESC, a.id DESC`
      );
      res.json({ adjustments: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/wallets/adjustments', async (req, res) => {
    try {
      const result = await createBalanceAdjustment(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/wallets/:id/ledger', async (req, res) => {
    try {
      const db = await getDb();
      const walletId = Number(req.params.id);
      const wallet = await db.get<any>('SELECT * FROM wallets WHERE id = ?', [walletId]);
      if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

      const { start_date, end_date, type } = req.query;
      const conditions = ['l.wallet_id = ?'];
      const params: Array<any> = [walletId];

      if (typeof start_date === 'string' && start_date) {
        conditions.push('substr(l.entry_date, 1, 10) >= ?');
        params.push(start_date);
      }
      if (typeof end_date === 'string' && end_date) {
        conditions.push('substr(l.entry_date, 1, 10) <= ?');
        params.push(end_date);
      }
      if (typeof type === 'string' && type && type !== 'all') {
        conditions.push('l.reference_type = ?');
        params.push(type);
      }

      const entries = await db.all<any>(
        `SELECT l.*, w.wallet_name
         FROM wallet_ledger l
         JOIN wallets w ON w.id = l.wallet_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY l.entry_date DESC, l.id DESC`,
        params
      );

      const enriched = (await enrichWallets()).find((w) => w.id === walletId);
      res.json({ wallet: enriched, entries });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------- TRANSFERS ----------------
  app.get('/api/transfers', async (_req, res) => {
    try {
      const db = await getDb();
      const transfers = await db.all<any>(
        `SELECT t.*, sw.wallet_name AS source_wallet_name, dw.wallet_name AS destination_wallet_name
         FROM wallet_transfers t
         JOIN wallets sw ON sw.id = t.source_wallet_id
         JOIN wallets dw ON dw.id = t.destination_wallet_id
         ORDER BY t.transfer_date DESC, t.id DESC`
      );
      res.json({ transfers });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/transfers', async (req, res) => {
    try {
      const result = await createWalletTransfer(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- TRANSACTIONS ----------------
  app.get('/api/transactions', async (req, res) => {
    try {
      const db = await getDb();
      const { search, category, status, wallet_id, payment_method, start_date, end_date } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];

      if (typeof search === 'string' && search.trim()) {
        const q = `%${search.trim()}%`;
        conditions.push(
          '(LOWER(t.customer_name) LIKE LOWER(?) OR LOWER(t.description) LIKE LOWER(?) OR LOWER(t.transaction_number) LIKE LOWER(?) OR LOWER(t.service_type) LIKE LOWER(?))'
        );
        params.push(q, q, q, q);
      }
      if (typeof category === 'string' && category && category !== 'all') {
        conditions.push('t.service_category = ?');
        params.push(category);
      }
      if (typeof status === 'string' && status && status !== 'all') {
        conditions.push('t.payment_status = ?');
        params.push(status);
      }
      if (typeof wallet_id === 'string' && wallet_id && wallet_id !== 'all') {
        const wid = Number(wallet_id);
        conditions.push('(t.assigned_wallet_id = ? OR t.provider_wallet_id = ?)');
        params.push(wid, wid);
      }
      if (typeof payment_method === 'string' && payment_method && payment_method !== 'all') {
        conditions.push('t.payment_method = ?');
        params.push(payment_method);
      }
      if (typeof start_date === 'string' && start_date) {
        conditions.push('substr(t.transaction_date, 1, 10) >= ?');
        params.push(start_date);
      }
      if (typeof end_date === 'string' && end_date) {
        conditions.push('substr(t.transaction_date, 1, 10) <= ?');
        params.push(end_date);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const transactions = await db.all<any>(
        `SELECT t.*,
                aw.wallet_name AS assigned_wallet_name,
                pw.wallet_name AS provider_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         LEFT JOIN wallets pw ON pw.id = t.provider_wallet_id
         ${where}
         ORDER BY t.transaction_date DESC, t.id DESC`,
        params
      );

      res.json({ transactions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/transactions/:id', async (req, res) => {
    try {
      const db = await getDb();
      const id = Number(req.params.id);
      const txn = await db.get<any>(
        `SELECT t.*,
                aw.wallet_name AS assigned_wallet_name,
                pw.wallet_name AS provider_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         LEFT JOIN wallets pw ON pw.id = t.provider_wallet_id
         WHERE t.id = ?`,
        [id]
      );

      if (!txn) return res.status(404).json({ error: 'Transaction not found' });

      const payments = await db.all<any>(
        `SELECT p.*, w.wallet_name
         FROM transaction_payments p
         JOIN wallets w ON w.id = p.wallet_id
         WHERE p.transaction_id = ?
         ORDER BY p.payment_date ASC, p.id ASC`,
        [id]
      );

      const paymentIds = payments.map((p) => p.id);
      const ledgerEntries = await db.all<any>(
        `SELECT l.*, w.wallet_name
         FROM wallet_ledger l
         JOIN wallets w ON w.id = l.wallet_id
         WHERE (l.reference_type IN ('transaction', 'transaction_reversal') AND l.reference_id = ?)
            OR (l.reference_type = 'transaction_payment' AND l.reference_id IN (${
              paymentIds.length > 0 ? paymentIds.map(() => '?').join(',') : '-1'
            }))
         ORDER BY l.entry_date ASC, l.id ASC`,
        [id, ...paymentIds]
      );

      const auditLogs = await db.all<any>(
        `SELECT * FROM transaction_audit_logs
         WHERE transaction_id = ?
         ORDER BY created_at DESC, id DESC`,
        [id]
      );

      res.json({
        transaction: {
          ...txn,
          payments,
          ledger_entries: ledgerEntries,
          audit_logs: auditLogs,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/transactions', async (req, res) => {
    try {
      const result = await createTransaction(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/transactions/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = await editTransaction(id, req.body);
      res.json({ transaction: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/transactions/:id/payments', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = await recordTransactionPayment(id, req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/transactions/:id/void', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { reason, actor } = req.body;
      const updated = await voidTransaction(id, reason, actor);
      res.json({ transaction: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- EXPENSES & REFUNDS ----------------
  app.get('/api/expenses', async (req, res) => {
    try {
      const db = await getDb();
      const { movement_type, wallet_id, start_date, end_date } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];

      if (typeof movement_type === 'string' && movement_type && movement_type !== 'all') {
        conditions.push('e.movement_type = ?');
        params.push(movement_type);
      }
      if (typeof wallet_id === 'string' && wallet_id && wallet_id !== 'all') {
        conditions.push('e.wallet_id = ?');
        params.push(Number(wallet_id));
      }
      if (typeof start_date === 'string' && start_date) {
        conditions.push('substr(e.expense_date, 1, 10) >= ?');
        params.push(start_date);
      }
      if (typeof end_date === 'string' && end_date) {
        conditions.push('substr(e.expense_date, 1, 10) <= ?');
        params.push(end_date);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const expenses = await db.all<any>(
        `SELECT e.*,
                w.wallet_name,
                t.transaction_number AS related_transaction_number,
                rc.name AS refund_category_name
         FROM expenses e
         JOIN wallets w ON w.id = e.wallet_id
         LEFT JOIN transactions t ON t.id = e.related_transaction_id
         LEFT JOIN refund_categories rc ON rc.id = e.refund_category_id
         ${where}
         ORDER BY e.expense_date DESC, e.id DESC`,
        params
      );

      res.json({ expenses });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/expenses', async (req, res) => {
    try {
      const result = await createExpense(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/expenses/:id/void', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = await voidExpense(id, req.body?.reason || 'Voided by user');
      res.json({ expense: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- SERVICES & PRICING ----------------
  app.get('/api/services', async (_req, res) => {
    try {
      const db = await getDb();
      const services = await db.all<any>('SELECT * FROM services ORDER BY category ASC, service_name ASC');
      res.json({ services });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/services', async (req, res) => {
    try {
      const db = await getDb();
      const { service_name, category, provider, default_price_cents, actual_cost_cents, description } = req.body;
      if (!service_name || !service_name.trim()) return res.status(400).json({ error: 'Service name is required.' });
      const now = new Date().toISOString();
      const id = await db.insertAndGetId(
        `INSERT INTO services (service_name, category, provider, default_price_cents, actual_cost_cents, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          service_name.trim(),
          category,
          provider || null,
          Math.round(Number(default_price_cents || 0)),
          Math.round(Number(actual_cost_cents || 0)),
          description || null,
          now,
          now,
        ]
      );
      const service = await db.get<any>('SELECT * FROM services WHERE id = ?', [id]);
      res.status(201).json({ service });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/services/:id', async (req, res) => {
    try {
      const db = await getDb();
      const id = Number(req.params.id);
      const { service_name, category, provider, default_price_cents, actual_cost_cents, description, status } = req.body;
      const existing = await db.get<any>('SELECT * FROM services WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Service not found' });

      const now = new Date().toISOString();
      await db.run(
        `UPDATE services
         SET service_name = ?, category = ?, provider = ?, default_price_cents = ?,
             actual_cost_cents = ?, description = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [
          (service_name ?? existing.service_name).trim(),
          category ?? existing.category,
          provider !== undefined ? provider : existing.provider,
          default_price_cents !== undefined
            ? Math.round(Number(default_price_cents))
            : Number(existing.default_price_cents),
          actual_cost_cents !== undefined
            ? Math.round(Number(actual_cost_cents))
            : Number(existing.actual_cost_cents),
          description !== undefined ? description : existing.description,
          status ?? existing.status,
          now,
          id,
        ]
      );
      const updated = await db.get<any>('SELECT * FROM services WHERE id = ?', [id]);
      res.json({ service: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/services/:id/status', async (req, res) => {
    try {
      const db = await getDb();
      const id = Number(req.params.id);
      const { status } = req.body;
      await db.run('UPDATE services SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        new Date().toISOString(),
        id,
      ]);
      const updated = await db.get<any>('SELECT * FROM services WHERE id = ?', [id]);
      res.json({ service: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- REPORTS ----------------
  app.get('/api/reports/daily', async (req, res) => {
    try {
      const db = await getDb();
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : getTodayDateString();
      const rows = await db.all<any>(
        `SELECT service_category,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount_cents ELSE 0 END), 0) AS sales_cents,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN earnings_cents ELSE 0 END), 0) AS earnings_cents,
                COUNT(CASE WHEN payment_status != 'voided' THEN 1 END) AS count
         FROM transactions
         WHERE substr(transaction_date, 1, 10) = ?
         GROUP BY service_category`,
        [date]
      );

      const byCat = new Map(rows.map((r) => [r.service_category, r]));
      const loadingSales = Number(byCat.get('loading')?.sales_cents ?? 0);
      const cashInOutFees = Number(byCat.get('cash_in_out')?.sales_cents ?? 0);
      const printingSales = Number(byCat.get('printing')?.sales_cents ?? 0);
      const extraSales = Number(byCat.get('extra_services')?.sales_cents ?? 0);

      const totalGrossSales = loadingSales + cashInOutFees + printingSales + extraSales;
      const totalEarnings = rows.reduce((acc, r) => acc + Number(r.earnings_cents), 0);

      const expenseRow = (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM expenses
         WHERE status = 'active' AND movement_type = 'expense' AND substr(expense_date, 1, 10) = ?`,
        [date]
      )) ?? { total: 0 };

      const unpaidRows = await db.all<any>(
        `SELECT t.*, aw.wallet_name AS assigned_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         WHERE substr(t.transaction_date, 1, 10) = ? AND t.payment_status IN ('unpaid', 'partial')`,
        [date]
      );

      const unpaidTotal = unpaidRows.reduce(
        (acc, r) => acc + Math.max(0, getCollectibleCents(r) - Number(r.amount_paid_cents)),
        0
      );

      const transactions = await db.all<any>(
        `SELECT t.*, aw.wallet_name AS assigned_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         WHERE substr(t.transaction_date, 1, 10) = ?
         ORDER BY t.transaction_date DESC, t.id DESC`,
        [date]
      );

      res.json({
        date,
        summary: {
          loading_sales_cents: loadingSales,
          cash_in_out_fees_cents: cashInOutFees,
          printing_sales_cents: printingSales,
          extra_services_sales_cents: extraSales,
          total_gross_sales_cents: totalGrossSales,
          total_earnings_cents: totalEarnings,
          total_expenses_cents: Number(expenseRow.total),
          net_earnings_cents: totalEarnings - Number(expenseRow.total),
          unpaid_total_cents: unpaidTotal,
          unpaid_count: unpaidRows.length,
        },
        transactions,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports/refund-categories', async (_req, res) => {
    try {
      const db = await getDb();
      const categories = await db.all<any>('SELECT * FROM refund_categories ORDER BY id ASC');
      res.json({ categories });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reports/refund-categories', async (req, res) => {
    try {
      const db = await getDb();
      const { name, description } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required.' });
      const id = await db.insertAndGetId(
        'INSERT INTO refund_categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?)',
        [name.trim(), description || null, new Date().toISOString()]
      );
      const category = await db.get<any>('SELECT * FROM refund_categories WHERE id = ?', [id]);
      res.status(201).json({ category });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/reports/refund-categories/:id', async (req, res) => {
    try {
      const db = await getDb();
      const id = Number(req.params.id);
      const { name, description, is_active } = req.body;
      const existing = await db.get<any>('SELECT * FROM refund_categories WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Refund category not found' });
      await db.run('UPDATE refund_categories SET name = ?, description = ?, is_active = ? WHERE id = ?', [
        name ?? existing.name,
        description !== undefined ? description : existing.description,
        is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
        id,
      ]);
      res.json({ category: await db.get<any>('SELECT * FROM refund_categories WHERE id = ?', [id]) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/reports/refund-obligations', async (req, res) => {
    try {
      const db = await getDb();
      const { month_key, refund_category_id, amount_cents, notes } = req.body;
      if (!month_key || !refund_category_id) {
        return res.status(400).json({ error: 'Month and refund category are required.' });
      }
      const amt = Math.max(0, Math.round(Number(amount_cents || 0)));
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO refund_obligations (month_key, refund_category_id, amount_cents, notes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(month_key, refund_category_id)
         DO UPDATE SET amount_cents = EXCLUDED.amount_cents, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at`,
        [month_key, Number(refund_category_id), amt, notes || null, now]
      );

      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/reports/monthly', async (req, res) => {
    try {
      const db = await getDb();
      const year =
        typeof req.query.year === 'string' && req.query.year ? req.query.year : getTodayDateString().slice(0, 4);
      const selectedMonth =
        typeof req.query.month === 'string' && req.query.month
          ? req.query.month
          : `${year}-${getMonthKeyString().slice(5, 7)}`;

      const refundCategories = await db.all<any>('SELECT * FROM refund_categories ORDER BY id ASC');

      const months: Array<any> = [];
      for (let m = 1; m <= 12; m++) {
        const mk = `${year}-${String(m).padStart(2, '0')}`;
        const label = new Date(Number(year), m - 1, 1).toLocaleDateString('en-PH', { month: 'long' });

        const tRow = (await db.get<any>(
          `SELECT
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount_cents ELSE 0 END), 0) AS sales_cents,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN earnings_cents ELSE 0 END), 0) AS earnings_cents
           FROM transactions
           WHERE substr(transaction_date, 1, 7) = ?`,
          [mk]
        )) ?? { sales_cents: 0, earnings_cents: 0 };

        const eRow = (await db.get<any>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS expenses_cents
           FROM expenses
           WHERE status = 'active' AND movement_type = 'expense' AND substr(expense_date, 1, 7) = ?`,
          [mk]
        )) ?? { expenses_cents: 0 };

        const recordedRefundsRow = (await db.get<any>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS refund_paid_cents
           FROM expenses
           WHERE status = 'active' AND movement_type = 'refund' AND substr(expense_date, 1, 7) = ?`,
          [mk]
        )) ?? { refund_paid_cents: 0 };

        const obRows = await db.all<any>(
          `SELECT ro.*, rc.name AS refund_category_name
           FROM refund_obligations ro
           JOIN refund_categories rc ON rc.id = ro.refund_category_id
           WHERE ro.month_key = ?`,
          [mk]
        );

        const obligationsTotal = obRows.reduce((acc, r) => acc + Number(r.amount_cents), 0);
        const recordedRefunds = Number(recordedRefundsRow.refund_paid_cents);
        const totalRefundObligations = obligationsTotal + recordedRefunds;
        const earningsCents = Number(tRow.earnings_cents);
        const expensesCents = Number(eRow.expenses_cents);
        const netEarnings = earningsCents - expensesCents;
        const remaining = netEarnings - totalRefundObligations;

        months.push({
          month_key: mk,
          month_label: label,
          sales_cents: Number(tRow.sales_cents),
          earnings_cents: earningsCents,
          expenses_cents: expensesCents,
          net_earnings_cents: netEarnings,
          refund_obligations_cents: totalRefundObligations,
          configured_obligations_cents: obligationsTotal,
          recorded_refunds_cents: recordedRefunds,
          remaining_cents: remaining,
          obligations_breakdown: obRows,
        });
      }

      const categoryDetail = [];
      for (const cat of ['loading', 'cash_in_out', 'printing', 'extra_services']) {
        const r = (await db.get<any>(
          `SELECT
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount_cents ELSE 0 END), 0) AS sales_cents,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN earnings_cents ELSE 0 END), 0) AS earnings_cents,
            COUNT(CASE WHEN payment_status != 'voided' THEN 1 END) AS count
           FROM transactions
           WHERE service_category = ? AND substr(transaction_date, 1, 7) = ?`,
          [cat, selectedMonth]
        )) ?? { sales_cents: 0, earnings_cents: 0, count: 0 };
        categoryDetail.push({
          category: cat,
          sales_cents: Number(r.sales_cents),
          earnings_cents: Number(r.earnings_cents),
          count: Number(r.count),
        });
      }

      const unpaidRows = await db.all<any>(
        `SELECT t.*, aw.wallet_name AS assigned_wallet_name
         FROM transactions t
         LEFT JOIN wallets aw ON aw.id = t.assigned_wallet_id
         WHERE t.payment_status IN ('unpaid', 'partial')`
      );

      const outstandingTotal = unpaidRows.reduce(
        (acc, r) => acc + Math.max(0, getCollectibleCents(r) - Number(r.amount_paid_cents)),
        0
      );

      res.json({
        year,
        selected_month: selectedMonth,
        months,
        category_detail: categoryDetail,
        refund_categories: refundCategories,
        outstanding_customer_payments_cents: outstandingTotal,
        wallets: await enrichWallets(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports/wallets', async (req, res) => {
    try {
      const db = await getDb();
      const startDate = typeof req.query.start === 'string' ? req.query.start : '';
      const endDate = typeof req.query.end === 'string' ? req.query.end : '';
      const wallets = await db.all<any>('SELECT * FROM wallets ORDER BY id ASC');

      const report = [];
      for (const w of wallets) {
        let opening = Number(w.opening_balance_cents);
        if (startDate) {
          const pre = (await db.get<{ net_before: number }>(
            `SELECT COALESCE(SUM(amount_in_cents - amount_out_cents), 0) AS net_before
             FROM wallet_ledger
             WHERE wallet_id = ? AND substr(entry_date, 1, 10) < ?`,
            [w.id, startDate]
          )) ?? { net_before: 0 };
          opening += Number(pre.net_before);
        }

        const conds = ['wallet_id = ?'];
        const params: any[] = [w.id];
        if (startDate) {
          conds.push('substr(entry_date, 1, 10) >= ?');
          params.push(startDate);
        }
        if (endDate) {
          conds.push('substr(entry_date, 1, 10) <= ?');
          params.push(endDate);
        }

        const agg = (await db.get<any>(
          `SELECT
            COALESCE(SUM(amount_in_cents), 0) AS total_inflows_cents,
            COALESCE(SUM(amount_out_cents), 0) AS total_outflows_cents,
            COALESCE(SUM(CASE WHEN reference_type = 'transfer' THEN amount_in_cents ELSE 0 END), 0) AS transfers_in_cents,
            COALESCE(SUM(CASE WHEN reference_type = 'transfer' THEN amount_out_cents ELSE 0 END), 0) AS transfers_out_cents,
            COALESCE(SUM(CASE WHEN reference_type = 'adjustment' THEN amount_in_cents - amount_out_cents ELSE 0 END), 0) AS adjustments_net_cents
           FROM wallet_ledger
           WHERE ${conds.join(' AND ')}`,
          params
        )) ?? {
          total_inflows_cents: 0,
          total_outflows_cents: 0,
          transfers_in_cents: 0,
          transfers_out_cents: 0,
          adjustments_net_cents: 0,
        };

        const totalIn = Number(agg.total_inflows_cents);
        const totalOut = Number(agg.total_outflows_cents);
        const closing = opening + totalIn - totalOut;

        report.push({
          wallet_id: w.id,
          wallet_name: w.wallet_name,
          wallet_type: w.wallet_type,
          opening_balance_cents: opening,
          total_inflows_cents: totalIn,
          total_outflows_cents: totalOut,
          transfers_in_cents: Number(agg.transfers_in_cents),
          transfers_out_cents: Number(agg.transfers_out_cents),
          adjustments_net_cents: Number(agg.adjustments_net_cents),
          closing_balance_cents: closing,
        });
      }

      res.json({
        start: startDate || null,
        end: endDate || null,
        wallets: report,
        total_combined_closing_cents: report.reduce((acc, r) => acc + r.closing_balance_cents, 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------- SETTINGS, BACKUP & RESET ----------------
  app.get('/api/settings', async (_req, res) => {
    try {
      const db = await getDb();
      const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM business_settings');
      const settings: Record<string, string> = {};
      for (const r of rows) settings[r.key] = r.value;
      res.json({ settings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const updates = req.body.settings || {};
      await runInTransaction(async (tx) => {
        for (const [k, v] of Object.entries(updates)) {
          await tx.run(
            `INSERT INTO business_settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
            [k, String(v ?? '')]
          );
        }
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/settings/backup', async (_req, res) => {
    try {
      const db = await getDb();
      const snapshot = {
        exported_at: new Date().toISOString(),
        business_settings: await db.all('SELECT * FROM business_settings'),
        wallets: await db.all('SELECT * FROM wallets ORDER BY id ASC'),
        services: await db.all('SELECT * FROM services ORDER BY id ASC'),
        transactions: await db.all('SELECT * FROM transactions ORDER BY id ASC'),
        transaction_payments: await db.all('SELECT * FROM transaction_payments ORDER BY id ASC'),
        wallet_ledger: await db.all('SELECT * FROM wallet_ledger ORDER BY id ASC'),
        wallet_transfers: await db.all('SELECT * FROM wallet_transfers ORDER BY id ASC'),
        expenses: await db.all('SELECT * FROM expenses ORDER BY id ASC'),
        balance_adjustments: await db.all('SELECT * FROM balance_adjustments ORDER BY id ASC'),
        refund_categories: await db.all('SELECT * FROM refund_categories ORDER BY id ASC'),
        refund_obligations: await db.all('SELECT * FROM refund_obligations ORDER BY id ASC'),
        transaction_audit_logs: await db.all('SELECT * FROM transaction_audit_logs ORDER BY id ASC'),
      };
      res.json(snapshot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/restore', async (req, res) => {
    try {
      await restoreSnapshotFromJson(req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to restore backup.' });
    }
  });

  app.post('/api/settings/reset', async (req, res) => {
    try {
      const { mode, opening_balances } = req.body || {};
      await runInTransaction(async (tx) => {
        await tx.run('DELETE FROM transaction_audit_logs');
        await tx.run('DELETE FROM transaction_payments');
        await tx.run('DELETE FROM wallet_ledger');
        await tx.run('DELETE FROM wallet_transfers');
        await tx.run('DELETE FROM expenses');
        await tx.run('DELETE FROM balance_adjustments');
        await tx.run('DELETE FROM transactions');
        await tx.run('DELETE FROM refund_obligations');

        if (mode === 'clean_with_balances') {
          const balances = opening_balances || {};
          const wallets = await tx.all<any>('SELECT * FROM wallets');
          for (const w of wallets) {
            const nextOpening =
              balances[w.wallet_name] !== undefined
                ? Math.round(Number(balances[w.wallet_name]))
                : Number(w.opening_balance_cents);
            await tx.run(
              'UPDATE wallets SET opening_balance_cents = ?, current_balance_cents = ?, updated_at = ? WHERE id = ?',
              [nextOpening, nextOpening, new Date().toISOString(), w.id]
            );
            await recomputeWalletLedger(w.id, tx);
          }
        } else {
          await tx.run('DELETE FROM refund_categories');
          await tx.run('DELETE FROM services');
          await tx.run('DELETE FROM wallets');
          await tx.run('DELETE FROM business_settings');
        }
      });

      if (mode !== 'clean_with_balances') {
        resetInitCache();
        await initSchema();
        await bootstrapAndSeedDatabase();
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // JSON error handler for /api routes
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
  });

  return app;
}
