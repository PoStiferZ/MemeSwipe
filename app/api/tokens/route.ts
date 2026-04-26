import { NextRequest, NextResponse } from "next/server";
import { and, desc, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 60_000;
const REFRESH_CONCURRENCY = 6;

const QuerySchema = z.object({
  minMcap: z.coerce.number().nonnegative().optional(),
  maxMcap: z.coerce.number().nonnegative().optional(),
  minHolders: z.coerce.number().int().nonnegative().optional(),
  since: z.coerce.number().int().optional(), // unix seconds
  until: z.coerce.number().int().optional(),
  cursor: z.string().optional(), // ISO timestamp of last `migratedAt`
  limit: z.coerce.number().int().min(1).max(100).default(15),
  excludeWallet: z.string().optional(),
});

type TokenRow = typeof schema.tokens.$inferSelect;

async function refreshIfStale(row: TokenRow, now: Date): Promise<TokenRow> {
  const last = row.lastSnapshotAt?.getTime() ?? 0;
  if (now.getTime() - last < STALE_MS) return row;

  try {
    const dex = await fetchEnriched(row.mint);
    if (dex.priceUsd == null) return row;

    const oldAth = Number(row.athUsd ?? 0);
    const newAth = Math.max(oldAth, dex.priceUsd);
    const athAt = newAth > oldAth ? now : row.athAt;

    const patch = {
      priceUsd: String(dex.priceUsd),
      mcapUsd: dex.mcapUsd != null ? String(dex.mcapUsd) : null,
      fdvUsd: dex.fdvUsd != null ? String(dex.fdvUsd) : null,
      liquidityUsd: dex.liquidityUsd != null ? String(dex.liquidityUsd) : null,
      volume24h: dex.volume24h != null ? String(dex.volume24h) : null,
      change2h: dex.change2h != null ? String(dex.change2h) : null,
      change6h: dex.change6h != null ? String(dex.change6h) : null,
      change24h: dex.change24h != null ? String(dex.change24h) : null,
      athUsd: String(newAth),
      athAt,
      lastSnapshotAt: now,
    };

    await db
      .update(schema.tokens)
      .set(patch)
      .where(sql`${schema.tokens.mint} = ${row.mint}`);

    await db.insert(schema.priceSnapshots).values({
      mint: row.mint,
      priceUsd: patch.priceUsd,
      mcapUsd: patch.mcapUsd,
      liquidityUsd: patch.liquidityUsd,
      volume24h: patch.volume24h,
    });

    return { ...row, ...patch };
  } catch {
    return row;
  }
}

async function refreshAll(rows: TokenRow[]): Promise<TokenRow[]> {
  const now = new Date();
  const out: TokenRow[] = new Array(rows.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: REFRESH_CONCURRENCY }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= rows.length) return;
        out[i] = await refreshIfStale(rows[i], now);
      }
    }),
  );
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const q = parsed.data;

  const conditions = [];
  if (q.minMcap != null)
    conditions.push(gte(schema.tokens.mcapUsd, String(q.minMcap)));
  if (q.maxMcap != null)
    conditions.push(sql`${schema.tokens.mcapUsd} <= ${String(q.maxMcap)}`);
  if (q.minHolders != null)
    conditions.push(gte(schema.tokens.holdersCount, q.minHolders));
  if (q.since != null)
    conditions.push(gte(schema.tokens.migratedAt, new Date(q.since * 1000)));
  if (q.until != null)
    conditions.push(sql`${schema.tokens.migratedAt} <= ${new Date(q.until * 1000)}`);
  if (q.cursor) conditions.push(lt(schema.tokens.migratedAt, new Date(q.cursor)));

  // Exclude tokens already swiped by the wallet.
  if (q.excludeWallet) {
    conditions.push(
      sql`not exists (select 1 from ${schema.swipes} s where s.mint = ${schema.tokens.mint} and s.wallet = ${q.excludeWallet})`,
    );
  }

  const rows = await db
    .select()
    .from(schema.tokens)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.tokens.migratedAt))
    .limit(q.limit);

  const refreshed = await refreshAll(rows);

  const nextCursor =
    refreshed.length === q.limit
      ? refreshed[refreshed.length - 1].migratedAt?.toISOString()
      : null;

  return NextResponse.json({ tokens: refreshed, nextCursor });
}
