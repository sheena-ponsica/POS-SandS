import 'dotenv/config';
import path from 'node:path';
import type { Pool as PgPoolType, PoolClient } from 'pg';

export type DbDialect = 'postgres' | 'sqlite';

export interface DbExecutor {
  readonly dialect: DbDialect;
  get<T = Record<string, any>>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<{ rowCount: number }>;
  insertAndGetId(sql: string, params?: any[]): Promise<number>;
  exec(sql: string): Promise<void>;
}

const PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    wallet_name TEXT NOT NULL UNIQUE,
    wallet_type TEXT NOT NULL CHECK (wallet_type IN ('cash', 'ewallet', 'bank')),
    opening_balance_cents BIGINT NOT NULL DEFAULT 0,
    current_balance_cents BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    service_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('loading', 'cash_in_out', 'printing', 'extra_services')),
    provider TEXT,
    default_price_cents BIGINT NOT NULL DEFAULT 0,
    actual_cost_cents BIGINT NOT NULL DEFAULT 0,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    transaction_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    customer_name TEXT NOT NULL,
    service_category TEXT NOT NULL CHECK (service_category IN ('loading', 'cash_in_out', 'printing', 'extra_services')),
    service_type TEXT NOT NULL,
    description TEXT NOT NULL,
    provider TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents BIGINT NOT NULL DEFAULT 0,
    total_amount_cents BIGINT NOT NULL,
    principal_amount_cents BIGINT NOT NULL DEFAULT 0,
    actual_cost_cents BIGINT NOT NULL DEFAULT 0,
    service_fee_cents BIGINT NOT NULL DEFAULT 0,
    earnings_cents BIGINT NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'unpaid', 'partial', 'voided')),
    amount_paid_cents BIGINT NOT NULL DEFAULT 0,
    assigned_wallet_id INTEGER REFERENCES wallets(id),
    provider_wallet_id INTEGER REFERENCES wallets(id),
    payment_method TEXT NOT NULL,
    metadata_json TEXT,
    transaction_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transaction_payments (
    id SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount_paid_cents BIGINT NOT NULL CHECK (amount_paid_cents > 0),
    payment_method TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_ledger (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    reference_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_code TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_in_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_in_cents >= 0),
    amount_out_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_out_cents >= 0),
    description TEXT NOT NULL,
    running_balance_cents BIGINT NOT NULL,
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_transfers (
    id SERIAL PRIMARY KEY,
    transfer_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    source_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    destination_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    transfer_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
    created_at TEXT NOT NULL,
    CHECK (source_wallet_id != destination_wallet_id)
  );

  CREATE TABLE IF NOT EXISTS refund_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    expense_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    movement_type TEXT NOT NULL DEFAULT 'expense' CHECK (movement_type IN ('expense', 'inventory_replenishment', 'refund')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    related_transaction_id INTEGER REFERENCES transactions(id) ON DELETE RESTRICT,
    refund_category_id INTEGER REFERENCES refund_categories(id) ON DELETE RESTRICT,
    expense_date TEXT NOT NULL,
    remarks TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balance_adjustments (
    id SERIAL PRIMARY KEY,
    adjustment_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('increase', 'decrease')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    adjustment_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transaction_audit_logs (
    id SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'Owner / Cashier',
    old_values_json TEXT,
    new_values_json TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refund_obligations (
    id SERIAL PRIMARY KEY,
    month_key TEXT NOT NULL,
    refund_category_id INTEGER NOT NULL REFERENCES refund_categories(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    notes TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(month_key, refund_category_id)
  );

  CREATE TABLE IF NOT EXISTS business_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS idx_txn_cat ON transactions(service_category);
  CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(payment_status);
  CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON wallet_ledger(wallet_id, entry_date, id);
  CREATE INDEX IF NOT EXISTS idx_ledger_ref ON wallet_ledger(reference_type, reference_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_wallet ON expenses(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_date ON wallet_transfers(transfer_date);
`;

const SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_name TEXT NOT NULL UNIQUE,
    wallet_type TEXT NOT NULL CHECK (wallet_type IN ('cash', 'ewallet', 'bank')),
    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
    current_balance_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('loading', 'cash_in_out', 'printing', 'extra_services')),
    provider TEXT,
    default_price_cents INTEGER NOT NULL DEFAULT 0,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    customer_name TEXT NOT NULL,
    service_category TEXT NOT NULL CHECK (service_category IN ('loading', 'cash_in_out', 'printing', 'extra_services')),
    service_type TEXT NOT NULL,
    description TEXT NOT NULL,
    provider TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    total_amount_cents INTEGER NOT NULL,
    principal_amount_cents INTEGER NOT NULL DEFAULT 0,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
    service_fee_cents INTEGER NOT NULL DEFAULT 0,
    earnings_cents INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'unpaid', 'partial', 'voided')),
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    assigned_wallet_id INTEGER REFERENCES wallets(id),
    provider_wallet_id INTEGER REFERENCES wallets(id),
    payment_method TEXT NOT NULL,
    metadata_json TEXT,
    transaction_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transaction_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents > 0),
    payment_method TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    reference_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_code TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_in_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_in_cents >= 0),
    amount_out_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_out_cents >= 0),
    description TEXT NOT NULL,
    running_balance_cents INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    source_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    destination_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    transfer_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
    created_at TEXT NOT NULL,
    CHECK (source_wallet_id != destination_wallet_id)
  );

  CREATE TABLE IF NOT EXISTS refund_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    movement_type TEXT NOT NULL DEFAULT 'expense' CHECK (movement_type IN ('expense', 'inventory_replenishment', 'refund')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    related_transaction_id INTEGER REFERENCES transactions(id) ON DELETE RESTRICT,
    refund_category_id INTEGER REFERENCES refund_categories(id) ON DELETE RESTRICT,
    expense_date TEXT NOT NULL,
    remarks TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balance_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_number TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('increase', 'decrease')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    adjustment_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transaction_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'Owner / Cashier',
    old_values_json TEXT,
    new_values_json TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refund_obligations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL,
    refund_category_id INTEGER NOT NULL REFERENCES refund_categories(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    notes TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(month_key, refund_category_id)
  );

  CREATE TABLE IF NOT EXISTS business_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS idx_txn_cat ON transactions(service_category);
  CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(payment_status);
  CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON wallet_ledger(wallet_id, entry_date, id);
  CREATE INDEX IF NOT EXISTS idx_ledger_ref ON wallet_ledger(reference_type, reference_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_wallet ON expenses(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_date ON wallet_transfers(transfer_date);
`;

/**
 * Converts positional `?` placeholders (outside single-quoted string literals)
 * into PostgreSQL `$1, $2, ...` placeholders.
 */
function toPgPlaceholders(sql: string): string {
  let out = '';
  let paramIndex = 1;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
    } else if (ch === '?' && !inSingleQuote) {
      out += `$${paramIndex++}`;
    } else {
      out += ch;
    }
  }
  return out;
}

declare global {
  // eslint-disable-next-line no-var
  var _posPgPool: PgPoolType | undefined;
  // eslint-disable-next-line no-var
  var _posSqliteDb: any | undefined;
}

export function getPostgresConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.NEON_DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    undefined
  );
}

export function getActiveDialect(): DbDialect {
  return getPostgresConnectionString() ? 'postgres' : 'sqlite';
}

async function getPgPool(): Promise<PgPoolType> {
  if (!globalThis._posPgPool) {
    const pgModule = await import('pg');
    const Pool = pgModule.Pool ?? pgModule.default?.Pool;
    const types = pgModule.types ?? pgModule.default?.types;

    // Parse PostgreSQL int8 (OID 20: BIGINT, SUM, COUNT) as JS integers
    if (types?.setTypeParser) {
      types.setTypeParser(20, (val: string) => parseInt(val, 10));
    }

    const connectionString = getPostgresConnectionString()!;
    const isLocal =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('sslmode=disable');

    globalThis._posPgPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });

    globalThis._posPgPool.on('error', (err: Error) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }
  return globalThis._posPgPool;
}

async function getSqliteDb(): Promise<any> {
  if (process.env.VERCEL) {
    throw new Error(
      'Database not configured: please add DATABASE_URL (your Neon or Supabase PostgreSQL connection string) in Vercel Project Settings -> Environment Variables, then redeploy.'
    );
  }
  if (!globalThis._posSqliteDb) {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    const dbPath = path.resolve(process.cwd(), 'pos_ledger.db');
    const instance = new Database(dbPath);
    instance.pragma('foreign_keys = ON');
    instance.pragma('journal_mode = WAL');
    instance.pragma('busy_timeout = 5000');
    globalThis._posSqliteDb = instance;
  }
  return globalThis._posSqliteDb;
}

function createPgExecutor(queryable: Pick<PoolClient, 'query'>): DbExecutor {
  return {
    dialect: 'postgres',
    async get<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | undefined> {
      const res = await queryable.query(toPgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async all<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
      const res = await queryable.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async run(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
      const res = await queryable.query(toPgPlaceholders(sql), params);
      return { rowCount: res.rowCount ?? 0 };
    },
    async insertAndGetId(sql: string, params: any[] = []): Promise<number> {
      const hasReturning = /\bRETURNING\b/i.test(sql);
      const finalSql = hasReturning ? sql : `${sql.trim().replace(/;$/, '')} RETURNING id`;
      const res = await queryable.query(toPgPlaceholders(finalSql), params);
      return Number(res.rows[0]?.id);
    },
    async exec(sql: string): Promise<void> {
      await queryable.query(sql);
    },
  };
}

function createSqliteExecutor(sqlite: any): DbExecutor {
  return {
    dialect: 'sqlite',
    async get<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | undefined> {
      return sqlite.prepare(sql).get(...params) as T | undefined;
    },
    async all<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
      const res = sqlite.prepare(sql).run(...params);
      return { rowCount: Number(res.changes ?? 0) };
    },
    async insertAndGetId(sql: string, params: any[] = []): Promise<number> {
      const res = sqlite.prepare(sql).run(...params);
      return Number(res.lastInsertRowid);
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    },
  };
}

let sqliteTxMutex: Promise<unknown> = Promise.resolve();

export async function getDb(): Promise<DbExecutor> {
  if (getActiveDialect() === 'postgres') {
    const pool = await getPgPool();
    return createPgExecutor(pool);
  }
  const sqlite = await getSqliteDb();
  return createSqliteExecutor(sqlite);
}

export async function runInTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if (getActiveDialect() === 'postgres') {
    const pool = await getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = createPgExecutor(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('PostgreSQL rollback error:', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  const sqlite = await getSqliteDb();
  const tx = createSqliteExecutor(sqlite);

  const runSerialized = sqliteTxMutex.then(async () => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(tx);
      sqlite.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('SQLite rollback error:', rollbackErr);
      }
      throw err;
    }
  });

  sqliteTxMutex = runSerialized.catch(() => {});
  return runSerialized;
}

export async function initSchema(executor?: DbExecutor): Promise<void> {
  const db = executor ?? (await getDb());
  if (db.dialect === 'postgres') {
    await db.exec(PG_SCHEMA_SQL);
  } else {
    await db.exec(SQLITE_SCHEMA_SQL);
  }
}

export async function syncPostgresSequences(executor: DbExecutor): Promise<void> {
  if (executor.dialect !== 'postgres') return;
  const tables = [
    'wallets',
    'services',
    'transactions',
    'transaction_payments',
    'wallet_ledger',
    'wallet_transfers',
    'refund_categories',
    'expenses',
    'balance_adjustments',
    'transaction_audit_logs',
    'refund_obligations',
  ];
  for (const table of tables) {
    await executor.exec(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}));`
    );
  }
}
