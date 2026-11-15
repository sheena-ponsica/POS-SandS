import { getDb, initSchema, runInTransaction, syncPostgresSequences, type DbExecutor } from './db.ts';

export type ServiceCategory = 'loading' | 'cash_in_out' | 'printing' | 'extra_services';
export type PaymentStatus = 'paid' | 'unpaid' | 'partial' | 'voided';
export type MovementType = 'expense' | 'inventory_replenishment' | 'refund';

function nowIso(): string {
  return new Date().toISOString();
}

function formatCodePrefix(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(4, '0')}`;
}

export async function getWalletById(walletId: number, executor?: DbExecutor) {
  const db = executor ?? (await getDb());
  return db.get<any>('SELECT * FROM wallets WHERE id = ?', [walletId]);
}

export async function recomputeWalletLedger(walletId: number, executor?: DbExecutor): Promise<number> {
  const db = executor ?? (await getDb());
  const wallet = await db.get<{ id: number; opening_balance_cents: number }>(
    'SELECT id, opening_balance_cents FROM wallets WHERE id = ?',
    [walletId]
  );
  if (!wallet) {
    throw new Error(`Wallet #${walletId} not found`);
  }

  const entries = await db.all<{
    id: number;
    amount_in_cents: number;
    amount_out_cents: number;
    running_balance_cents: number;
  }>(
    `SELECT id, amount_in_cents, amount_out_cents, running_balance_cents
     FROM wallet_ledger
     WHERE wallet_id = ?
     ORDER BY entry_date ASC, id ASC`,
    [walletId]
  );

  let running = Number(wallet.opening_balance_cents);
  for (const entry of entries) {
    running = running + Number(entry.amount_in_cents) - Number(entry.amount_out_cents);
    if (Number(entry.running_balance_cents) !== running) {
      await db.run('UPDATE wallet_ledger SET running_balance_cents = ? WHERE id = ?', [running, entry.id]);
    }
  }

  await db.run('UPDATE wallets SET current_balance_cents = ?, updated_at = ? WHERE id = ?', [
    running,
    nowIso(),
    walletId,
  ]);

  return running;
}

async function insertLedgerEntry(
  tx: DbExecutor,
  params: {
    wallet_id: number;
    reference_type: string;
    reference_id: number;
    reference_code: string;
    transaction_type: string;
    amount_in_cents: number;
    amount_out_cents: number;
    description: string;
    entry_date: string;
  }
): Promise<void> {
  const createdAt = nowIso();
  await tx.run(
    `INSERT INTO wallet_ledger (
      wallet_id, reference_type, reference_id, reference_code, transaction_type,
      amount_in_cents, amount_out_cents, description, running_balance_cents, entry_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      params.wallet_id,
      params.reference_type,
      params.reference_id,
      params.reference_code,
      params.transaction_type,
      params.amount_in_cents,
      params.amount_out_cents,
      params.description,
      params.entry_date,
      createdAt,
    ]
  );
  await recomputeWalletLedger(params.wallet_id, tx);
}

export function getCollectibleCents(txn: {
  service_category: string;
  total_amount_cents: number;
  principal_amount_cents: number;
  service_fee_cents: number;
}): number {
  if (txn.service_category === 'cash_in_out') {
    return Number(txn.principal_amount_cents) + Number(txn.service_fee_cents);
  }
  return Number(txn.total_amount_cents);
}

export interface CreateTransactionInput {
  idempotency_key?: string;
  customer_name: string;
  service_category: ServiceCategory;
  service_type: string;
  description: string;
  provider?: string | null;
  quantity?: number;
  unit_price_cents?: number;
  total_amount_cents: number;
  principal_amount_cents?: number;
  actual_cost_cents?: number;
  service_fee_cents?: number;
  payment_status: 'paid' | 'unpaid' | 'partial';
  amount_paid_cents?: number;
  assigned_wallet_id?: number | null;
  provider_wallet_id?: number | null;
  fee_wallet_id?: number | null;
  payment_method?: string;
  metadata?: Record<string, unknown> | null;
  transaction_date?: string;
  actor?: string;
}

function computeTransactionFinancials(input: CreateTransactionInput) {
  const qty = Math.max(1, Math.round(input.quantity ?? 1));
  const actualCost = Math.max(0, Math.round(input.actual_cost_cents ?? 0));
  const rawTotal = Math.max(0, Math.round(input.total_amount_cents));
  const rawPrincipal = Math.max(0, Math.round(input.principal_amount_cents ?? rawTotal));
  const rawFee = Math.max(0, Math.round(input.service_fee_cents ?? 0));

  if (input.service_category === 'cash_in_out') {
    if (rawPrincipal <= 0) {
      throw new Error('Cash-in / Cash-out principal amount must be greater than ₱0.00.');
    }
    const fee = rawFee;
    return {
      quantity: 1,
      unit_price_cents: fee,
      total_amount_cents: fee,
      principal_amount_cents: rawPrincipal,
      actual_cost_cents: 0,
      service_fee_cents: fee,
      earnings_cents: fee,
      collectible_cents: rawPrincipal + fee,
    };
  }

  if (rawTotal <= 0) {
    throw new Error('Transaction amount must be greater than ₱0.00.');
  }

  const earnings = rawTotal - actualCost;
  const serviceFee = input.service_category === 'loading' ? earnings : 0;

  return {
    quantity: qty,
    unit_price_cents: Math.round(input.unit_price_cents ?? Math.round(rawTotal / qty)),
    total_amount_cents: rawTotal,
    principal_amount_cents: rawTotal,
    actual_cost_cents: actualCost,
    service_fee_cents: serviceFee,
    earnings_cents: earnings,
    collectible_cents: rawTotal,
  };
}

async function postTransactionMovements(
  tx: DbExecutor,
  params: {
    transactionId: number;
    transactionNumber: string;
    serviceCategory: ServiceCategory;
    serviceType: string;
    description: string;
    customerName: string;
    principalCents: number;
    serviceFeeCents: number;
    collectibleCents: number;
    paymentStatus: 'paid' | 'unpaid' | 'partial';
    amountPaidCents: number;
    assignedWalletId: number | null;
    providerWalletId: number | null;
    feeWalletId: number | null;
    paymentMethod: string;
    txnDate: string;
    idempotencyKey?: string;
  }
): Promise<void> {
  const {
    transactionId,
    transactionNumber,
    serviceCategory,
    serviceType,
    description,
    customerName,
    principalCents,
    serviceFeeCents,
    collectibleCents,
    paymentStatus,
    amountPaidCents,
    assignedWalletId,
    providerWalletId,
    feeWalletId,
    paymentMethod,
    txnDate,
    idempotencyKey,
  } = params;

  if (serviceCategory === 'cash_in_out') {
    if (!providerWalletId) {
      throw new Error('Provider wallet (GCash or Maya) is required for Cash-in / Cash-out.');
    }
    if (!assignedWalletId) {
      throw new Error('Settlement wallet is required for Cash-in / Cash-out.');
    }

    const isCashIn = serviceType.toLowerCase().includes('in');
    const resolvedFeeWalletId = feeWalletId ?? assignedWalletId;

    if (isCashIn) {
      await insertLedgerEntry(tx, {
        wallet_id: providerWalletId,
        reference_type: 'transaction',
        reference_id: transactionId,
        reference_code: transactionNumber,
        transaction_type: 'Cash-In E-Wallet Sent',
        amount_in_cents: 0,
        amount_out_cents: principalCents,
        description: `${serviceType} for ${customerName} — ${description}`,
        entry_date: txnDate,
      });

      if (amountPaidCents > 0) {
        const payId = await tx.insertAndGetId(
          `INSERT INTO transaction_payments (
            transaction_id, wallet_id, amount_paid_cents, payment_method, payment_date, notes, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            assignedWalletId,
            amountPaidCents,
            paymentMethod,
            txnDate,
            'Cash-in settlement collected',
            idempotencyKey ? `${idempotencyKey}:pay0` : null,
            nowIso(),
          ]
        );

        if (paymentStatus === 'paid' && resolvedFeeWalletId !== assignedWalletId && serviceFeeCents > 0) {
          await insertLedgerEntry(tx, {
            wallet_id: assignedWalletId,
            reference_type: 'transaction_payment',
            reference_id: payId,
            reference_code: transactionNumber,
            transaction_type: 'Cash-In Principal Collected',
            amount_in_cents: principalCents,
            amount_out_cents: 0,
            description: `${serviceType} principal from ${customerName}`,
            entry_date: txnDate,
          });
          await insertLedgerEntry(tx, {
            wallet_id: resolvedFeeWalletId,
            reference_type: 'transaction_payment',
            reference_id: payId,
            reference_code: transactionNumber,
            transaction_type: 'Cash-In Service Fee',
            amount_in_cents: serviceFeeCents,
            amount_out_cents: 0,
            description: `${serviceType} service fee from ${customerName}`,
            entry_date: txnDate,
          });
        } else {
          await insertLedgerEntry(tx, {
            wallet_id: assignedWalletId,
            reference_type: 'transaction_payment',
            reference_id: payId,
            reference_code: transactionNumber,
            transaction_type: 'Cash-In Cash Collected',
            amount_in_cents: amountPaidCents,
            amount_out_cents: 0,
            description: `${serviceType} collected from ${customerName}`,
            entry_date: txnDate,
          });
        }
      }
    } else {
      const feeInProvider = resolvedFeeWalletId === providerWalletId;
      await insertLedgerEntry(tx, {
        wallet_id: providerWalletId,
        reference_type: 'transaction',
        reference_id: transactionId,
        reference_code: transactionNumber,
        transaction_type: 'Cash-Out E-Wallet Received',
        amount_in_cents: principalCents + (feeInProvider ? serviceFeeCents : 0),
        amount_out_cents: 0,
        description: `${serviceType} received from ${customerName} — ${description}`,
        entry_date: txnDate,
      });

      if (amountPaidCents > 0) {
        await insertLedgerEntry(tx, {
          wallet_id: assignedWalletId,
          reference_type: 'transaction',
          reference_id: transactionId,
          reference_code: transactionNumber,
          transaction_type: 'Cash-Out Cash Disbursed',
          amount_in_cents: 0,
          amount_out_cents: principalCents,
          description: `${serviceType} cash released to ${customerName}`,
          entry_date: txnDate,
        });

        if (!feeInProvider && serviceFeeCents > 0) {
          await insertLedgerEntry(tx, {
            wallet_id: resolvedFeeWalletId,
            reference_type: 'transaction',
            reference_id: transactionId,
            reference_code: transactionNumber,
            transaction_type: 'Cash-Out Service Fee',
            amount_in_cents: serviceFeeCents,
            amount_out_cents: 0,
            description: `${serviceType} service fee from ${customerName}`,
            entry_date: txnDate,
          });
        }

        await tx.run(
          `INSERT INTO transaction_payments (
            transaction_id, wallet_id, amount_paid_cents, payment_method, payment_date, notes, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            providerWalletId,
            collectibleCents,
            paymentMethod,
            txnDate,
            'Cash-out settled',
            idempotencyKey ? `${idempotencyKey}:pay0` : null,
            nowIso(),
          ]
        );
      }
    }
    return;
  }

  if (amountPaidCents > 0) {
    if (!assignedWalletId) {
      throw new Error('Assigned payment wallet is required for paid or partial transactions.');
    }
    const payId = await tx.insertAndGetId(
      `INSERT INTO transaction_payments (
        transaction_id, wallet_id, amount_paid_cents, payment_method, payment_date, notes, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        assignedWalletId,
        amountPaidCents,
        paymentMethod,
        txnDate,
        paymentStatus === 'partial' ? 'Initial partial payment' : 'Full payment',
        idempotencyKey ? `${idempotencyKey}:pay0` : null,
        nowIso(),
      ]
    );

    await insertLedgerEntry(tx, {
      wallet_id: assignedWalletId,
      reference_type: 'transaction_payment',
      reference_id: payId,
      reference_code: transactionNumber,
      transaction_type: 'Customer Payment',
      amount_in_cents: amountPaidCents,
      amount_out_cents: 0,
      description: `${serviceType}: ${description} (${customerName})`,
      entry_date: txnDate,
    });
  }
}

