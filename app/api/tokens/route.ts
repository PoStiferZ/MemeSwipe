import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { fetchManyEnriched } from "@/lib/sources/dexscreener";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard quality bar — anything below this 24h volume is hidden from the swipe deck.
const MIN_VOLUME_24H = 10_000;
// Any token whose last DexScreener snapshot is older than this is re-fetched
// before we serve it. 30s is the same staleness window we use for liked-list
// refreshes; short enough that mcap/volume can't drift far, long enough that
// a flurry of consecutive page-loads doesn't re-hit DexScreener pointlessly.
const STALE_MS = 30_000;
// Pull 2× q.limit rows from SQL so the post-refresh filter has room to
// drop a few tokens (whose mcap/volume moved out of range) without
// leaving the deck with <30 cards. Anything below q.limit after filtering
// is backfilled by the deck's auto-prefetch in SwipeView.
const OVERFETCH_FACTOR = 2;

const QuerySchema = z.object({
  minMcap: z.coerce.number().nonnegative().optional(),
  maxMcap: z.coerce.number().nonnegative().optional(),
  minHolders: z.coerce.number().int().nonnegative().optional(),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(), // alternative to cursor
  limit: z.coerce.number().int().min(1).max(100).default(30),
  excludeWallet: z.string().optional(),
  sort: z.enum(["asc", "desc"]).default("desc"),
});

type Query = z.infer<typeof QuerySchema>;
type TokenRow = typeof schema.tokens.$inferSelect;

async function refreshStaleRows(rows: TokenRow[], now: Date): Promise<TokenRow[]> {
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

function passesNumericFilters(r: TokenRow, q: Query): boolean {
  const num = (v: string | null) => (v == null ? null : Number(v));
  const mcap = num(r.mcapUsd);
  const vol = num(r.volume24h);
  // Re-apply the volume floor on fresh values — a token that had vol=12k in
  // the DB might be down to 2k now.
  if (vol != null && vol < MIN_VOLUME_24H) return false;
  if (q.minMcap != null && (mcap == null || mcap < q.minMcap)) return false;
  if (q.maxMcap != null && mcap != null && mcap > q.maxMcap) return false;
  if (
    q.minHolders != null &&
    (r.holdersCount == null || r.holdersCount < q.minHolders)
  )
    return false;
  return true;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const q = parsed.data;

  const baseConditions = [
    sql`(${schema.tokens.volume24h} IS NULL OR ${schema.tokens.volume24h} >= ${MIN_VOLUME_24H})`,
  ];
  if (q.minMcap != null)
    baseConditions.push(sql`${schema.tokens.mcapUsd} >= ${q.minMcap}`);
  if (q.maxMcap != null)
    baseConditions.push(sql`${schema.tokens.mcapUsd} <= ${q.maxMcap}`);
  if (q.minHolders != null)
    baseConditions.push(sql`${schema.tokens.holdersCount} >= ${q.minHolders}`);
  if (q.since != null)
    baseConditions.push(
      sql`${schema.tokens.migratedAt} >= ${new Date(q.since * 1000)}`,
    );
  if (q.until != null)
    baseConditions.push(
      sql`${schema.tokens.migratedAt} <= ${new Date(q.until * 1000)}`,
    );
  if (q.excludeWallet) {
    baseConditions.push(
      sql`not exists (select 1 from ${schema.swipes} s where s.mint = ${schema.tokens.mint} and s.wallet = ${q.excludeWallet})`,
    );
  }

  const orderBy =
    q.sort === "asc"
      ? asc(schema.tokens.migratedAt)
      : desc(schema.tokens.migratedAt);

  const now = new Date();

  // ─────────────────────────────────────────────────────────────────────
  // Page-mode (list view): single SQL + refresh + filter. We don't loop
  // because page-based pagination assumes a stable offset — overfetching
  // would shift what "page 2" means.
  // ─────────────────────────────────────────────────────────────────────
  if (q.page != null) {
    const offset = (q.page - 1) * q.limit;
    const rows = await db
      .select()
      .from(schema.tokens)
      .where(and(...baseConditions))
      .orderBy(orderBy)
      .limit(q.limit)
      .offset(offset);

    const [{ count: totalRemaining = 0 } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.tokens)
      .where(and(...baseConditions));

    const refreshed = await refreshStaleRows(rows, now);
    const filtered = refreshed.filter((r) => passesNumericFilters(r, q));

    return NextResponse.json({
      tokens: filtered,
      nextCursor: null,
      totalRemaining,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Cursor-mode (swipe deck). Behavior mirrors page-mode: a single SQL
  // pull (with a small overfetch buffer so the post-refresh filter has
  // room to drop a few rows), then DexScreener-refresh + numeric filter
  // re-application. The deck's existing auto-prefetch hook in SwipeView
  // pulls the next batch when the visible count gets low, so we don't
  // need a server-side loop to "guarantee 30 fresh per response" — that
  // loop turned out to be brittle (one bad iteration starved the whole
  // deck) for negligible UX gain over auto-prefetch.
  // ─────────────────────────────────────────────────────────────────────
  const conditions = [...baseConditions];
  if (q.cursor) {
    const cursorDate = new Date(q.cursor);
    conditions.push(
      q.sort === "asc"
        ? sql`${schema.tokens.migratedAt} > ${cursorDate}`
        : sql`${schema.tokens.migratedAt} < ${cursorDate}`,
    );
  }

  const fetchLimit = q.limit * OVERFETCH_FACTOR;
  const fetched = await db
    .select()
    .from(schema.tokens)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(fetchLimit);

  const refreshed = await refreshStaleRows(fetched, now);
  const filtered = refreshed.filter((r) => passesNumericFilters(r, q));
  const final = filtered.slice(0, q.limit);

  // `nextCursor` advances from the last row we **read** from the DB, not
  // the last row we returned — otherwise a request that filtered most
  // rows out would leave a gap. If we read fewer than the fetch limit,
  // the DB is exhausted for this filter set → no more pages.
  const nextCursor =
    fetched.length < fetchLimit
      ? null
      : (fetched[fetched.length - 1].migratedAt?.toISOString() ?? null);

  const [{ count: totalRemaining = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(and(...baseConditions));

  return NextResponse.json({
    tokens: final,
    nextCursor,
    totalRemaining,
  });
}
