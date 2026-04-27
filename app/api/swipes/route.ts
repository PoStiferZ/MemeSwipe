import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const Body = z.object({
  wallet: z.string().min(32).max(44),
  mint: z.string().min(32).max(44),
  action: z.enum(["like", "dislike"]),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, mint, action } = parsed.data;

  await db
    .insert(schema.users)
    .values({ wallet })
    .onConflictDoNothing({ target: schema.users.wallet });

  await db
    .insert(schema.swipes)
    .values({ wallet, mint, action })
    .onConflictDoUpdate({
      target: [schema.swipes.wallet, schema.swipes.mint],
      set: { action, createdAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}

const DeleteBody = z.object({
  wallet: z.string().min(32).max(44),
  mint: z.string().min(32).max(44),
});

export async function DELETE(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = DeleteBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, mint } = parsed.data;
  await db
    .delete(schema.swipes)
    .where(
      and(eq(schema.swipes.wallet, wallet), eq(schema.swipes.mint, mint)),
    );
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const rows = await db
    .select({
      mint: schema.swipes.mint,
      action: schema.swipes.action,
      createdAt: schema.swipes.createdAt,
      token: schema.tokens,
    })
    .from(schema.swipes)
    .leftJoin(schema.tokens, eq(schema.swipes.mint, schema.tokens.mint))
    .where(eq(schema.swipes.wallet, wallet));

  return NextResponse.json({ swipes: rows });
}
