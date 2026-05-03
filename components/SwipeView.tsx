"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";
import { SwipeDeck } from "./SwipeDeck";
import { SwipeList } from "./SwipeList";
import { BottomNav } from "./BottomNav";
import { swipe } from "@/lib/client/session";
import { useEffectiveWallet } from "@/lib/client/wallet";
import { DEFAULT_FILTERS, type ApiToken, type Filters } from "@/lib/types";

const FILTERS_KEY = "memeswipe.filters";

function loadFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      minMcap: typeof parsed.minMcap === "number" ? parsed.minMcap : 0,
      maxMcap: typeof parsed.maxMcap === "number" ? parsed.maxMcap : 0,
      minHolders:
        typeof parsed.minHolders === "number" ? parsed.minHolders : 0,
      sinceDays: typeof parsed.sinceDays === "number" ? parsed.sinceDays : 0,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: Filters) {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // quota / private mode — ignore
  }
}

type TokensPage = {
  tokens: ApiToken[];
  nextCursor: string | null;
  totalRemaining?: number;
};

export function SwipeView() {
  const { address: walletAddr } = useEffectiveWallet();
  const qc = useQueryClient();
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const [toast, setToast] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"deck" | "list">(() => {
    if (typeof window === "undefined") return "deck";
    return (window.localStorage.getItem("memeswipe.viewMode") as "deck" | "list") ?? "deck";
  });
  const switchView = useCallback((mode: "deck" | "list") => {
    setViewMode(mode);
    try {
      window.localStorage.setItem("memeswipe.viewMode", mode);
    } catch {
      // ignore
    }
  }, []);

  const setFilters = useCallback((next: Filters) => {
    setFiltersState(next);
    saveFilters(next);
  }, []);

  const queryKey = useMemo(
    () => ["tokens", filters, walletAddr],
    [filters, walletAddr],
  );

  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "30");
      if (filters.minMcap > 0) params.set("minMcap", String(filters.minMcap));
      if (filters.maxMcap > 0) params.set("maxMcap", String(filters.maxMcap));
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

  // Auto-prefetch the next page as soon as the deck gets low — this keeps
  // swiping continuous instead of stalling out on "Plus de tokens" while a
  // fresh page loads.
  useEffect(() => {
    if (tokens.length < 8 && hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [tokens.length, hasNextPage, isFetching, fetchNextPage]);

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
    onMutate: ({ mint }) => {
      // Optimistically: drop the swiped token from every cached page and
      // decrement the counter on the first page so the header updates
      // immediately, without waiting for a refetch.
      qc.setQueryData<{ pages: TokensPage[]; pageParams: unknown[] }>(
        queryKey,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pages: prev.pages.map((p, idx) => ({
              ...p,
              tokens: p.tokens.filter((t) => t.mint !== mint),
              totalRemaining:
                idx === 0 && p.totalRemaining != null
                  ? Math.max(0, p.totalRemaining - 1)
                  : p.totalRemaining,
            })),
          };
        },
      );
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

      <ViewToggle mode={viewMode} onChange={switchView} />

      <div className="flex-1 px-4 pt-3 pb-4">
        {tokens.length === 0 && !hasNextPage && !isFetching ? (
          <div className="mt-20 text-center text-white/50">
            Plus de tokens pour le moment.
          </div>
        ) : tokens.length === 0 && isFetching ? (
          <div className="mt-20 flex flex-col items-center gap-3 text-white/50">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
            Loading…
          </div>
        ) : viewMode === "deck" ? (
          <SwipeDeck
            tokens={tokens}
            onSwipe={handleSwipe}
            onActiveCard={refreshActiveCard}
            isLoadingMore={isFetching}
            hasMore={Boolean(hasNextPage)}
          />
        ) : (
          <SwipeList
            tokens={tokens}
            hasNextPage={Boolean(hasNextPage)}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={() => fetchNextPage()}
            onSwipe={handleSwipe}
            onRefreshOne={refreshActiveCard}
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

function ViewToggle({
  mode,
  onChange,
}: {
  mode: "deck" | "list";
  onChange: (m: "deck" | "list") => void;
}) {
  return (
    <div className="px-4 pt-3">
      <div className="inline-flex rounded-full border border-line bg-card p-0.5 text-xs">
        <button
          onClick={() => onChange("deck")}
          className={`flex items-center gap-1 rounded-full px-3 py-1 ${
            mode === "deck" ? "bg-accent font-semibold text-black" : "text-white/60"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="4" width="12" height="14" rx="2" />
            <rect x="3" y="7" width="12" height="14" rx="2" opacity="0.5" />
          </svg>
          Deck
        </button>
        <button
          onClick={() => onChange("list")}
          className={`flex items-center gap-1 rounded-full px-3 py-1 ${
            mode === "list" ? "bg-accent font-semibold text-black" : "text-white/60"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          List
        </button>
      </div>
    </div>
  );
}