export async function createTransactionInTx(tx: DbExecutor, input: CreateTransactionInput) {
  if (input.idempotency_key) {
    const existing = await tx.get<any>('SELECT * FROM transactions WHERE idempotency_key = ?', [
      input.idempotency_key,
    ]);
    if (existing) {
      return { transaction: existing, duplicate: true };
    }
  }

  const customerName = (input.customer_name || 'Walk-in Customer').trim();
  const txnDate = input.transaction_date || nowIso();
  const now = nowIso();
  const fin = computeTransactionFinancials(input);

  let amountPaid = 0;
  let paymentStatus: 'paid' | 'unpaid' | 'partial' = input.payment_status;

  if (paymentStatus === 'paid') {
    amountPaid = fin.collectible_cents;
  } else if (paymentStatus === 'partial') {
    amountPaid = Math.max(0, Math.min(fin.collectible_cents, Math.round(input.amount_paid_cents ?? 0)));
    if (amountPaid === 0) paymentStatus = 'unpaid';
    if (amountPaid >= fin.collectible_cents) paymentStatus = 'paid';
  } else {
    amountPaid = 0;
  }

  const assignedWalletId = input.assigned_wallet_id ?? null;
  const providerWalletId = input.provider_wallet_id ?? null;
  const assignedWallet = assignedWalletId ? await getWalletById(assignedWalletId, tx) : null;
  const paymentMethod =
    paymentStatus === 'unpaid' ? 'Unpaid' : input.payment_method || assignedWallet?.wallet_name || 'Cash';

  if (paymentStatus !== 'unpaid' && !assignedWalletId) {
    throw new Error('Please select the wallet receiving or settling this payment.');
  }

  const tempNumber = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  const transactionId = await tx.insertAndGetId(
    `INSERT INTO transactions (
      transaction_number, idempotency_key, customer_name, service_category, service_type,
      description, provider, quantity, unit_price_cents, total_amount_cents,
      principal_amount_cents, actual_cost_cents, service_fee_cents, earnings_cents,
      payment_status, amount_paid_cents, assigned_wallet_id, provider_wallet_id,
      payment_method, metadata_json, transaction_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tempNumber,
      input.idempotency_key ?? null,
      customerName,
      input.service_category,
      input.service_type,
      input.description.trim() || input.service_type,
      input.provider ?? null,
      fin.quantity,
      fin.unit_price_cents,
      fin.total_amount_cents,
      fin.principal_amount_cents,
      fin.actual_cost_cents,
      fin.service_fee_cents,
      fin.earnings_cents,
      paymentStatus,
      amountPaid,
      assignedWalletId,
      providerWalletId,
      paymentMethod,
      metadataJson,
      txnDate,
      now,
      now,
    ]
  );

  const transactionNumber = formatCodePrefix('TXN', transactionId);
  await tx.run('UPDATE transactions SET transaction_number = ? WHERE id = ?', [
    transactionNumber,
    transactionId,
  ]);

  await postTransactionMovements(tx, {
    transactionId,
    transactionNumber,
    serviceCategory: input.service_category,
    serviceType: input.service_type,
    description: input.description.trim() || input.service_type,
    customerName,
    principalCents: fin.principal_amount_cents,
    serviceFeeCents: fin.service_fee_cents,
    collectibleCents: fin.collectible_cents,
    paymentStatus,
    amountPaidCents: amountPaid,
    assignedWalletId,
    providerWalletId,
    feeWalletId: input.fee_wallet_id ?? null,
    paymentMethod,
    txnDate,
    idempotencyKey: input.idempotency_key,
  });

  const created = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);

  await tx.run(
    `INSERT INTO transaction_audit_logs (
      transaction_id, action, actor, old_values_json, new_values_json, reason, created_at
    ) VALUES (?, 'created', ?, NULL, ?, 'Initial transaction recording', ?)`,
    [transactionId, input.actor || 'Owner / Cashier', JSON.stringify(created), now]
  );

  return { transaction: created, duplicate: false };
}

export async function createTransaction(input: CreateTransactionInput) {
  return runInTransaction((tx) => createTransactionInTx(tx, input));
}

export interface RecordPaymentInput {
  wallet_id: number;
  amount_paid_cents: number;
  payment_method?: string;
  payment_date?: string;
  notes?: string;
  idempotency_key?: string;
  actor?: string;
}

export async function recordTransactionPayment(transactionId: number, input: RecordPaymentInput) {
  return runInTransaction(async (tx) => {
    if (input.idempotency_key) {
      const existingPay = await tx.get<any>(
        'SELECT * FROM transaction_payments WHERE idempotency_key = ?',
        [input.idempotency_key]
      );
      if (existingPay) {
        const txn = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
        return { transaction: txn, payment: existingPay, duplicate: true };
      }
    }

    const txn = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!txn) throw new Error('Transaction not found.');
    if (txn.payment_status === 'voided') throw new Error('Cannot record payment on a voided transaction.');

    const collectible = getCollectibleCents(txn);
    const remaining = collectible - Number(txn.amount_paid_cents);
    if (remaining <= 0) {
      throw new Error('This transaction is already fully paid.');
    }

    const amountCents = Math.round(input.amount_paid_cents);
    if (amountCents <= 0) {
      throw new Error('Payment amount must be greater than ₱0.00.');
    }
    if (amountCents > remaining) {
      throw new Error(`Payment amount exceeds remaining balance of ₱${(remaining / 100).toFixed(2)}.`);
    }

    const wallet = await getWalletById(input.wallet_id, tx);
    if (!wallet) throw new Error('Selected payment wallet not found.');

    const paymentMethod = input.payment_method || wallet.wallet_name;
    const paymentDate = input.payment_date || nowIso();
    const now = nowIso();

    const paymentId = await tx.insertAndGetId(
      `INSERT INTO transaction_payments (
        transaction_id, wallet_id, amount_paid_cents, payment_method, payment_date, notes, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        input.wallet_id,
        amountCents,
        paymentMethod,
        paymentDate,
        input.notes ?? null,
        input.idempotency_key ?? null,
        now,
      ]
    );

    await insertLedgerEntry(tx, {
      wallet_id: input.wallet_id,
      reference_type: 'transaction_payment',
      reference_id: paymentId,
      reference_code: txn.transaction_number,
      transaction_type: 'Balance Settlement Payment',
      amount_in_cents: amountCents,
      amount_out_cents: 0,
      description: `Payment settled for ${txn.transaction_number} (${txn.customer_name})`,
      entry_date: paymentDate,
    });

    const newPaidTotal = Number(txn.amount_paid_cents) + amountCents;
    const newStatus = newPaidTotal >= collectible ? 'paid' : 'partial';
    const updatedMethod =
      Number(txn.amount_paid_cents) === 0
        ? paymentMethod
        : txn.payment_method === paymentMethod
          ? paymentMethod
          : 'Mixed';

    await tx.run(
      `UPDATE transactions
       SET amount_paid_cents = ?,
           payment_status = ?,
           assigned_wallet_id = COALESCE(assigned_wallet_id, ?),
           payment_method = ?,
           updated_at = ?
       WHERE id = ?`,
      [newPaidTotal, newStatus, input.wallet_id, updatedMethod, now, transactionId]
    );

    const updatedTxn = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    const paymentRow = await tx.get<any>('SELECT * FROM transaction_payments WHERE id = ?', [paymentId]);

    await tx.run(
      `INSERT INTO transaction_audit_logs (
        transaction_id, action, actor, old_values_json, new_values_json, reason, created_at
      ) VALUES (?, 'payment_recorded', ?, ?, ?, ?, ?)`,
      [
        transactionId,
        input.actor || 'Owner / Cashier',
        JSON.stringify({ amount_paid_cents: txn.amount_paid_cents, payment_status: txn.payment_status }),
        JSON.stringify({ amount_paid_cents: newPaidTotal, payment_status: newStatus, wallet: wallet.wallet_name }),
        input.notes || 'Customer balance settlement',
        now,
      ]
    );

    return { transaction: updatedTxn, payment: paymentRow, duplicate: false };
  });
}

