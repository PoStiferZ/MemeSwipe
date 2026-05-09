import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchManyEnriched } from "@/lib/sources/dexscreener";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";

// Liked tokens are the user's "watchlist" — refresh on read so prices stay
// live without a background cron. 20s cache is short enough for monitoring
// but avoids hammering DexScreener on quick page revisits.
const LIKED_STALE_MS = 20_000;

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

  // Snapshot the token's current mcap so the Liked view can show entry vs
  // now. We only capture on `like` (no point on dislike), and only if the
  // tokens row already has a mcap loaded — otherwise leave it NULL.
  let mcapAtSwipeUsd: string | null = null;
  if (action === "like") {
    const [tok] = await db
      .select({ mcapUsd: schema.tokens.mcapUsd })
      .from(schema.tokens)
      .where(eq(schema.tokens.mint, mint))
      .limit(1);
    mcapAtSwipeUsd = tok?.mcapUsd ?? null;
  }

  await db
    .insert(schema.swipes)
    .values({ wallet, mint, action, mcapAtSwipeUsd })
    .onConflictDoUpdate({
      target: [schema.swipes.wallet, schema.swipes.mint],
      set: {
        action,
        createdAt: new Date(),
        // Only overwrite the entry mcap when the new action is `like` and
        // we resolved a value — otherwise keep the original snapshot
        // (e.g. user dislikes then re-likes; we want their first-like price).
        ...(action === "like" && mcapAtSwipeUsd != null
          ? { mcapAtSwipeUsd }
          : {}),
      },
    });

  return NextResponse.json({ ok: true });
}

const DeleteQuery = z.object({
  wallet: z.string().min(32).max(44),
  mint: z.string().min(32).max(44),
});

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = DeleteQuery.safeParse({
    wallet: url.searchParams.get("wallet"),
    mint: url.searchParams.get("mint"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, mint } = parsed.data;
  const result = await db
    .delete(schema.swipes)
    .where(
      and(eq(schema.swipes.wallet, wallet), eq(schema.swipes.mint, mint)),
    )
    .returning({ mint: schema.swipes.mint });
  return NextResponse.json({ ok: true, deleted: result.length });
}

export async function GET(req: NextRequest) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const rows = await db
    .select({
      mint: schema.swipes.mint,
      action: schema.swipes.action,
      createdAt: schema.swipes.createdAt,
      mcapAtSwipeUsd: schema.swipes.mcapAtSwipeUsd,
      token: schema.tokens,
    })
    .from(schema.swipes)
    .leftJoin(schema.tokens, eq(schema.swipes.mint, schema.tokens.mint))
    .where(eq(schema.swipes.wallet, wallet));

  // Refresh liked tokens (the user's watchlist) so prices/changes stay live.
  // Skip dislikes — those are noise and not worth the bandwidth.
  const now = new Date();
  const likesNeedingRefresh = rows.filter(
    (r) =>
      r.action === "like" &&
      r.token &&
      now.getTime() - (r.token.lastSnapshotAt?.getTime() ?? 0) >= LIKED_STALE_MS,
  );
  if (likesNeedingRefresh.length > 0) {
    try {
      const dex = await fetchManyEnriched(
        likesNeedingRefresh.map((r) => r.mint),
      );
      await Promise.all(
        likesNeedingRefresh.map(async (r) => {
          const d = dex.get(r.mint);
          if (!d || !r.token) return;
          const updated = await applyDexPatch(r.token, d, now);
          if (updated !== r.token) r.token = updated;
        }),
      );
    } catch {
      // soft-fail — return stale rather than empty
    }
  }

  return NextResponse.json({ swipes: rows });
}
