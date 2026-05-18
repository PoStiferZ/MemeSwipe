import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import {
  invalidateTrackedWalletsCache,
  syncTrackingWebhookAddresses,
} from "@/lib/helius/manage-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  wallet: z.string().min(32).max(44), // owner
  tracked: z.string().min(32).max(44),
  label: z.string().max(64).optional(),
});

const DeleteQuery = z.object({
  wallet: z.string().min(32).max(44),
  tracked: z.string().min(32).max(44),
});

export async function GET(req: NextRequest) {
  const owner = new URL(req.url).searchParams.get("wallet");
  if (!owner) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }
  const rows = await db
    .select({
      id: schema.trackedWallets.id,
      trackedWallet: schema.trackedWallets.trackedWallet,
      label: schema.trackedWallets.label,
      createdAt: schema.trackedWallets.createdAt,
      tradeCount: sql<number>`(
        select count(*)::int from ${schema.walletTrades}
        where ${schema.walletTrades.wallet} = ${schema.trackedWallets.trackedWallet}
      )`,
    })
    .from(schema.trackedWallets)
    .where(eq(schema.trackedWallets.ownerWallet, owner))
    .orderBy(schema.trackedWallets.createdAt);
  return NextResponse.json({ wallets: rows });
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, tracked, label } = parsed.data;

  // Ensure the owner exists in `users` so the FK is satisfied.
  await db
    .insert(schema.users)
    .values({ wallet })
    .onConflictDoNothing({ target: schema.users.wallet });

  await db
    .insert(schema.trackedWallets)
    .values({ ownerWallet: wallet, trackedWallet: tracked, label: label ?? null })
    .onConflictDoNothing({
      target: [
        schema.trackedWallets.ownerWallet,
        schema.trackedWallets.trackedWallet,
      ],
    });

  invalidateTrackedWalletsCache();
  try {
    const result = await syncTrackingWebhookAddresses();
    return NextResponse.json({
      ok: true,
      addressCount: result.addressCount,
    });
  } catch (err) {
    // The row is already in the DB — surface the sync error so the user
    // can see why their wallet isn't being watched yet (e.g. webhook
    // not registered, address cap exceeded).
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = DeleteQuery.safeParse({
    wallet: url.searchParams.get("wallet"),
    tracked: url.searchParams.get("tracked"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, tracked } = parsed.data;
  const removed = await db
    .delete(schema.trackedWallets)
    .where(
      and(
        eq(schema.trackedWallets.ownerWallet, wallet),
        eq(schema.trackedWallets.trackedWallet, tracked),
      ),
    )
    .returning({ id: schema.trackedWallets.id });

  invalidateTrackedWalletsCache();
  try {
    await syncTrackingWebhookAddresses();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: true, deleted: removed.length, warning: msg },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, deleted: removed.length });
}
