"use client";

import { useCallback, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { SwipeDeck } from "./SwipeDeck";
import { swipe } from "@/lib/client/session";
import { DEFAULT_FILTERS, type ApiToken, type Filters } from "@/lib/types";

type TokensPage = { tokens: ApiToken[]; nextCursor: string | null };

export function SwipeView() {
  const wallet = useWallet();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [pendingNew, setPendingNew] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const queryKey = useMemo(
    () => [
      "tokens",
      filters,
      wallet.publicKey?.toBase58() ?? null,
    ],
    [filters, wallet.publicKey],
  );

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "30");
      if (filters.minMcap > 0) params.set("minMcap", String(filters.minMcap));
      if (filters.minHolders > 0) params.set("minHolders", String(filters.minHolders));
      if (filters.sinceDays > 0) {
        params.set(
          "since",
          String(Math.floor(Date.now() / 1000) - filters.sinceDays * 86400),
        );
      }
      if (pageParam) params.set("cursor", pageParam);
      if (wallet.publicKey) params.set("excludeWallet", wallet.publicKey.toBase58());
      const res = await fetch(`/api/tokens?${params.toString()}`);
      if (!res.ok) throw new Error(`tokens ${res.status}`);
      return (await res.json()) as TokensPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];

  const swipeMut = useMutation({
    mutationFn: ({ mint, action }: { mint: string; action: "like" | "dislike" }) =>
      swipe(wallet, mint, action),
    onError: (err) => setToast((err as Error).message),
  });

  const handleSwipe = useCallback(
    (token: ApiToken, action: "like" | "dislike") => {
      if (!wallet.publicKey) {
        setToast("Connect your wallet to save swipes");
        return;
      }
      swipeMut.mutate({ mint: token.mint, action });
    },
    [wallet.publicKey, swipeMut],
  );

  const refreshMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      return (await res.json()) as { newCount: number };
    },
    onSuccess: ({ newCount }) => {
      setPendingNew(newCount);
      setToast(
        newCount > 0
          ? `${newCount} new migration${newCount > 1 ? "s" : ""}`
          : "No new migrations",
      );
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err) => setToast((err as Error).message),
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={() => refreshMut.mutate()}
        refreshing={refreshMut.isPending}
        pendingCount={pendingNew}
      />

      <div className="flex-1 px-4 pt-6">
        {tokens.length === 0 && !isFetching ? (
          <div className="mt-20 text-center text-white/50">
            No tokens yet. Run <code>pnpm backfill</code> or hit{" "}
            <strong>Refresh</strong>.
          </div>
        ) : (
          <SwipeDeck
            tokens={tokens}
            onSwipe={handleSwipe}
            onEmpty={() => hasNextPage && !isFetching && fetchNextPage()}
          />
        )}
      </div>

      <nav className="sticky bottom-0 mt-4 flex border-t border-line bg-bg/80 backdrop-blur">
        <a className="flex-1 py-3 text-center text-sm font-medium" href="/">
          Swipe
        </a>
        <a className="flex-1 py-3 text-center text-sm text-white/60" href="/liked">
          Liked
        </a>
      </nav>

      {toast ? (
        <div
          onClick={() => setToast(null)}
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-card px-4 py-2 text-sm shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
