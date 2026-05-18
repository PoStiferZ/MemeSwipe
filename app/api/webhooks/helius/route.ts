import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { detectFromWebhookEvent } from "@/lib/sources/pumpswap";
import {
  backfillSlowFields,
  buildTokenRow,
  retryImageInBackground,
  upsertToken,
} from "@/lib/indexer/enrichToken";
import { sendMigrationAlert } from "@/lib/notifications/telegram";

/**
 * Atomically claim the right to fire a Telegram alert for a mint.
 * Flips `telegram_alerted_at` from NULL → now() in a single SQL
 * statement and returns whether THIS request was the one that won
 * the flip. Subsequent webhook fires (Helius retries, duplicate
 * events in the same batch) get `false` and skip the alert.
 */
async function claimTelegramAlert(mint: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE ${schema.tokens}
    SET telegram_alerted_at = now()
    WHERE ${schema.tokens.mint} = ${mint}
      AND telegram_alerted_at IS NULL
    RETURNING mint
  `);
  // postgres-js returns a `RowList` (array-like); .length is the number of
  // rows that matched the UPDATE … WHERE … RETURNING clause.
  return result.length > 0;
}

// Strict liquidity gate: any migration with a *known* liquidity below
// this threshold is dropped before we even insert it. Tokens whose
// DexScreener pair isn't indexed yet (liquidity = null) pass through
// because we can't yet judge them — they'll either be filtered later by
// the user's deck filter or scored once the per-card refresh runs.
const MIN_LIQUIDITY_USD = 10_000;

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Helius "Enhanced Webhooks" POST events when our subscribed program produces
 * a transaction. Configure via scripts/register-webhook.ts.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== process.env.HELIUS_WEBHOOK_AUTH_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const events = (Array.isArray(raw) ? raw : []) as Array<{
    signature?: string;
    slot?: number;
    timestamp?: number;
    type?: string;
    source?: string;
    instructions?: { programId: string; accounts: string[]; data: string }[];
    innerInstructions?: { instructions: { programId: string; accounts: string[]; data: string }[] }[];
  }>;

  console.log("[webhook] received", {
    count: events.length,
    types: [...new Set(events.map((e) => e?.type ?? "?"))],
    sources: [...new Set(events.map((e) => e?.source ?? "?"))],
  });

  if (events.length > 0) {
    const sample = events[0];
    console.log("[webhook] first event signature:", sample.signature);
    console.log("[webhook] first event type/source:", sample.type, sample.source);
    console.log(
      "[webhook] first event programs (outer):",
      sample.instructions?.map((i) => i.programId) ?? [],
    );
    const innerNested = (sample.instructions ?? []).flatMap(
      (ix) =>
        (ix as unknown as { innerInstructions?: { programId: string }[] })
          .innerInstructions ?? [],
    );
    console.log(
      "[webhook] first event programs (inner-nested):",
      innerNested.map((i) => i.programId),
    );
    console.log(
      "[webhook] first event programs (inner-toplevel):",
      (sample.innerInstructions ?? []).flatMap((g) =>
        g.instructions.map((i) => i.programId),
      ),
    );
    // Full payload dump (truncated) for the very first event so we can inspect.
    console.log(
      "[webhook] FULL FIRST EVENT:",
      JSON.stringify(sample).slice(0, 4000),
    );
  }

  // Source gate: Helius emits CREATE_POOL for several Pump.fun-related
  // programs (PUMP_FUN = the bonding-curve migration we care about,
  // PUMP_AMM = subsequent pool-management events on PumpSwap). We only
  // want the first one — everything else is dropped before any DB write
  // or Telegram alert.
  const pumpFunEvents = events.filter((e) => e.source === "PUMP_FUN");
  const skipped = events.length - pumpFunEvents.length;
  if (skipped > 0) {
    console.log(
      `[webhook] skipped ${skipped} non-PUMP_FUN events`,
      [...new Set(events.filter((e) => e.source !== "PUMP_FUN").map((e) => e.source))],
    );
  }

  const detected = pumpFunEvents
    .map((e) => detectFromWebhookEvent(e))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  console.log("[webhook] detected migrations:", detected.length);

  for (const m of detected) {
    try {
      const row = await buildTokenRow(m);

      // Liquidity gate. `row.liquidityUsd` is a decimal-as-string (or null).
      const liq = row.liquidityUsd != null ? Number(row.liquidityUsd) : null;
      if (liq != null && liq < MIN_LIQUIDITY_USD) {
        console.log(
          `[webhook] skipped low-liquidity migration mint=${m.mint} liq=$${liq}`,
        );
        continue;
      }

      await upsertToken(row);
      void backfillSlowFields(m.mint).catch(() => undefined);
      if (!row.imageUrl) {
        console.log("[webhook] image missing → background retry:", m.mint);
        void retryImageInBackground(m.mint).catch(() => undefined);
      }
      console.log("[webhook] upserted token:", m.mint);

      // Only send a Telegram alert if we won the atomic claim — otherwise
      // a previous webhook (or another event in this same batch) already
      // sent it. This guarantees one alert per CA, lifetime.
      const claimed = await claimTelegramAlert(m.mint);
      if (claimed) {
        void sendMigrationAlert(row).catch((err) =>
          console.warn("[telegram] alert dispatch failed", err),
        );
      } else {
        console.log("[telegram] alert already sent for", m.mint);
      }
    } catch (err) {
      console.error("[webhook] enrich failed", m.mint, err);
    }
  }

  return NextResponse.json({ received: events.length, migrations: detected.length });
}