async function reverseActiveLedgerForTransaction(
  tx: DbExecutor,
  transactionId: number,
  transactionNumber: string,
  reason: string
): Promise<void> {
  const paymentRows = await tx.all<{ id: number }>(
    'SELECT id FROM transaction_payments WHERE transaction_id = ?',
    [transactionId]
  );
  const paymentIds = paymentRows.map((p) => p.id);

  const ledgerEntries = await tx.all<any>(
    `SELECT * FROM wallet_ledger
     WHERE (reference_type = 'transaction' AND reference_id = ?)
        OR (reference_type = 'transaction_payment' AND reference_id IN (${
          paymentIds.length > 0 ? paymentIds.map(() => '?').join(',') : '-1'
        }))
     ORDER BY id ASC`,
    [transactionId, ...paymentIds]
  );

  const existingReversals = await tx.all<any>(
    `SELECT wallet_id, amount_in_cents, amount_out_cents
     FROM wallet_ledger
     WHERE reference_type = 'transaction_reversal' AND reference_id = ?`,
    [transactionId]
  );

  const alreadyReversedCount = existingReversals.length;
  if (ledgerEntries.length === 0) return;

  const netByWallet = new Map<number, number>();
  for (const e of ledgerEntries) {
    netByWallet.set(
      e.wallet_id,
      (netByWallet.get(e.wallet_id) ?? 0) + (Number(e.amount_in_cents) - Number(e.amount_out_cents))
    );
  }

  for (const r of existingReversals) {
    netByWallet.set(
      r.wallet_id,
      (netByWallet.get(r.wallet_id) ?? 0) + (Number(r.amount_in_cents) - Number(r.amount_out_cents))
    );
  }

  const revDate = nowIso();
  for (const [walletId, netCents] of netByWallet.entries()) {
    if (netCents === 0) continue;
    await insertLedgerEntry(tx, {
      wallet_id: walletId,
      reference_type: 'transaction_reversal',
      reference_id: transactionId,
      reference_code: `${transactionNumber}-REV${alreadyReversedCount + 1}`,
      transaction_type: 'Reversal',
      amount_in_cents: netCents < 0 ? Math.abs(netCents) : 0,
      amount_out_cents: netCents > 0 ? netCents : 0,
      description: `Reversal of ${transactionNumber}: ${reason}`,
      entry_date: revDate,
    });
  }
}

export async function voidTransaction(transactionId: number, reason: string, actor = 'Owner / Cashier') {
  return runInTransaction(async (tx) => {
    const txn = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!txn) throw new Error('Transaction not found.');
    if (txn.payment_status === 'voided') throw new Error('Transaction is already voided.');
    if (!reason || !reason.trim()) throw new Error('A reason is required to void a transaction.');

    const now = nowIso();
    await reverseActiveLedgerForTransaction(tx, transactionId, txn.transaction_number, reason.trim());

    await tx.run(
      `UPDATE transactions
       SET payment_status = 'voided', updated_at = ?
       WHERE id = ?`,
      [now, transactionId]
    );

    const updated = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);

    await tx.run(
      `INSERT INTO transaction_audit_logs (
        transaction_id, action, actor, old_values_json, new_values_json, reason, created_at
      ) VALUES (?, 'voided', ?, ?, ?, ?, ?)`,
      [transactionId, actor, JSON.stringify(txn), JSON.stringify(updated), reason.trim(), now]
    );

    return updated;
  });
}

