import { NextRequest, NextResponse } from "next/server";
import { and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { fetchManyEnriched } from "@/lib/sources/dexscreener";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 30_000;
// Hard quality bar — anything below this 24h volume is hidden from the swipe deck.
const MIN_VOLUME_24H = 10_000;

const QuerySchema = z.object({
  minMcap: z.coerce.number().nonnegative().optional(),
  maxMcap: z.coerce.number().nonnegative().optional(),
  minHolders: z.coerce.number().int().nonnegative().optional(),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  excludeWallet: z.string().optional(),
});

type TokenRow = typeof schema.tokens.$inferSelect;

async function refreshStaleBatch(rows: TokenRow[]): Promise<TokenRow[]> {
  const now = new Date();
  const stale = rows.filter(
    (r) => now.getTime() - (r.lastSnapshotAt?.getTime() ?? 0) >= STALE_MS,
  );
  if (stale.length === 0) return rows;

  let dexMap;
  try {
    dexMap = await fetchManyEnriched(stale.map((r) => r.mint));
  } catch {
    return rows;
  }

  const updated = new Map<string, TokenRow>();
  await Promise.all(
    stale.map(async (row) => {
      const dex = dexMap.get(row.mint);
      if (!dex) return;
      const next = await applyDexPatch(row, dex, now);
      if (next !== row) updated.set(row.mint, next);
    }),
  );

  return rows.map((r) => updated.get(r.mint) ?? r);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const q = parsed.data;

  const conditions = [
    // Always exclude low-quality tokens from the swipe deck.
    sql`${schema.tokens.volume24h} >= ${MIN_VOLUME_24H}`,
  ];

  // Numeric columns are stored as DECIMAL — use sql templates so the params
  // bind as numerics, not as text (which would alphabetically compare).
  if (q.minMcap != null)
    conditions.push(sql`${schema.tokens.mcapUsd} >= ${q.minMcap}`);
  if (q.maxMcap != null)
    conditions.push(sql`${schema.tokens.mcapUsd} <= ${q.maxMcap}`);
  if (q.minHolders != null)
    conditions.push(sql`${schema.tokens.holdersCount} >= ${q.minHolders}`);
  if (q.since != null)
    conditions.push(
      sql`${schema.tokens.migratedAt} >= ${new Date(q.since * 1000)}`,
    );
  if (q.until != null)
    conditions.push(
      sql`${schema.tokens.migratedAt} <= ${new Date(q.until * 1000)}`,
    );
  if (q.cursor)
    conditions.push(sql`${schema.tokens.migratedAt} < ${new Date(q.cursor)}`);

  if (q.excludeWallet) {
    conditions.push(
      sql`not exists (select 1 from ${schema.swipes} s where s.mint = ${schema.tokens.mint} and s.wallet = ${q.excludeWallet})`,
    );
  }

  const where = and(...conditions);

  const rows = await db
    .select()
    .from(schema.tokens)
    .where(where)
    .orderBy(desc(schema.tokens.migratedAt))
    .limit(q.limit);

  const [{ count: totalRemaining = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(where);

  const refreshed = await refreshStaleBatch(rows);

  const nextCursor =
    refreshed.length === q.limit
      ? refreshed[refreshed.length - 1].migratedAt?.toISOString()
      : null;

  return NextResponse.json({
    tokens: refreshed,
    nextCursor,
    totalRemaining,
  });
}
