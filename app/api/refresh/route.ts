import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { findMigrationsSince } from "@/lib/indexer/detectMigrations";
import { backfillSlowFields, buildTokenRow, upsertToken } from "@/lib/indexer/enrichToken";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Triggered by the header "Refresh" button. Scans PumpSwap signatures since
 * the most recent token in DB (or 30 min ago if empty) and returns the count
 * of newly migrated tokens.
 */
export async function POST() {
  const [latest] = await db
    .select({ migratedAt: schema.tokens.migratedAt })
    .from(schema.tokens)
    .orderBy(sql`${schema.tokens.migratedAt} desc`)
    .limit(1);

  const fallbackTs = Math.floor(Date.now() / 1000) - 30 * 60;
  const sinceTs = latest?.migratedAt
    ? Math.floor(latest.migratedAt.getTime() / 1000)
    : fallbackTs;

  const migrations = await findMigrationsSince(sinceTs);
  const newTokens: { mint: string; ticker: string | null; name: string | null }[] = [];

  for (const m of migrations) {
    try {
      const row = await buildTokenRow(m);
      await upsertToken(row);
      newTokens.push({ mint: row.mint, ticker: row.ticker ?? null, name: row.name ?? null });
    } catch {
      // skip bad row, continue
    }
  }

  // Fire-and-forget the slow fields fill.
  void Promise.all(
    newTokens.map((t) =>
      backfillSlowFields(t.mint).catch(() => undefined),
    ),
  );

  return NextResponse.json({
    newCount: newTokens.length,
    newTokens: newTokens.slice(0, 20),
  });
}
