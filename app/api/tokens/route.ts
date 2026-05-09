import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard quality bar — anything below this 24h volume is hidden from the swipe deck.
const MIN_VOLUME_24H = 10_000;

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const q = parsed.data;

  const conditions = [
    // Hide tokens whose 24h volume is *known* to be below the floor.
    // NULL means "not measured yet" (just migrated, DexScreener hasn't indexed
    // yet) — we keep those so they get a chance once they're refreshed.
    sql`(${schema.tokens.volume24h} IS NULL OR ${schema.tokens.volume24h} >= ${MIN_VOLUME_24H})`,
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
  if (q.cursor) {
    // Cursor direction must match sort direction so pagination doesn't loop.
    conditions.push(
      q.sort === "asc"
        ? sql`${schema.tokens.migratedAt} > ${new Date(q.cursor)}`
        : sql`${schema.tokens.migratedAt} < ${new Date(q.cursor)}`,
    );
  }

  if (q.excludeWallet) {
    conditions.push(
      sql`not exists (select 1 from ${schema.swipes} s where s.mint = ${schema.tokens.mint} and s.wallet = ${q.excludeWallet})`,
    );
  }

  const where = and(...conditions);

  const offset = q.page ? (q.page - 1) * q.limit : 0;
  const rows = await db
    .select()
    .from(schema.tokens)
    .where(where)
    .orderBy(
      q.sort === "asc"
        ? asc(schema.tokens.migratedAt)
        : desc(schema.tokens.migratedAt),
    )
    .limit(q.limit)
    .offset(offset);

  const [{ count: totalRemaining = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(where);

  // The bulk DexScreener refresh used to live here, blocking the response
  // by 1–3 seconds and adding noticeable lag whenever the user reloaded the
  // swipe page. The active card already gets a fresh quote via
  // /api/tokens/[mint] when it surfaces in the deck, so we ditch the
  // blocking pass and serve straight from SQL.
  const nextCursor =
    rows.length === q.limit
      ? rows[rows.length - 1].migratedAt?.toISOString()
      : null;

  return NextResponse.json({
    tokens: rows,
    nextCursor,
    totalRemaining,
  });
}
