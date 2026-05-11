"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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

  const [sortDir, setSortDir] = useState<"desc" | "asc">(() => {
    if (typeof window === "undefined") return "desc";
    return (window.localStorage.getItem("memeswipe.sortDir") as "desc" | "asc") ?? "desc";
  });
  const switchSort = useCallback((dir: "desc" | "asc") => {
    setSortDir(dir);
    try {
      window.localStorage.setItem("memeswipe.sortDir", dir);
    } catch {
      // ignore
    }
  }, []);

  const setFilters = useCallback((next: Filters) => {
    setFiltersState(next);
    saveFilters(next);
  }, []);

  const queryKey = useMemo(
    () => ["tokens", filters, sortDir, walletAddr],
    [filters, sortDir, walletAddr],
  );

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey,
    enabled: viewMode === "deck",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "30");
      params.set("sort", sortDir);
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

  // Separate paginated query for the List view.
  const [listPage, setListPage] = useState(1);
  // Reset to page 1 when filters/sort/wallet change.
  useEffect(() => {
    setListPage(1);
  }, [filters, sortDir, walletAddr]);

  const PAGE_SIZE = 30;
  const listKey = useMemo(
    () => ["tokens-list", filters, sortDir, walletAddr, listPage],
    [filters, sortDir, walletAddr, listPage],
  );

  const { data: listData, isFetching: isListFetching } = useQuery({
    queryKey: listKey,
    enabled: viewMode === "list",
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(listPage));
      params.set("sort", sortDir);
      if (filters.minMcap > 0) params.set("minMcap", String(filters.minMcap));
      if (filters.maxMcap > 0) params.set("maxMcap", String(filters.maxMcap));
      if (filters.minHolders > 0)
        params.set("minHolders", String(filters.minHolders));
      if (filters.sinceDays > 0) {
        params.set(
          "since",
          String(Math.floor(Date.now() / 1000) - filters.sinceDays * 86400),
        );
      }
      if (walletAddr) params.set("excludeWallet", walletAddr);
      const res = await fetch(`/api/tokens?${params.toString()}`);
      if (!res.ok) throw new Error(`tokens ${res.status}`);
      return (await res.json()) as TokensPage;
    },
  });

  // Auto-prefetch the next deck page when the deck gets low (deck mode only).
  useEffect(() => {
    if (
      viewMode === "deck" &&
      tokens.length < 8 &&
      hasNextPage &&
      !isFetching
    ) {
      fetchNextPage();
    }
  }, [viewMode, tokens.length, hasNextPage, isFetching, fetchNextPage]);

  const patchTokens = useCallback(
    (updates: ApiToken[]) => {
      if (updates.length === 0) return;
      const byMint = new Map(updates.map((t) => [t.mint, t]));
      qc.setQueryData<{ pages: TokensPage[]; pageParams: unknown[] }>(
        queryKey,
        (prev) =>
          prev
            ? {
                ...prev,
                pages: prev.pages.map((p) => ({
                  ...p,
                  tokens: p.tokens.map((t) => byMint.get(t.mint) ?? t),
                })),
              }
            : prev,
      );
      qc.setQueryData<TokensPage>(listKey, (prev) =>
        prev
          ? {
              ...prev,
              tokens: prev.tokens.map((t) => byMint.get(t.mint) ?? t),
            }
          : prev,
      );
    },
    [qc, queryKey, listKey],
  );

  const refreshActiveCard = useCallback(
    async (mint: string) => {
      try {
        const res = await fetch(`/api/tokens/${mint}`);
        if (!res.ok) return;
        const { token } = (await res.json()) as { token: ApiToken };
        patchTokens([token]);
      } catch {
        // silent
      }
    },
    [patchTokens],
  );

  // Reload from DB. Just invalidates the active query so React Query
  // refetches via the same /api/tokens flow — gives the user a fresh
  // snapshot of swipeable tokens without any DexScreener/Helius work.
  const reloadFromDb = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tokens-list"], exact: false }),
      qc.invalidateQueries({ queryKey: ["tokens"], exact: false }),
    ]);
  }, [qc]);

  const swipeMut = useMutation({
    mutationFn: ({ mint, action }: { mint: string; action: "like" | "dislike" }) => {
      if (!walletAddr) throw new Error("No wallet");
      return swipe(walletAddr, mint, action);
    },
    onMutate: ({ mint }) => {
      // Drop the swiped token from BOTH caches and decrement counters.
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
      qc.setQueryData<TokensPage>(listKey, (prev) =>
        prev
          ? {
              ...prev,
              tokens: prev.tokens.filter((t) => t.mint !== mint),
              totalRemaining:
                prev.totalRemaining != null
                  ? Math.max(0, prev.totalRemaining - 1)
                  : prev.totalRemaining,
            }
          : prev,
      );
      // No `invalidateQueries` here on purpose. The optimistic patches
      // above are exact and cheap; invalidating triggers a full refetch
      // of the visible page, which blanks the list to a "Loading…" state
      // mid-swipe and breaks the rapid-fire flow the user wants. Other
      // pages will refetch naturally next time they become active.
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
        remaining={
          viewMode === "list"
            ? (listData?.totalRemaining ?? null)
            : totalRemaining
        }
      />

      <ViewToggle mode={viewMode} onChange={switchView} />

      <div className="flex-1 px-4 pt-3 pb-4">
        {viewMode === "deck" && tokens.length === 0 && !hasNextPage && !isFetching ? (
          <div className="mt-20 text-center text-white/50">
            Plus de tokens pour le moment.
          </div>
        ) : viewMode === "deck" && tokens.length === 0 && isFetching ? (
          <DeckSkeleton />
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
            tokens={listData?.tokens ?? []}
            totalRemaining={
              listData?.totalRemaining ?? totalRemaining ?? null
            }
            page={listPage}
            pageSize={PAGE_SIZE}
            onPageChange={setListPage}
            isFetching={isListFetching}
            onSwipe={handleSwipe}
            onRefresh={reloadFromDb}
            sortDir={sortDir}
            onSortChange={switchSort}
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

/**
 * Placeholder that mirrors the real card layout while the first /api/tokens
 * response is in flight. Shimmering with the `animate-pulse` utility keeps
 * the perceived load time short — Proposition A's 500-800ms refresh round
 * trip would look like dead time without it.
 */
function DeckSkeleton() {
  return (
    <div className="mt-2 flex flex-col gap-4">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-line bg-card">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 via-white/10 to-white/5" />
        <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
          <div className="flex gap-1.5">
            <div className="h-5 w-16 animate-pulse rounded-full bg-white/10" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-white/10" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-white/10" />
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-6">
        <div className="h-14 w-14 animate-pulse rounded-full bg-dislike/20" />
        <div className="h-14 w-14 animate-pulse rounded-full bg-like/20" />
      </div>
    </div>
  );
}
