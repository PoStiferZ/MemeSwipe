import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const Body = z.object({
  mints: z.array(z.string().min(32).max(44)).min(1).max(200),
});

/**
 * Permanently delete tokens from the DB. Cascades to swipes & snapshots
 * via the foreign-key constraints.
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const result = await db
    .delete(schema.tokens)
    .where(inArray(schema.tokens.mint, parsed.data.mints))
    .returning({ mint: schema.tokens.mint });
  return NextResponse.json({ ok: true, deleted: result.length });
}