export interface EditTransactionInput {
  customer_name?: string;
  service_type?: string;
  description?: string;
  provider?: string | null;
  quantity?: number;
  unit_price_cents?: number;
  total_amount_cents?: number;
  principal_amount_cents?: number;
  actual_cost_cents?: number;
  service_fee_cents?: number;
  assigned_wallet_id?: number | null;
  provider_wallet_id?: number | null;
  payment_status?: 'paid' | 'unpaid' | 'partial';
  amount_paid_cents?: number;
  payment_method?: string;
  transaction_date?: string;
  reason: string;
  actor?: string;
}

export async function editTransaction(transactionId: number, input: EditTransactionInput) {
  return runInTransaction(async (tx) => {
    const txn = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!txn) throw new Error('Transaction not found.');
    if (txn.payment_status === 'voided') throw new Error('Cannot edit a voided transaction.');
    if (!input.reason || !input.reason.trim()) {
      throw new Error('A correction reason is required when editing a transaction.');
    }

    const now = nowIso();
    const nextCategory = txn.service_category as ServiceCategory;
    const nextServiceType = input.service_type ?? txn.service_type;
    const nextDescription = input.description ?? txn.description;
    const nextCustomer = (input.customer_name ?? txn.customer_name).trim();
    const nextDate = input.transaction_date ?? txn.transaction_date;

    const fin = computeTransactionFinancials({
      customer_name: nextCustomer,
      service_category: nextCategory,
      service_type: nextServiceType,
      description: nextDescription,
      provider: input.provider !== undefined ? input.provider : txn.provider,
      quantity: input.quantity ?? Number(txn.quantity),
      unit_price_cents: input.unit_price_cents ?? Number(txn.unit_price_cents),
      total_amount_cents: input.total_amount_cents ?? Number(txn.total_amount_cents),
      principal_amount_cents: input.principal_amount_cents ?? Number(txn.principal_amount_cents),
      actual_cost_cents: input.actual_cost_cents ?? Number(txn.actual_cost_cents),
      service_fee_cents: input.service_fee_cents ?? Number(txn.service_fee_cents),
      payment_status: (input.payment_status ?? txn.payment_status) as any,
    });

    const nextStatus = (input.payment_status ?? txn.payment_status) as 'paid' | 'unpaid' | 'partial';
    const nextAssignedWalletId =
      input.assigned_wallet_id !== undefined ? input.assigned_wallet_id : txn.assigned_wallet_id;
    const nextProviderWalletId =
      input.provider_wallet_id !== undefined ? input.provider_wallet_id : txn.provider_wallet_id;

    let nextAmountPaid = Number(txn.amount_paid_cents);
    if (nextStatus === 'paid') {
      nextAmountPaid = fin.collectible_cents;
    } else if (nextStatus === 'unpaid') {
      nextAmountPaid = 0;
    } else if (input.amount_paid_cents !== undefined) {
      nextAmountPaid = Math.max(0, Math.min(fin.collectible_cents, Math.round(input.amount_paid_cents)));
    }

    const assignedWallet = nextAssignedWalletId ? await getWalletById(nextAssignedWalletId, tx) : null;
    const nextPaymentMethod =
      nextStatus === 'unpaid'
        ? 'Unpaid'
        : input.payment_method || assignedWallet?.wallet_name || txn.payment_method;

    const financialChanged =
      nextServiceType !== txn.service_type ||
      fin.total_amount_cents !== Number(txn.total_amount_cents) ||
      fin.principal_amount_cents !== Number(txn.principal_amount_cents) ||
      fin.actual_cost_cents !== Number(txn.actual_cost_cents) ||
      fin.service_fee_cents !== Number(txn.service_fee_cents) ||
      nextAssignedWalletId !== txn.assigned_wallet_id ||
      nextProviderWalletId !== txn.provider_wallet_id ||
      nextStatus !== txn.payment_status ||
      nextAmountPaid !== Number(txn.amount_paid_cents) ||
      nextDate !== txn.transaction_date;

    if (financialChanged) {
      await reverseActiveLedgerForTransaction(
        tx,
        transactionId,
        txn.transaction_number,
        `Edited (${input.reason.trim()})`
      );
    }

    await tx.run(
      `UPDATE transactions
       SET customer_name = ?,
           service_type = ?,
           description = ?,
           provider = ?,
           quantity = ?,
           unit_price_cents = ?,
           total_amount_cents = ?,
           principal_amount_cents = ?,
           actual_cost_cents = ?,
           service_fee_cents = ?,
           earnings_cents = ?,
           payment_status = ?,
           amount_paid_cents = ?,
           assigned_wallet_id = ?,
           provider_wallet_id = ?,
           payment_method = ?,
           transaction_date = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        nextCustomer,
        nextServiceType,
        nextDescription,
        input.provider !== undefined ? input.provider : txn.provider,
        fin.quantity,
        fin.unit_price_cents,
        fin.total_amount_cents,
        fin.principal_amount_cents,
        fin.actual_cost_cents,
        fin.service_fee_cents,
        fin.earnings_cents,
        nextStatus,
        nextAmountPaid,
        nextAssignedWalletId,
        nextProviderWalletId,
        nextPaymentMethod,
        nextDate,
        now,
        transactionId,
      ]
    );

    if (financialChanged) {
      await postTransactionMovements(tx, {
        transactionId,
        transactionNumber: txn.transaction_number,
        serviceCategory: nextCategory,
        serviceType: nextServiceType,
        description: nextDescription,
        customerName: nextCustomer,
        principalCents: fin.principal_amount_cents,
        serviceFeeCents: fin.service_fee_cents,
        collectibleCents: fin.collectible_cents,
        paymentStatus: nextStatus,
        amountPaidCents: nextAmountPaid,
        assignedWalletId: nextAssignedWalletId,
        providerWalletId: nextProviderWalletId,
        feeWalletId: null,
        paymentMethod: nextPaymentMethod,
        txnDate: nextDate,
      });
    }

    const updated = await tx.get<any>('SELECT * FROM transactions WHERE id = ?', [transactionId]);

    await tx.run(
      `INSERT INTO transaction_audit_logs (
        transaction_id, action, actor, old_values_json, new_values_json, reason, created_at
      ) VALUES (?, 'updated', ?, ?, ?, ?, ?)`,
      [
        transactionId,
        input.actor || 'Owner / Cashier',
        JSON.stringify(txn),
        JSON.stringify(updated),
        input.reason.trim(),
        now,
      ]
    );

    return updated;
  });
}

export interface CreateTransferInput {
  idempotency_key?: string;
  source_wallet_id: number;
  destination_wallet_id: number;
  amount_cents: number;
  description?: string;
  transfer_date?: string;
}

export async function createWalletTransferInTx(tx: DbExecutor, input: CreateTransferInput) {
  if (input.idempotency_key) {
    const existing = await tx.get<any>('SELECT * FROM wallet_transfers WHERE idempotency_key = ?', [
      input.idempotency_key,
    ]);
    if (existing) {
      return { transfer: existing, duplicate: true };
    }
  }

  if (input.source_wallet_id === input.destination_wallet_id) {
    throw new Error('Source wallet and destination wallet cannot be the same.');
  }
  const amountCents = Math.round(input.amount_cents);
  if (amountCents <= 0) {
    throw new Error('Transfer amount must be greater than ₱0.00.');
  }

  const src = await getWalletById(input.source_wallet_id, tx);
  const dst = await getWalletById(input.destination_wallet_id, tx);
  if (!src || !dst) throw new Error('Invalid source or destination wallet.');

  const transferDate = input.transfer_date || nowIso();
  const now = nowIso();
  const description = (input.description || `Transfer from ${src.wallet_name} to ${dst.wallet_name}`).trim();
  const tempCode = `TRF-TMP-${Date.now()}`;

  const transferId = await tx.insertAndGetId(
    `INSERT INTO wallet_transfers (
      transfer_number, idempotency_key, source_wallet_id, destination_wallet_id,
      amount_cents, description, transfer_date, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    [
      tempCode,
      input.idempotency_key ?? null,
      input.source_wallet_id,
      input.destination_wallet_id,
      amountCents,
      description,
      transferDate,
      now,
    ]
  );

  const transferNumber = formatCodePrefix('TRF', transferId);
  await tx.run('UPDATE wallet_transfers SET transfer_number = ? WHERE id = ?', [
    transferNumber,
    transferId,
  ]);

  await insertLedgerEntry(tx, {
    wallet_id: input.source_wallet_id,
    reference_type: 'transfer',
    reference_id: transferId,
    reference_code: transferNumber,
    transaction_type: 'Transfer Out',
    amount_in_cents: 0,
    amount_out_cents: amountCents,
    description: `${description} (To ${dst.wallet_name})`,
    entry_date: transferDate,
  });

  await insertLedgerEntry(tx, {
    wallet_id: input.destination_wallet_id,
    reference_type: 'transfer',
    reference_id: transferId,
    reference_code: transferNumber,
    transaction_type: 'Transfer In',
    amount_in_cents: amountCents,
    amount_out_cents: 0,
    description: `${description} (From ${src.wallet_name})`,
    entry_date: transferDate,
  });

  const transfer = await tx.get<any>('SELECT * FROM wallet_transfers WHERE id = ?', [transferId]);
  return { transfer, duplicate: false };
}

export async function createWalletTransfer(input: CreateTransferInput) {
  return runInTransaction((tx) => createWalletTransferInTx(tx, input));
}

export interface CreateExpenseInput {
  idempotency_key?: string;
  description: string;
  category: string;
  movement_type?: MovementType;
  amount_cents: number;
  wallet_id: number;
  related_transaction_id?: number | null;
  refund_category_id?: number | null;
  expense_date?: string;
  remarks?: string | null;
}

export async function createExpenseInTx(tx: DbExecutor, input: CreateExpenseInput) {
  if (input.idempotency_key) {
    const existing = await tx.get<any>('SELECT * FROM expenses WHERE idempotency_key = ?', [
      input.idempotency_key,
    ]);
    if (existing) {
      return { expense: existing, duplicate: true };
    }
  }

  const amountCents = Math.round(input.amount_cents);
  if (amountCents <= 0) throw new Error('Amount must be greater than ₱0.00.');

  const wallet = await getWalletById(input.wallet_id, tx);
  if (!wallet) throw new Error('Selected payment wallet not found.');

  const movementType: MovementType = input.movement_type || 'expense';
  const expenseDate = input.expense_date || nowIso();
  const now = nowIso();
  const tempNum = `EXP-TMP-${Date.now()}`;

  const expenseId = await tx.insertAndGetId(
    `INSERT INTO expenses (
      expense_number, idempotency_key, description, category, movement_type,
      amount_cents, wallet_id, related_transaction_id, refund_category_id,
      expense_date, remarks, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      tempNum,
      input.idempotency_key ?? null,
      input.description.trim(),
      input.category,
      movementType,
      amountCents,
      input.wallet_id,
      input.related_transaction_id ?? null,
      input.refund_category_id ?? null,
      expenseDate,
      input.remarks ?? null,
      now,
    ]
  );

  const prefix = movementType === 'refund' ? 'RFD' : movementType === 'inventory_replenishment' ? 'REP' : 'EXP';
  const expenseNumber = formatCodePrefix(prefix, expenseId);
  await tx.run('UPDATE expenses SET expense_number = ? WHERE id = ?', [expenseNumber, expenseId]);

  const ledgerType =
    movementType === 'refund'
      ? 'Refund Out'
      : movementType === 'inventory_replenishment'
        ? 'Inventory Replenishment'
        : 'Expense';

  await insertLedgerEntry(tx, {
    wallet_id: input.wallet_id,
    reference_type: movementType === 'refund' ? 'refund' : 'expense',
    reference_id: expenseId,
    reference_code: expenseNumber,
    transaction_type: ledgerType,
    amount_in_cents: 0,
    amount_out_cents: amountCents,
    description: `${input.category}: ${input.description.trim()}`,
    entry_date: expenseDate,
  });

  const expense = await tx.get<any>('SELECT * FROM expenses WHERE id = ?', [expenseId]);
  return { expense, duplicate: false };
}

export async function createExpense(input: CreateExpenseInput) {
  return runInTransaction((tx) => createExpenseInTx(tx, input));
}

export async function voidExpense(expenseId: number, reason: string) {
  return runInTransaction(async (tx) => {
    const exp = await tx.get<any>('SELECT * FROM expenses WHERE id = ?', [expenseId]);
    if (!exp) throw new Error('Expense record not found.');
    if (exp.status === 'voided') throw new Error('Expense record is already voided.');

    const voidNote = `Voided: ${reason || 'Cancelled'}`;
    const nextRemarks = exp.remarks ? `${exp.remarks} | ${voidNote}` : voidNote;
    await tx.run(`UPDATE expenses SET status = 'voided', remarks = ? WHERE id = ?`, [
      nextRemarks,
      expenseId,
    ]);

    await insertLedgerEntry(tx, {
      wallet_id: exp.wallet_id,
      reference_type: 'expense_reversal',
      reference_id: expenseId,
      reference_code: `${exp.expense_number}-REV`,
      transaction_type: 'Reversal',
      amount_in_cents: Number(exp.amount_cents),
      amount_out_cents: 0,
      description: `Voided ${exp.expense_number}: ${exp.description}`,
      entry_date: nowIso(),
    });

    return tx.get<any>('SELECT * FROM expenses WHERE id = ?', [expenseId]);
  });
}

export interface CreateAdjustmentInput {
  idempotency_key?: string;
  wallet_id: number;
  adjustment_type: 'increase' | 'decrease';
  amount_cents: number;
  reason: string;
  adjustment_date?: string;
}

export async function createBalanceAdjustment(input: CreateAdjustmentInput) {
  return runInTransaction(async (tx) => {
    if (input.idempotency_key) {
      const existing = await tx.get<any>('SELECT * FROM balance_adjustments WHERE idempotency_key = ?', [
        input.idempotency_key,
      ]);
      if (existing) {
        return { adjustment: existing, duplicate: true };
      }
    }

    const amountCents = Math.round(input.amount_cents);
    if (amountCents <= 0) throw new Error('Adjustment amount must be greater than ₱0.00.');
    if (!input.reason || !input.reason.trim()) throw new Error('A reason is required for balance adjustments.');

    const wallet = await getWalletById(input.wallet_id, tx);
    if (!wallet) throw new Error('Wallet not found.');

    const adjDate = input.adjustment_date || nowIso();
    const now = nowIso();
    const tempCode = `ADJ-TMP-${Date.now()}`;

    const adjId = await tx.insertAndGetId(
      `INSERT INTO balance_adjustments (
        adjustment_number, idempotency_key, wallet_id, adjustment_type,
        amount_cents, reason, adjustment_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tempCode,
        input.idempotency_key ?? null,
        input.wallet_id,
        input.adjustment_type,
        amountCents,
        input.reason.trim(),
        adjDate,
        now,
      ]
    );

    const adjNumber = formatCodePrefix('ADJ', adjId);
    await tx.run('UPDATE balance_adjustments SET adjustment_number = ? WHERE id = ?', [adjNumber, adjId]);

    await insertLedgerEntry(tx, {
      wallet_id: input.wallet_id,
      reference_type: 'adjustment',
      reference_id: adjId,
      reference_code: adjNumber,
      transaction_type: input.adjustment_type === 'increase' ? 'Adjustment Increase' : 'Adjustment Decrease',
      amount_in_cents: input.adjustment_type === 'increase' ? amountCents : 0,
      amount_out_cents: input.adjustment_type === 'decrease' ? amountCents : 0,
      description: input.reason.trim(),
      entry_date: adjDate,
    });

    const adjustment = await tx.get<any>('SELECT * FROM balance_adjustments WHERE id = ?', [adjId]);
    return { adjustment, duplicate: false };
  });
}

