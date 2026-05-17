import { NextRequest, NextResponse } from "next/server";
import { detectFromWebhookEvent } from "@/lib/sources/pumpswap";
import {
  backfillSlowFields,
  buildTokenRow,
  retryImageInBackground,
  upsertToken,
} from "@/lib/indexer/enrichToken";
import { sendMigrationAlert } from "@/lib/notifications/telegram";

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

  const detected = events
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

      // Fire-and-forget Telegram alert. Failures are swallowed inside
      // sendMigrationAlert; this `.catch` is a belt-and-suspenders guard.
      void sendMigrationAlert(row).catch((err) =>
        console.warn("[telegram] alert dispatch failed", err),
      );
    } catch (err) {
      console.error("[webhook] enrich failed", m.mint, err);
    }
  }

  return NextResponse.json({ received: events.length, migrations: detected.length });
}
