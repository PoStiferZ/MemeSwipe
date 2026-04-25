import { NextRequest, NextResponse } from "next/server";
import { detectFromWebhookEvent } from "@/lib/sources/pumpswap";
import { backfillSlowFields, buildTokenRow, upsertToken } from "@/lib/indexer/enrichToken";

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

  const events = (await req.json().catch(() => [])) as Array<{
    signature: string;
    slot: number;
    timestamp: number;
    instructions?: { programId: string; accounts: string[]; data: string }[];
    innerInstructions?: { instructions: { programId: string; accounts: string[]; data: string }[] }[];
  }>;

  const detected = events
    .map((e) => detectFromWebhookEvent(e))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  for (const m of detected) {
    try {
      const row = await buildTokenRow(m);
      await upsertToken(row);
      void backfillSlowFields(m.mint).catch(() => undefined);
    } catch (err) {
      console.error("[webhook] enrich failed", m.mint, err);
    }
  }

  return NextResponse.json({ received: events.length, migrations: detected.length });
}