export async function reconcileAllWallets(executor?: DbExecutor) {
  const db = executor ?? (await getDb());
  const wallets = await db.all<any>('SELECT * FROM wallets ORDER BY id ASC');
  const results = [];
  for (const w of wallets) {
    const agg = (await db.get<{ total_in: number; total_out: number }>(
      `SELECT COALESCE(SUM(amount_in_cents), 0) AS total_in, COALESCE(SUM(amount_out_cents), 0) AS total_out
       FROM wallet_ledger WHERE wallet_id = ?`,
      [w.id]
    )) ?? { total_in: 0, total_out: 0 };
    const totalIn = Number(agg.total_in);
    const totalOut = Number(agg.total_out);
    const opening = Number(w.opening_balance_cents);
    const cached = Number(w.current_balance_cents);
    const computed = opening + totalIn - totalOut;
    results.push({
      wallet_id: w.id,
      wallet_name: w.wallet_name,
      opening_balance_cents: opening,
      total_in_cents: totalIn,
      total_out_cents: totalOut,
      computed_balance_cents: computed,
      cached_balance_cents: cached,
      is_reconciled: computed === cached,
      discrepancy_cents: cached - computed,
    });
  }
  return results;
}

async function shortenLegacyCodes(tx: DbExecutor): Promise<void> {
  const shorten = (code: string) => code.replace(/^([A-Z]+)-\d{8}-(\d+.*)$/, '$1-$2');

  const txns = await tx.all<{ id: number; transaction_number: string }>(
    'SELECT id, transaction_number FROM transactions'
  );
  for (const t of txns) {
    const next = shorten(t.transaction_number);
    if (next !== t.transaction_number) {
      await tx.run('UPDATE transactions SET transaction_number = ? WHERE id = ?', [next, t.id]);
    }
  }

  const trfs = await tx.all<{ id: number; transfer_number: string }>(
    'SELECT id, transfer_number FROM wallet_transfers'
  );
  for (const tr of trfs) {
    const next = shorten(tr.transfer_number);
    if (next !== tr.transfer_number) {
      await tx.run('UPDATE wallet_transfers SET transfer_number = ? WHERE id = ?', [next, tr.id]);
    }
  }

  const exps = await tx.all<{ id: number; expense_number: string }>(
    'SELECT id, expense_number FROM expenses'
  );
  for (const e of exps) {
    const next = shorten(e.expense_number);
    if (next !== e.expense_number) {
      await tx.run('UPDATE expenses SET expense_number = ? WHERE id = ?', [next, e.id]);
    }
  }

  const adjs = await tx.all<{ id: number; adjustment_number: string }>(
    'SELECT id, adjustment_number FROM balance_adjustments'
  );
  for (const a of adjs) {
    const next = shorten(a.adjustment_number);
    if (next !== a.adjustment_number) {
      await tx.run('UPDATE balance_adjustments SET adjustment_number = ? WHERE id = ?', [next, a.id]);
    }
  }

  const ledgers = await tx.all<{ id: number; reference_code: string }>(
    'SELECT id, reference_code FROM wallet_ledger'
  );
  for (const l of ledgers) {
    const next = shorten(l.reference_code);
    if (next !== l.reference_code) {
      await tx.run('UPDATE wallet_ledger SET reference_code = ? WHERE id = ?', [next, l.id]);
    }
  }
}

