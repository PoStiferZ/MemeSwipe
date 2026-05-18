import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  wallet: z.string().min(32).max(44), // owner
  cursor: z.string().optional(), // ISO timestamp
  limit: z.coerce.number().int().min(1).max(100).default(50),
  direction: z.enum(["buy", "sell"]).optional(),
  filterWallet: z.string().min(32).max(44).optional(),
});

/**
 * Trades feed for the Tracking tab. Joins `wallet_trades` to
 * `tracked_wallets` so the owner only sees trades of wallets they
 * actually follow. LEFT JOINs `tokens` so the UI can render
 * ticker/image without an extra round-trip.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const q = parsed.data;

  const conditions = [eq(schema.trackedWallets.ownerWallet, q.wallet)];
  if (q.direction)
    conditions.push(eq(schema.walletTrades.direction, q.direction));
  if (q.filterWallet)
    conditions.push(eq(schema.walletTrades.wallet, q.filterWallet));
  if (q.cursor)
    conditions.push(
      sql`${schema.walletTrades.blockTime} < ${new Date(q.cursor)}`,
    );

  const rows = await db
    .select({
      id: schema.walletTrades.id,
      signature: schema.walletTrades.signature,
      wallet: schema.walletTrades.wallet,
      direction: schema.walletTrades.direction,
      mint: schema.walletTrades.mint,
      dexSource: schema.walletTrades.dexSource,
      tokenAmount: schema.walletTrades.tokenAmount,
      solAmount: schema.walletTrades.solAmount,
      usdValue: schema.walletTrades.usdValue,
      priceUsd: schema.walletTrades.priceUsd,
      blockTime: schema.walletTrades.blockTime,
      label: schema.trackedWallets.label,
      ticker: schema.tokens.ticker,
      name: schema.tokens.name,
      imageUrl: schema.tokens.imageUrl,
      poolAddress: schema.tokens.poolAddress,
    })
    .from(schema.walletTrades)
    .innerJoin(
      schema.trackedWallets,
      eq(schema.walletTrades.wallet, schema.trackedWallets.trackedWallet),
    )
    .leftJoin(schema.tokens, eq(schema.walletTrades.mint, schema.tokens.mint))
    .where(and(...conditions))
    .orderBy(desc(schema.walletTrades.blockTime))
    .limit(q.limit);

  const nextCursor =
    rows.length === q.limit
      ? rows[rows.length - 1].blockTime?.toISOString()
      : null;

  return NextResponse.json({ trades: rows, nextCursor });
}
