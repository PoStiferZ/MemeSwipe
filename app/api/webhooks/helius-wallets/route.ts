import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchManyEnriched } from "@/lib/sources/dexscreener";
import {
  extractTradesFromSwap,
  type HeliusSwapEvent,
} from "@/lib/sources/helius-swap";
import { getTrackedWalletsSet } from "@/lib/helius/manage-webhook";
import { sendWalletTradeAlert } from "@/lib/notifications/telegram";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Helius Enhanced Webhook receiver for the "tracking" feature. Receives
 * SWAP events for the wallets the user follows, normalizes them into
 * `wallet_trades` rows, and fires a Telegram alert per *new* trade.
 *
 * Dedup is enforced at INSERT time via the (signature, wallet) unique
 * index — Helius retries and duplicate inner-events both collapse to
 * a single row + a single alert.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== process.env.HELIUS_WEBHOOK_AUTH_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const events = (Array.isArray(raw) ? raw : []) as HeliusSwapEvent[];

  if (events.length === 0) {
    return NextResponse.json({ events: 0, trades: 0 });
  }

  const tracked = await getTrackedWalletsSet();
  if (tracked.size === 0) {
    // Webhook is registered but no addresses to watch — drop everything.
    return NextResponse.json({ events: events.length, trades: 0 });
  }

  // Extract every trade tuple touching a tracked wallet.
  const extracted = events.flatMap((e) => extractTradesFromSwap(e, tracked));
  if (extracted.length === 0) {
    return NextResponse.json({ events: events.length, trades: 0 });
  }

  // Bulk price lookup: prefer the value we already have in `tokens`,
  // fall back to a DexScreener batch call for mints we've never seen
  // (this catches non-Pump tokens the wallet might trade).
  const mints = Array.from(new Set(extracted.map((t) => t.mint)));
  const cachedRows = await db
    .select({
      mint: schema.tokens.mint,
      priceUsd: schema.tokens.priceUsd,
      ticker: schema.tokens.ticker,
      name: schema.tokens.name,
      imageUrl: schema.tokens.imageUrl,
    })
    .from(schema.tokens)
    .where(inArray(schema.tokens.mint, mints));
  const cached = new Map(cachedRows.map((r) => [r.mint, r]));

  const missingMints = mints.filter((m) => !cached.get(m)?.priceUsd);
  let fetched: Awaited<ReturnType<typeof fetchManyEnriched>> | null = null;
  if (missingMints.length > 0) {
    try {
      fetched = await fetchManyEnriched(missingMints);
    } catch {
      fetched = null;
    }
  }

  let inserted = 0;
  for (const trade of extracted) {
    const cachedRow = cached.get(trade.mint);
    const priceUsd =
      cachedRow?.priceUsd != null
        ? Number(cachedRow.priceUsd)
        : (fetched?.get(trade.mint)?.priceUsd ?? null);
    const usdValue =
      trade.tokenAmount != null && priceUsd != null
        ? trade.tokenAmount * priceUsd
        : null;

    // Use Drizzle's typed insert so Date / number / null coercion to
    // timestamptz / numeric goes through the proper serializers — the
    // raw `sql\`\`` path crashes on `Date` (postgres-js wants a string).
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
        usdValue: usdValue != null ? usdValue.toFixed(2) : null,
        priceUsd: priceUsd != null ? String(priceUsd) : null,
        blockTime: trade.blockTime,
        slot: trade.slot,
      })
      .onConflictDoNothing({
        target: [schema.walletTrades.signature, schema.walletTrades.wallet],
      })
      .returning({ id: schema.walletTrades.id });

    if (result.length === 0) continue; // dup — already alerted
    inserted++;

    // Fire-and-forget Telegram alert with whatever token metadata we
    // have. We pull the user-defined `label` for the wallet so the
    // notification can say "Whale-A bought $TICKER" instead of just
    // a truncated address.
    const labels = await db
      .selectDistinct({ label: schema.trackedWallets.label })
      .from(schema.trackedWallets)
      .where(eq(schema.trackedWallets.trackedWallet, trade.wallet))
      .limit(1);
    const label = labels[0]?.label ?? null;

    void sendWalletTradeAlert({
      wallet: trade.wallet,
      label,
      direction: trade.direction,
      mint: trade.mint,
      ticker: cachedRow?.ticker ?? null,
      name: cachedRow?.name ?? null,
      imageUrl: cachedRow?.imageUrl ?? null,
      tokenAmount: trade.tokenAmount,
      solAmount: trade.solAmount,
      usdValue,
      dexSource: trade.dexSource,
      signature: trade.signature,
      poolAddress: null,
    }).catch((err) => console.warn("[telegram] wallet alert failed", err));
  }

  console.log(
    `[wallets-webhook] events=${events.length} extracted=${extracted.length} inserted=${inserted}`,
  );
  return NextResponse.json({
    events: events.length,
    extracted: extracted.length,
    trades: inserted,
  });
}
