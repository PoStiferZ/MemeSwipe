"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { SwipeDeck } from "./SwipeDeck";
import { BottomNav } from "./BottomNav";
import { swipe } from "@/lib/client/session";
import { useEffectiveWallet } from "@/lib/client/wallet";
import { DEFAULT_FILTERS, type ApiToken, type Filters } from "@/lib/types";

type TokensPage = {
  tokens: ApiToken[];
  nextCursor: string | null;
  totalRemaining?: number;
};

export function SwipeView() {
  const { address: walletAddr } = useEffectiveWallet();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [toast, setToast] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ["tokens", filters, walletAddr],
    [filters, walletAddr],
  );

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "15");
      if (filters.minMcap > 0) params.set("minMcap", String(filters.minMcap));
      if (filters.minHolders > 0) params.set("minHolders", String(filters.minHolders));
      if (filters.sinceDays > 0) {
        params.set(
          "since",
          String(Math.floor(Date.now() / 1000) - filters.sinceDays * 86400),
        );
      }
      if (pageParam) params.set("cursor", pageParam);
      if (walletAddr) params.set("excludeWallet", walletAddr);
      const res = await fetch(`/api/tokens?${params.toString()}`);
      if (!res.ok) throw new Error(`tokens ${res.status}`);
      return (await res.json()) as TokensPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];
  const totalRemaining = data?.pages[0]?.totalRemaining ?? null;

  const refreshActiveCard = useCallback(
    async (mint: string) => {
      try {
        const res = await fetch(`/api/tokens/${mint}`);
        if (!res.ok) return;
        const { token } = (await res.json()) as { token: ApiToken };
        qc.setQueryData<{ pages: TokensPage[]; pageParams: unknown[] }>(
          queryKey,
          (prev) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((p) => ({
                    ...p,
                    tokens: p.tokens.map((t) =>
                      t.mint === mint ? token : t,
                    ),
                  })),
                }
              : prev,
        );
      } catch {
        // silent
      }
    },
    [qc, queryKey],
  );

  const swipeMut = useMutation({
    mutationFn: ({ mint, action }: { mint: string; action: "like" | "dislike" }) => {
      if (!walletAddr) throw new Error("No wallet");
      return swipe(walletAddr, mint, action);
    },
    onError: (err) => setToast((err as Error).message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["swipes", walletAddr] });
    },
  });

  const handleSwipe = useCallback(
    (token: ApiToken, action: "like" | "dislike") => {
      if (!walletAddr) {
        setToast("Connect a wallet or enter an address to save swipes");
        return;
      }
      swipeMut.mutate({ mint: token.mint, action });
    },
    [walletAddr, swipeMut],
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        remaining={totalRemaining}
      />

      <div className="flex-1 px-4 pt-6">
        {tokens.length === 0 && !isFetching ? (
          <div className="mt-20 text-center text-white/50">
            Plus de tokens pour le moment.
          </div>
        ) : (
          <SwipeDeck
            tokens={tokens}
            onSwipe={handleSwipe}
            onEmpty={() => hasNextPage && !isFetching && fetchNextPage()}
            onActiveCard={refreshActiveCard}
          />
        )}
      </div>

      <BottomNav active="swipe" />

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
