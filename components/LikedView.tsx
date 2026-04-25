"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "./WalletButton";
import { formatPercent, formatUsd, formatRelative } from "@/lib/format";
import type { ApiToken } from "@/lib/types";

type SwipeRow = {
  mint: string;
  action: "like" | "dislike";
  createdAt: string;
  token: ApiToken | null;
};

export function LikedView() {
  const wallet = useWallet();
  const walletAddr = wallet.publicKey?.toBase58();

  const { data, isLoading } = useQuery({
    queryKey: ["swipes", walletAddr],
    enabled: Boolean(walletAddr),
    queryFn: async () => {
      const res = await fetch(`/api/swipes?wallet=${walletAddr}`);
      if (!res.ok) throw new Error(`swipes ${res.status}`);
      return (await res.json()) as { swipes: SwipeRow[] };
    },
  });

  const liked =
    data?.swipes.filter((s) => s.action === "like" && s.token) ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold tracking-tight">Liked</h1>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </header>

      <div className="flex-1 px-4 py-4">
        {!walletAddr ? (
          <div className="mt-20 text-center text-white/50">
            Connect your wallet to see your likes.
          </div>
        ) : isLoading ? (
          <div className="mt-20 text-center text-white/50">Loading…</div>
        ) : liked.length === 0 ? (
          <div className="mt-20 text-center text-white/50">No likes yet.</div>
        ) : (
          <ul className="space-y-2">
            {liked.map((row) => (
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
                    {formatUsd(row.token!.mcapUsd)} mcap · {formatPercent(
                      row.token!.change24h,
                    )}{" "}
                    24h · liked {formatRelative(row.createdAt)}
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <nav className="sticky bottom-0 mt-4 flex border-t border-line bg-bg/80 backdrop-blur">
        <a className="flex-1 py-3 text-center text-sm text-white/60" href="/">
          Swipe
        </a>
        <a className="flex-1 py-3 text-center text-sm font-medium" href="/liked">
          Liked
        </a>
      </nav>
    </div>
  );
}
