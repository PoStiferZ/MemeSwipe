"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletButton } from "./WalletButton";
import { BottomNav } from "./BottomNav";
import { useEffectiveWallet } from "@/lib/client/wallet";
import { formatPercent, formatUsd, formatRelative } from "@/lib/format";
import type { ApiToken } from "@/lib/types";

type SwipeRow = {
  mint: string;
  action: "like" | "dislike";
  createdAt: string;
  token: ApiToken | null;
};

type Variant = {
  action: "like" | "dislike";
  title: string;
  emptyText: string;
  verb: string;
  navKey: "liked" | "disliked";
};

const VARIANTS: Record<"liked" | "disliked", Variant> = {
  liked: {
    action: "like",
    title: "Liked",
    emptyText: "No likes yet.",
    verb: "liked",
    navKey: "liked",
  },
  disliked: {
    action: "dislike",
    title: "Disliked",
    emptyText: "No dislikes yet.",
    verb: "disliked",
    navKey: "disliked",
  },
};

export function SwipesListView({ kind }: { kind: "liked" | "disliked" }) {
  const v = VARIANTS[kind];
  const { address: walletAddr } = useEffectiveWallet();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["swipes", walletAddr],
    enabled: Boolean(walletAddr),
    queryFn: async () => {
      const res = await fetch(`/api/swipes?wallet=${walletAddr}`);
      if (!res.ok) throw new Error(`swipes ${res.status}`);
      return (await res.json()) as { swipes: SwipeRow[] };
    },
  });

  const removeMut = useMutation({
    mutationFn: async (mint: string) => {
      if (!walletAddr) throw new Error("wallet not connected");
      const res = await fetch("/api/swipes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, mint }),
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
    },
    onMutate: async (mint) => {
      await qc.cancelQueries({ queryKey: ["swipes", walletAddr] });
      const prev = qc.getQueryData<{ swipes: SwipeRow[] }>([
        "swipes",
        walletAddr,
      ]);
      qc.setQueryData<{ swipes: SwipeRow[] }>(["swipes", walletAddr], (old) =>
        old ? { swipes: old.swipes.filter((s) => s.mint !== mint) } : old,
      );
      return { prev };
    },
    onError: (_err, _mint, ctx) => {
      if (ctx?.prev) qc.setQueryData(["swipes", walletAddr], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["swipes", walletAddr] });
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const rows =
    data?.swipes.filter((s) => s.action === v.action && s.token) ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold tracking-tight">{v.title}</h1>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </header>

      <div className="flex-1 px-4 py-4">
        {!walletAddr ? (
          <div className="mt-20 text-center text-white/50">
            Connect a wallet or enter an address (top right) to see your {v.verb} tokens.
          </div>
        ) : isLoading ? (
          <div className="mt-20 text-center text-white/50">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="mt-20 text-center text-white/50">{v.emptyText}</div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.mint}
                className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3"
              >
                {row.token!.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.token!.imageUrl}
                    alt={row.token!.ticker ?? row.mint}
                    className="h-12 w-12 rounded-lg object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-black/40" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    ${row.token!.ticker ?? "?"}{" "}
                    <span className="text-xs font-normal text-white/50">
                      {row.token!.name}
                    </span>
                  </div>
                  <div className="text-xs text-white/60">
                    {formatUsd(row.token!.mcapUsd)} mcap ·{" "}
                    {formatPercent(row.token!.change24h)} 24h · {v.verb}{" "}
                    {formatRelative(row.createdAt)}
                  </div>
                </div>
                <a
                  href={`https://dexscreener.com/solana/${row.mint}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent"
                >
                  chart →
                </a>
                <button
                  onClick={() => removeMut.mutate(row.mint)}
                  disabled={removeMut.isPending}
                  className="ml-2 flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:bg-white/5 hover:text-white/80 disabled:opacity-40"
                  aria-label="Remove"
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BottomNav active={v.navKey} />
    </div>
  );
}
