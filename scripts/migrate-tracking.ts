/**
 * Creates the `tracked_wallets` and `wallet_trades` tables for the
 * Tracking feature. Idempotent — safe to run multiple times.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/migrate-tracking.ts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_wallets (
      id              bigserial PRIMARY KEY,
      owner_wallet    text NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
      tracked_wallet  text NOT NULL,
      label           text,
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tracked_wallets_owner_tracked_uq
      ON tracked_wallets (owner_wallet, tracked_wallet)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS tracked_wallets_tracked_idx
      ON tracked_wallets (tracked_wallet)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wallet_trades (
      id            bigserial PRIMARY KEY,
      signature     text NOT NULL,
      wallet        text NOT NULL,
      direction     text NOT NULL,
      mint          text NOT NULL,
      dex_source    text,
      token_amount  numeric(30, 9),
      sol_amount    numeric(20, 9),
      usd_value     numeric(20, 2),
      price_usd     numeric(30, 12),
      block_time    timestamptz NOT NULL,
      slot          integer,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_trades_sig_wallet_uq
      ON wallet_trades (signature, wallet)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS wallet_trades_wallet_time_idx
      ON wallet_trades (wallet, block_time)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS wallet_trades_mint_idx
      ON wallet_trades (mint)
  `;

  console.log("[migrate-tracking] tables + indexes ensured");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
