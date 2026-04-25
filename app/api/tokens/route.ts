import { NextRequest, NextResponse } from "next/server";
import { and, desc, gt, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  minMcap: z.coerce.number().nonnegative().optional(),
  maxMcap: z.coerce.number().nonnegative().optional(),
  minHolders: z.coerce.number().int().nonnegative().optional(),
  since: z.coerce.number().int().optional(), // unix seconds
  until: z.coerce.number().int().optional(),
  cursor: z.string().optional(), // ISO timestamp of last `migratedAt`
  limit: z.coerce.number().int().min(1).max(100).default(30),
  excludeWallet: z.string().optional(),
});

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

  const nextCursor =
    rows.length === q.limit ? rows[rows.length - 1].migratedAt?.toISOString() : null;

  return NextResponse.json({ tokens: rows, nextCursor });
}