export async function bootstrapAndSeedDatabase(): Promise<void> {
  await initSchema();

  await runInTransaction(async (tx) => {
    await shortenLegacyCodes(tx);

    const existingWallets = await tx.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM wallets');
    if (Number(existingWallets?.cnt ?? 0) > 0) return;

    const now = nowIso();

    const insertWalletSql = `INSERT INTO wallets (wallet_name, wallet_type, opening_balance_cents, current_balance_cents, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`;
    const wCash = await tx.insertAndGetId(insertWalletSql, ['Physical Cash', 'cash', 500000, 500000, now, now]);
    const wGCash = await tx.insertAndGetId(insertWalletSql, ['GCash', 'ewallet', 1200000, 1200000, now, now]);
    const wMaya = await tx.insertAndGetId(insertWalletSql, ['Maya', 'ewallet', 800000, 800000, now, now]);
    const wMariBank = await tx.insertAndGetId(insertWalletSql, ['MariBank', 'bank', 1500000, 1500000, now, now]);

    const insertRefundCatSql = `INSERT INTO refund_categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?)`;
    const rcMariBank = await tx.insertAndGetId(insertRefundCatSql, [
      'Maribank Refund',
      'Customer or wallet dispute refunds via MariBank',
      now,
    ]);
    const rcSpay = await tx.insertAndGetId(insertRefundCatSql, [
      'Spay Refund',
      'ShopeePay / SPayLater settlement refunds',
      now,
    ]);
    await tx.run(insertRefundCatSql, ['Other Refunds', 'Miscellaneous service or loading refunds', now]);

    const insertServiceSql = `INSERT INTO services (service_name, category, provider, default_price_cents, actual_cost_cents, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`;

    const defaultServices: Array<[string, ServiceCategory, string | null, number, number, string]> = [
      ['Globe Go50 (5GB 3 Days)', 'loading', 'Globe', 5500, 4850, 'All-net data & calls promo'],
      ['Globe Go90 (8GB 7 Days)', 'loading', 'Globe', 9500, 8750, 'Weekly data promo'],
      ['Smart Power All 99', 'loading', 'Smart', 10500, 9600, '8GB + Unli TikTok 7 Days'],
      ['TNT Giga Video 50', 'loading', 'TNT', 5500, 4850, 'Giga Video 3 Days'],
      ['DITO Level-Up 99', 'loading', 'DITO', 10500, 9550, '7GB + Unli DITO calls'],
      ['TM EasySURF 50', 'loading', 'TM', 5500, 4850, '3-day data & unli text'],
      ['GOMO 30GB No Expiry', 'loading', 'GOMO', 41500, 39900, 'No-expiry 30GB data load'],
      ['Cignal Prepaid Load 300', 'loading', 'Cignal', 31500, 29500, 'TV Cable Load 300'],
      ['GCash Cash-In (Per ₱500 Tier)', 'cash_in_out', 'GCash', 1000, 0, 'Standard neighborhood cash-in service fee'],
      ['GCash Cash-Out (Per ₱500 Tier)', 'cash_in_out', 'GCash', 1000, 0, 'Standard neighborhood cash-out service fee'],
      ['Maya Cash-In (Per ₱500 Tier)', 'cash_in_out', 'Maya', 1000, 0, 'Maya cash-in service fee'],
      ['Maya Cash-Out (Per ₱500 Tier)', 'cash_in_out', 'Maya', 1000, 0, 'Maya cash-out service fee'],
      ['Black & White Printing (per page)', 'printing', null, 500, 100, 'Short/A4 standard B&W document print'],
      ['Colored Printing (per page)', 'printing', null, 1500, 400, 'Full color text & graphics print'],
      ['Photocopy (per page)', 'printing', null, 300, 75, 'Standard Xerox / photocopy'],
      ['1x1 ID Picture (6 pcs set)', 'printing', null, 4500, 1000, 'Glossy photo paper + cutting'],
      ['2x2 ID Picture (4 pcs set)', 'printing', null, 5000, 1200, 'Glossy photo paper + cutting'],
      ['Resume Making & Formatting', 'extra_services', null, 15000, 1000, 'Custom CV design + 2 printed copies'],
      ['Layouting & Graphic Design', 'extra_services', null, 35000, 0, 'Tarpaulin, invitation, or flyer layout'],
      ['ID Picture Background Editing', 'extra_services', null, 4000, 0, 'Formal attire & white/blue background edit'],
      ['Document Formatting / Typing', 'extra_services', null, 8000, 500, 'School or government form encoding'],
    ];

    for (const s of defaultServices) {
      await tx.run(insertServiceSql, [s[0], s[1], s[2], s[3], s[4], s[5], now, now]);
    }

    const insertSettingSql = `INSERT INTO business_settings (key, value) VALUES (?, ?)`;
    await tx.run(insertSettingSql, ['business_name', "Sheena & Shelo's Business"]);
    await tx.run(insertSettingSql, ['owner_name', 'Sheena & Shelo']);
    await tx.run(insertSettingSql, ['store_address', 'Neighborhood Digital & Print Hub']);
    await tx.run(insertSettingSql, ['currency', 'PHP']);

    const seedTxns: CreateTransactionInput[] = [
      {
        customer_name: 'Maria Santos',
        service_category: 'printing',
        service_type: 'Document Printing',
        description: '40 pages thesis print & binding',
        quantity: 40,
        unit_price_cents: 500,
        total_amount_cents: 20000,
        actual_cost_cents: 4000,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-09-14T10:15:00.000Z',
      },
      {
        customer_name: 'Kevin Reyes',
        service_category: 'extra_services',
        service_type: 'Layouting & Graphic Design',
        description: 'Birthday tarpaulin 4x3 layout',
        total_amount_cents: 35000,
        actual_cost_cents: 0,
        payment_status: 'paid',
        assigned_wallet_id: wGCash,
        payment_method: 'GCash',
        transaction_date: '2026-09-21T14:30:00.000Z',
      },
      {
        customer_name: 'Aling Nena',
        service_category: 'cash_in_out',
        service_type: 'Cash-in',
        description: 'GCash Cash-In ₱2,000',
        provider: 'GCash',
        total_amount_cents: 4000,
        principal_amount_cents: 200000,
        service_fee_cents: 4000,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        provider_wallet_id: wGCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-10-08T09:20:00.000Z',
      },
      {
        customer_name: 'Carlo Mendoza',
        service_category: 'loading',
        service_type: 'Mobile Load',
        description: 'Globe Go90 (8GB 7 Days)',
        provider: 'Globe',
        total_amount_cents: 9500,
        actual_cost_cents: 8750,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-10-19T16:40:00.000Z',
      },
      {
        customer_name: 'Jessa Lim',
        service_category: 'extra_services',
        service_type: 'Resume Making',
        description: 'Modern CV layout + 3 printed copies',
        total_amount_cents: 18000,
        actual_cost_cents: 1500,
        payment_status: 'paid',
        assigned_wallet_id: wMaya,
        payment_method: 'Maya',
        transaction_date: '2026-10-25T11:05:00.000Z',
      },
      {
        customer_name: 'Mark Villanueva',
        service_category: 'loading',
        service_type: 'TV Cable Load',
        description: 'Cignal Prepaid Load 300',
        provider: 'Cignal',
        total_amount_cents: 31500,
        actual_cost_cents: 29500,
        payment_status: 'paid',
        assigned_wallet_id: wGCash,
        payment_method: 'GCash',
        transaction_date: '2026-11-03T10:12:00.000Z',
      },
      {
        customer_name: 'Liza Bautista',
        service_category: 'cash_in_out',
        service_type: 'Cash-out',
        description: 'Maya Cash-Out ₱1,500',
        provider: 'Maya',
        total_amount_cents: 3000,
        principal_amount_cents: 150000,
        service_fee_cents: 3000,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        provider_wallet_id: wMaya,
        fee_wallet_id: wCash,
        payment_method: 'Maya',
        transaction_date: '2026-11-06T15:45:00.000Z',
      },
      {
        customer_name: 'Rico Tan',
        service_category: 'printing',
        service_type: '2x2 ID Picture',
        description: '2x2 ID Picture + formal attire edit',
        quantity: 2,
        unit_price_cents: 5000,
        total_amount_cents: 10000,
        actual_cost_cents: 2400,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-11-09T13:20:00.000Z',
      },
      {
        customer_name: 'Paolo Navarro',
        service_category: 'extra_services',
        service_type: 'Layouting & Graphic Design',
        description: 'Product label sticker design',
        total_amount_cents: 45000,
        actual_cost_cents: 0,
        payment_status: 'paid',
        assigned_wallet_id: wMariBank,
        payment_method: 'MariBank',
        transaction_date: '2026-11-11T17:10:00.000Z',
      },
      {
        customer_name: 'Grace Aquino',
        service_category: 'loading',
        service_type: 'Mobile Load',
        description: 'Smart Power All 99',
        provider: 'Smart',
        total_amount_cents: 10500,
        actual_cost_cents: 9600,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-11-13T08:15:00',
      },
      {
        customer_name: 'Kuya Ben',
        service_category: 'cash_in_out',
        service_type: 'Cash-in',
        description: 'GCash Cash-In ₱1,000',
        provider: 'GCash',
        total_amount_cents: 2000,
        principal_amount_cents: 100000,
        service_fee_cents: 2000,
        payment_status: 'paid',
        assigned_wallet_id: wCash,
        provider_wallet_id: wGCash,
        payment_method: 'Physical Cash',
        transaction_date: '2026-11-13T09:30:00',
      },
      {
        customer_name: 'Hannah Cruz',
        service_category: 'printing',
        service_type: 'Colored Printing',
        description: '12 pages colored school project',
        quantity: 12,
        unit_price_cents: 1500,
        total_amount_cents: 18000,
        actual_cost_cents: 4800,
        payment_status: 'paid',
        assigned_wallet_id: wMaya,
        payment_method: 'Maya',
        transaction_date: '2026-11-13T10:45:00',
      },
      {
        customer_name: 'Junie Morales',
        service_category: 'extra_services',
        service_type: 'Resume Making',
        description: 'Resume layout + ID pic edit (to pay tonight)',
        total_amount_cents: 20000,
        actual_cost_cents: 1500,
        payment_status: 'unpaid',
        assigned_wallet_id: null,
        payment_method: 'Unpaid',
        transaction_date: '2026-11-13T11:20:00',
      },
    ];

    for (const t of seedTxns) {
      await createTransactionInTx(tx, t);
    }

    await createWalletTransferInTx(tx, {
      source_wallet_id: wCash,
      destination_wallet_id: wGCash,
      amount_cents: 250000,
      description: 'Cash deposit to replenish GCash cash-in float',
      transfer_date: '2026-11-05T16:00:00.000Z',
    });

    await createExpenseInTx(tx, {
      description: '2 reams Hard Copy Bond Paper (Short & A4)',
      category: 'Bond Paper',
      movement_type: 'expense',
      amount_cents: 48000,
      wallet_id: wCash,
      expense_date: '2026-11-04T10:00:00.000Z',
      remarks: 'National Book Store supply',
    });

    await createExpenseInTx(tx, {
      description: 'Epson 003 Genuine Black & Cyan Ink Refills',
      category: 'Printer Ink',
      movement_type: 'expense',
      amount_cents: 62000,
      wallet_id: wMariBank,
      expense_date: '2026-11-10T14:20:00.000Z',
      remarks: 'Official ink store',
    });

    await createExpenseInTx(tx, {
      description: 'September paper & laminating pouches',
      category: 'Printing Materials',
      movement_type: 'expense',
      amount_cents: 35000,
      wallet_id: wCash,
      expense_date: '2026-09-18T11:00:00.000Z',
    });

    await createExpenseInTx(tx, {
      description: 'October fiber internet bill share',
      category: 'Utilities',
      movement_type: 'expense',
      amount_cents: 50000,
      wallet_id: wGCash,
      expense_date: '2026-10-20T12:00:00.000Z',
    });

    await tx.run(
      `INSERT INTO refund_obligations (month_key, refund_category_id, amount_cents, notes, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['2026-11', rcMariBank, 15000, 'Pending MariBank transfer reversal adjustment', now]
    );

    await tx.run(
      `INSERT INTO refund_obligations (month_key, refund_category_id, amount_cents, notes, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['2026-10', rcSpay, 10000, 'October SPay settlement refund', now]
    );
  });
}

let initPromise: Promise<void> | null = null;

export async function ensureDatabaseReady(): Promise<void> {
  if (!initPromise) {
    initPromise = bootstrapAndSeedDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export function resetInitCache(): void {
  initPromise = null;
}

export async function restoreSnapshotFromJson(snapshot: Record<string, any>): Promise<void> {
  if (!snapshot || !Array.isArray(snapshot.wallets)) {
    throw new Error('Invalid backup JSON file: missing wallets array.');
  }

  await initSchema();
  await runInTransaction(async (tx) => {
    await tx.run('DELETE FROM transaction_audit_logs');
    await tx.run('DELETE FROM transaction_payments');
    await tx.run('DELETE FROM wallet_ledger');
    await tx.run('DELETE FROM wallet_transfers');
    await tx.run('DELETE FROM expenses');
    await tx.run('DELETE FROM balance_adjustments');
    await tx.run('DELETE FROM transactions');
    await tx.run('DELETE FROM refund_obligations');
    await tx.run('DELETE FROM refund_categories');
    await tx.run('DELETE FROM services');
    await tx.run('DELETE FROM wallets');
    await tx.run('DELETE FROM business_settings');

    for (const s of snapshot.business_settings || []) {
      await tx.run('INSERT INTO business_settings (key, value) VALUES (?, ?)', [s.key, String(s.value ?? '')]);
    }
    for (const w of snapshot.wallets || []) {
      await tx.run(
        `INSERT INTO wallets (id, wallet_name, wallet_type, opening_balance_cents, current_balance_cents, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          w.id,
          w.wallet_name,
          w.wallet_type,
          Number(w.opening_balance_cents),
          Number(w.current_balance_cents),
          w.status || 'active',
          w.created_at || nowIso(),
          w.updated_at || nowIso(),
        ]
      );
    }
    for (const sv of snapshot.services || []) {
      await tx.run(
        `INSERT INTO services (id, service_name, category, provider, default_price_cents, actual_cost_cents, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sv.id,
          sv.service_name,
          sv.category,
          sv.provider ?? null,
          Number(sv.default_price_cents),
          Number(sv.actual_cost_cents),
          sv.description ?? null,
          sv.status || 'active',
          sv.created_at || nowIso(),
          sv.updated_at || nowIso(),
        ]
      );
    }
    for (const rc of snapshot.refund_categories || []) {
      await tx.run(
        `INSERT INTO refund_categories (id, name, description, is_active, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [rc.id, rc.name, rc.description ?? null, Number(rc.is_active ?? 1), rc.created_at || nowIso()]
      );
    }
    for (const t of snapshot.transactions || []) {
      await tx.run(
        `INSERT INTO transactions (
          id, transaction_number, idempotency_key, customer_name, service_category, service_type,
          description, provider, quantity, unit_price_cents, total_amount_cents,
          principal_amount_cents, actual_cost_cents, service_fee_cents, earnings_cents,
          payment_status, amount_paid_cents, assigned_wallet_id, provider_wallet_id,
          payment_method, metadata_json, transaction_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          t.transaction_number,
          t.idempotency_key ?? null,
          t.customer_name,
          t.service_category,
          t.service_type,
          t.description,
          t.provider ?? null,
          Number(t.quantity ?? 1),
          Number(t.unit_price_cents ?? 0),
          Number(t.total_amount_cents),
          Number(t.principal_amount_cents ?? 0),
          Number(t.actual_cost_cents ?? 0),
          Number(t.service_fee_cents ?? 0),
          Number(t.earnings_cents ?? 0),
          t.payment_status,
          Number(t.amount_paid_cents ?? 0),
          t.assigned_wallet_id ?? null,
          t.provider_wallet_id ?? null,
          t.payment_method,
          t.metadata_json ?? null,
          t.transaction_date,
          t.created_at || nowIso(),
          t.updated_at || nowIso(),
        ]
      );
    }
    for (const tp of snapshot.transaction_payments || []) {
      await tx.run(
        `INSERT INTO transaction_payments (id, transaction_id, wallet_id, amount_paid_cents, payment_method, payment_date, notes, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tp.id,
          tp.transaction_id,
          tp.wallet_id,
          Number(tp.amount_paid_cents),
          tp.payment_method,
          tp.payment_date,
          tp.notes ?? null,
          tp.idempotency_key ?? null,
          tp.created_at || nowIso(),
        ]
      );
    }
    for (const l of snapshot.wallet_ledger || []) {
      await tx.run(
        `INSERT INTO wallet_ledger (id, wallet_id, reference_type, reference_id, reference_code, transaction_type, amount_in_cents, amount_out_cents, description, running_balance_cents, entry_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.wallet_id,
          l.reference_type,
          l.reference_id,
          l.reference_code,
          l.transaction_type,
          Number(l.amount_in_cents),
          Number(l.amount_out_cents),
          l.description,
          Number(l.running_balance_cents),
          l.entry_date,
          l.created_at || nowIso(),
        ]
      );
    }
    for (const tr of snapshot.wallet_transfers || []) {
      await tx.run(
        `INSERT INTO wallet_transfers (id, transfer_number, idempotency_key, source_wallet_id, destination_wallet_id, amount_cents, description, transfer_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tr.id,
          tr.transfer_number,
          tr.idempotency_key ?? null,
          tr.source_wallet_id,
          tr.destination_wallet_id,
          Number(tr.amount_cents),
          tr.description,
          tr.transfer_date,
          tr.status || 'completed',
          tr.created_at || nowIso(),
        ]
      );
    }
    for (const e of snapshot.expenses || []) {
      await tx.run(
        `INSERT INTO expenses (id, expense_number, idempotency_key, description, category, movement_type, amount_cents, wallet_id, related_transaction_id, refund_category_id, expense_date, remarks, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.expense_number,
          e.idempotency_key ?? null,
          e.description,
          e.category,
          e.movement_type || 'expense',
          Number(e.amount_cents),
          e.wallet_id,
          e.related_transaction_id ?? null,
          e.refund_category_id ?? null,
          e.expense_date,
          e.remarks ?? null,
          e.status || 'active',
          e.created_at || nowIso(),
        ]
      );
    }
    for (const a of snapshot.balance_adjustments || []) {
      await tx.run(
        `INSERT INTO balance_adjustments (id, adjustment_number, idempotency_key, wallet_id, adjustment_type, amount_cents, reason, adjustment_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.adjustment_number,
          a.idempotency_key ?? null,
          a.wallet_id,
          a.adjustment_type,
          Number(a.amount_cents),
          a.reason,
          a.adjustment_date,
          a.created_at || nowIso(),
        ]
      );
    }
    for (const ro of snapshot.refund_obligations || []) {
      await tx.run(
        `INSERT INTO refund_obligations (id, month_key, refund_category_id, amount_cents, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ro.id,
          ro.month_key,
          ro.refund_category_id,
          Number(ro.amount_cents),
          ro.notes ?? null,
          ro.updated_at || nowIso(),
        ]
      );
    }
    for (const log of snapshot.transaction_audit_logs || []) {
      await tx.run(
        `INSERT INTO transaction_audit_logs (id, transaction_id, action, actor, old_values_json, new_values_json, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          log.id,
          log.transaction_id,
          log.action,
          log.actor || 'Owner / Cashier',
          log.old_values_json ?? null,
          log.new_values_json ?? null,
          log.reason ?? null,
          log.created_at || nowIso(),
        ]
      );
    }

    await syncPostgresSequences(tx);
  });
}
