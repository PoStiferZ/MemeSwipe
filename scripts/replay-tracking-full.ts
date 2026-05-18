/**
 * Reproduce the full webhook pipeline locally for one Crissy SWAP:
 * parse + getTrackedWalletsSet + INSERT. If this succeeds locally but
 * doesn't fire on prod, the issue is auth header or Vercel routing.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../lib/db/client";
import {
  extractTradesFromSwap,
  type HeliusSwapEvent,
} from "../lib/sources/helius-swap";
import { getTrackedWalletsSet } from "../lib/helius/manage-webhook";

const CRISSY = "7FJDJ1HaQfL3GAcMCzoBrJ9Accnf5GUYYwfEPCBCDcVK";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY!;
  const res = await fetch(
    `https://api.helius.xyz/v0/addresses/${CRISSY}/transactions?api-key=${apiKey}&type=SWAP&limit=1`,
  );
  const txs = (await res.json()) as HeliusSwapEvent[];
  if (txs.length === 0) {
    console.error("no tx returned");
    process.exit(1);
  }
  const tx = txs[0];
  console.log("tx sig:", tx.signature);

  const tracked = await getTrackedWalletsSet();
  console.log(`tracked set size: ${tracked.size}`);
  console.log(`has CRISSY? ${tracked.has(CRISSY)}`);

  const trades = extractTradesFromSwap(tx, tracked);
  console.log(`extracted: ${trades.length}`);
  if (trades.length === 0) return;

  for (const trade of trades) {
    console.log("INSERTing:", {
      sig: trade.signature.slice(0, 12),
      wallet: trade.wallet.slice(0, 6),
      direction: trade.direction,
      mint: trade.mint.slice(0, 6),
      blockTime: trade.blockTime,
    });
    try {
      const result = await db
        .insert(schema.walletTrades)
        .values({
          signature: trade.signature,
          wallet: trade.wallet,
          direction: trade.direction,
          mint: trade.mint,
          dexSource: trade.dexSource,
          tokenAmount: trade.tokenAmount != null ? String(trade.tokenAmount) : null,
          solAmount: trade.solAmount != null ? String(trade.solAmount) : null,
          usdValue: null,
          priceUsd: null,
          blockTime: trade.blockTime,
          slot: trade.slot,
        })
        .onConflictDoNothing({
          target: [schema.walletTrades.signature, schema.walletTrades.wallet],
        })
        .returning({ id: schema.walletTrades.id });
      console.log("  → inserted rows:", result.length);
    } catch (err) {
      console.error("  → INSERT failed:", err);
    }
  }

  // Cleanup so we don't pollute the table during debug
  console.log("\nCleaning up test rows…");
  const del = await db.execute(sql`
    DELETE FROM ${schema.walletTrades}
    WHERE wallet = ${CRISSY} AND signature = ${tx.signature ?? ""}
    RETURNING id
  `);
  console.log("deleted:", del.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
