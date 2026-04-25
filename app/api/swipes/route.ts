import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { verifyLogin } from "@/lib/auth/verifySignature";

export const runtime = "nodejs";

const Body = z.object({
  wallet: z.string().min(32).max(44),
  mint: z.string().min(32).max(44),
  action: z.enum(["like", "dislike"]),
  message: z.object({
    domain: z.string(),
    statement: z.string(),
    issuedAt: z.number().int(),
    nonce: z.string(),
  }),
  signature: z.string(),
});

function expectedDomain(req: NextRequest) {
  return new URL(req.url).host;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, mint, action, message, signature } = parsed.data;

  const verdict = verifyLogin({
    wallet,
    message,
    signatureBase58: signature,
    expectedDomain: expectedDomain(req),
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

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
