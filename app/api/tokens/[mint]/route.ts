import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-token refresh — called by the swipe deck when a card becomes active
 * so the user always sees current price/mcap/volume right before deciding.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const [row] = await db
    .select()
    .from(schema.tokens)
    .where(eq(schema.tokens.mint, mint))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const dex = await fetchEnriched(mint);
    const refreshed = await applyDexPatch(row, dex, new Date());
    return NextResponse.json({ token: refreshed });
  } catch {
    return NextResponse.json({ token: row });
  }
}
