import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
  bigserial,
} from "drizzle-orm/pg-core";

export const swipeAction = pgEnum("swipe_action", ["like", "dislike"]);

export const users = pgTable("users", {
  wallet: text("wallet").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tokens = pgTable(
  "tokens",
  {
    mint: text("mint").primaryKey(),
    ticker: text("ticker"),
    name: text("name"),
    description: text("description"),
    imageUrl: text("image_url"),

    createdAt: timestamp("created_at", { withTimezone: true }),
    migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull(),
    migrationSignature: text("migration_signature"),
    poolAddress: text("pool_address"),
    metadataUri: text("metadata_uri"),

    socials: jsonb("socials").$type<{
      twitter?: string;
      telegram?: string;
      website?: string;
      discord?: string;
    }>(),

    holdersCount: integer("holders_count"),
    holdersUpdatedAt: timestamp("holders_updated_at", { withTimezone: true }),

    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
    mcapUsd: numeric("mcap_usd", { precision: 20, scale: 2 }),
    fdvUsd: numeric("fdv_usd", { precision: 20, scale: 2 }),
    liquidityUsd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
    volume24h: numeric("volume_24h", { precision: 20, scale: 2 }),
    change2h: numeric("change_2h", { precision: 10, scale: 4 }),
    change6h: numeric("change_6h", { precision: 10, scale: 4 }),
    change24h: numeric("change_24h", { precision: 10, scale: 4 }),

    athUsd: numeric("ath_usd", { precision: 30, scale: 12 }),
    athMcapUsd: numeric("ath_mcap_usd", { precision: 20, scale: 2 }),
    athAt: timestamp("ath_at", { withTimezone: true }),

    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    // Set the first time we push a Telegram alert for this mint. Used as
    // an atomic "claim" — only the request that flips this from NULL to
    // a timestamp gets to send the alert, so duplicate webhook fires
    // never produce duplicate messages.
    telegramAlertedAt: timestamp("telegram_alerted_at", { withTimezone: true }),
  },
  (t) => ({
    migratedIdx: index("tokens_migrated_at_idx").on(t.migratedAt),
    mcapIdx: index("tokens_mcap_idx").on(t.mcapUsd),
    holdersIdx: index("tokens_holders_idx").on(t.holdersCount),
  }),
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
    mcapUsd: numeric("mcap_usd", { precision: 20, scale: 2 }),
    liquidityUsd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
    volume24h: numeric("volume_24h", { precision: 20, scale: 2 }),
  },
  (t) => ({
    mintTsIdx: index("price_snapshots_mint_ts_idx").on(t.mint, t.ts),
  }),
);

export const swipes = pgTable(
  "swipes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallet: text("wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    action: swipeAction("action").notNull(),
    // Snapshot of the token's market cap at the moment the user swiped, so
    // they can compare entry mcap to current mcap in the Liked view.
    mcapAtSwipeUsd: numeric("mcap_at_swipe_usd", { precision: 20, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    walletMintUq: uniqueIndex("swipes_wallet_mint_uq").on(t.wallet, t.mint),
    walletIdx: index("swipes_wallet_idx").on(t.wallet),
  }),
);

/**
 * Wallets the user wants to follow in the Tracking tab. Each row is the
 * "I want to watch X" intent. Scoped per `owner_wallet` (the app user),
 * the same way `swipes` is scoped — so two users can independently track
 * the same address without interfering.
 */
export const trackedWallets = pgTable(
  "tracked_wallets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerWallet: text("owner_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    trackedWallet: text("tracked_wallet").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerTrackedUq: uniqueIndex("tracked_wallets_owner_tracked_uq").on(
      t.ownerWallet,
      t.trackedWallet,
    ),
    trackedIdx: index("tracked_wallets_tracked_idx").on(t.trackedWallet),
  }),
);

/**
 * Trades detected via the SWAP Helius webhook for any tracked wallet.
 * Stored globally (one row per (signature, wallet) couple) — multiple
 * owners watching the same wallet share the same rows; the read-side
 * joins back through `tracked_wallets` to filter per owner.
 */
export const walletTrades = pgTable(
  "wallet_trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    signature: text("signature").notNull(),
    wallet: text("wallet").notNull(),
    direction: text("direction").notNull(), // "buy" | "sell"
    mint: text("mint").notNull(),
    dexSource: text("dex_source"), // "PUMP_FUN" | "JUPITER" | ...
    tokenAmount: numeric("token_amount", { precision: 30, scale: 9 }),
    solAmount: numeric("sol_amount", { precision: 20, scale: 9 }),
    usdValue: numeric("usd_value", { precision: 20, scale: 2 }),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    slot: integer("slot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sigWalletUq: uniqueIndex("wallet_trades_sig_wallet_uq").on(
      t.signature,
      t.wallet,
    ),
    walletTimeIdx: index("wallet_trades_wallet_time_idx").on(
      t.wallet,
      t.blockTime,
    ),
    mintIdx: index("wallet_trades_mint_idx").on(t.mint),
  }),
);

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type Swipe = typeof swipes.$inferSelect;
export type TrackedWallet = typeof trackedWallets.$inferSelect;
export type WalletTrade = typeof walletTrades.$inferSelect;

export const _ensureSqlImport = sql;
