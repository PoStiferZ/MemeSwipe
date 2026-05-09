"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletButton } from "./WalletButton";
import { BottomNav } from "./BottomNav";
import { useEffectiveWallet } from "@/lib/client/wallet";
import { formatPercent, formatUsd, formatRelative, tokenChartUrl } from "@/lib/format";
import type { ApiToken } from "@/lib/types";

type SortKey = "recent" | "change1h" | "change24h" | "mcap";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "change1h", label: "1h%" },
  { value: "change24h", label: "24h%" },
  { value: "mcap", label: "MCAP" },
];

type SwipeRow = {
  mint: string;
  action: "like" | "dislike";
  createdAt: string;
  mcapAtSwipeUsd: string | null;
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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>(kind === "liked" ? "mcap" : "recent");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["swipes", walletAddr],
    enabled: Boolean(walletAddr),
    queryFn: async () => {
      const res = await fetch(`/api/swipes?wallet=${walletAddr}`);
      if (!res.ok) throw new Error(`swipes ${res.status}`);
      return (await res.json()) as { swipes: SwipeRow[] };
    },
    // Liked tokens are a watchlist — keep them live.
    refetchInterval: kind === "liked" ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  const removeMut = useMutation({
    mutationFn: async (mint: string) => {
      if (!walletAddr) throw new Error("wallet not connected");
      const params = new URLSearchParams({ wallet: walletAddr, mint });
      const res = await fetch(`/api/swipes?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      return (await res.json()) as { ok: boolean; deleted: number };
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

  const bulkDeleteMut = useMutation({
    mutationFn: async (mints: string[]) => {
      const res = await fetch("/api/tokens/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mints }),
      });
      if (!res.ok) throw new Error(`bulk delete ${res.status}`);
      return (await res.json()) as { ok: boolean; deleted: number };
    },
    onSuccess: () => {
      setSelected(new Set());
      setSelecting(false);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["swipes", walletAddr] });
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const addManualMut = useMutation({
    mutationFn: async (mint: string) => {
      if (!walletAddr) throw new Error("wallet not connected");
      const res = await fetch("/api/swipes/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, mint }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; token: ApiToken }
        | { error: unknown }
        | null;
      if (!res.ok || !body || !("ok" in body)) {
        const msg =
          body && "error" in body && typeof body.error === "string"
            ? body.error
            : `add failed (${res.status})`;
        throw new Error(msg);
      }
      return body.token;
    },
    onSuccess: (token) => {
      // Optimistic prepend so it appears immediately at the top of the list.
      qc.setQueryData<{ swipes: SwipeRow[] }>(["swipes", walletAddr], (old) => {
        if (!old) return old;
        const next = old.swipes.filter((s) => s.mint !== token.mint);
        return {
          swipes: [
            {
              mint: token.mint,
              action: "like" as const,
              createdAt: new Date().toISOString(),
              mcapAtSwipeUsd: token.mcapUsd ?? null,
              token,
            },
            ...next,
          ],
        };
      });
      // Background revalidation so server-truth wins.
      qc.invalidateQueries({ queryKey: ["swipes", walletAddr] });
      setAddInput("");
      setAddError(null);
      setAdding(false);
    },
    onError: (err: Error) => setAddError(err.message),
  });

  const submitAdd = () => {
    const mint = addInput.trim();
    if (mint.length < 32 || mint.length > 44) {
      setAddError("Solana mint must be 32–44 characters");
      return;
    }
    setAddError(null);
    addManualMut.mutate(mint);
  };

  const allSwipes = data?.swipes ?? [];
  const likeCount = allSwipes.filter((s) => s.action === "like").length;
  const dislikeCount = allSwipes.filter((s) => s.action === "dislike").length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allSwipes.filter((s) => {
      if (s.action !== v.action || !s.token) return false;
      if (!q) return true;
      const ticker = s.token.ticker?.toLowerCase() ?? "";
      const name = s.token.name?.toLowerCase() ?? "";
      const mint = s.mint.toLowerCase();
      return ticker.includes(q) || name.includes(q) || mint.includes(q);
    });
    const num = (val: string | null | undefined) =>
      val == null ? -Infinity : Number(val);
    const sorted = [...filtered];
    if (sort === "change1h")
      sorted.sort(
        (a, b) => num(b.token!.change2h) - num(a.token!.change2h),
      );
    else if (sort === "change24h")
      sorted.sort(
        (a, b) => num(b.token!.change24h) - num(a.token!.change24h),
      );
    else if (sort === "mcap")
      sorted.sort((a, b) => num(b.token!.mcapUsd) - num(a.token!.mcapUsd));
    else
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return sorted;
  }, [allSwipes, v.action, sort, search]);

  const toggleSelect = (mint: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint);
      else next.add(mint);
      return next;
    });
  };

  const cancelSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const supportsBulkDelete = kind === "disliked";

  const lastUpdated = dataUpdatedAt
    ? Math.round((Date.now() - dataUpdatedAt) / 1000)
    : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">{v.title}</h1>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-like/15 px-2 py-0.5 text-like">
              ♥ {likeCount}
            </span>
            <span className="rounded-full bg-dislike/15 px-2 py-0.5 text-dislike">
              ✕ {dislikeCount}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {kind === "liked" ? (
              <button
                onClick={() => {
                  setAdding((a) => !a);
                  setAddError(null);
                }}
                aria-label={adding ? "Close add token" : "Add token by CA"}
                title={adding ? "Close" : "Add token by CA"}
                className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                  adding
                    ? "border-accent bg-accent text-black"
                    : "border-line bg-card text-white/70 hover:text-white"
                }`}
              >
                {adding ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
              </button>
            ) : null}
            {supportsBulkDelete && rows.length > 0 ? (
              selecting ? (
                <button
                  onClick={cancelSelection}
                  className="rounded-full border border-line bg-card px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setSelecting(true)}
                  className="rounded-full border border-line bg-card px-3 py-1.5 text-xs"
                >
                  Select
                </button>
              )
            ) : null}
            <WalletButton compact />
          </div>
        </div>

        {kind === "liked" && adding ? (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value);
                  if (addError) setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setAddError(null);
                  }
                }}
                placeholder="Paste a Solana CA…"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                disabled={addManualMut.isPending}
                className="flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm outline-none placeholder:text-white/40 focus:border-accent disabled:opacity-50"
              />
              <button
                onClick={submitAdd}
                disabled={addManualMut.isPending || addInput.trim().length === 0}
                className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                {addManualMut.isPending ? "Adding…" : "Add"}
              </button>
            </div>
            {addError ? (
              <div className="px-1 text-[11px] text-dislike">{addError}</div>
            ) : (
              <div className="px-1 text-[11px] text-white/40">
                Fetches the token from DexScreener + Helius and likes it.
              </div>
            )}
          </div>
        ) : null}

        {kind === "disliked" ? (
          <div className="relative mt-2">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker, name, or CA…"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-full border border-line bg-card py-2 pl-9 pr-9 text-sm outline-none placeholder:text-white/40 focus:border-accent"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

        {kind === "liked" && rows.length > 0 ? (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/40">
              Sort
            </span>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setSort(o.value)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
                  sort === o.value
                    ? "bg-accent font-semibold text-black"
                    : "border border-line bg-card text-white/70"
                }`}
              >
                {o.label}
              </button>
            ))}
            <div className="ml-auto shrink-0 text-[10px] text-white/40">
              {isFetching ? (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  live
                </span>
              ) : lastUpdated != null ? (
                <span>
                  {lastUpdated < 60 ? `${lastUpdated}s` : `${Math.round(lastUpdated / 60)}m`} ago
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      <div className="flex-1 px-4 py-4">
        {!walletAddr ? (
          <div className="mt-20 text-center text-white/50">
            Connect a wallet or enter an address (top right) to see your{" "}
            {v.verb} tokens.
          </div>
        ) : isLoading ? (
          <div className="mt-20 text-center text-white/50">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="mt-20 text-center text-white/50">
            {search.trim() ? `No match for "${search.trim()}"` : v.emptyText}
          </div>
        ) : (
          <ul className={`space-y-2 ${selecting ? "pb-24" : ""}`}>
            {rows.map((row) => {
              const isSelected = selected.has(row.mint);
              const onRowClick = () => {
                if (selecting) {
                  toggleSelect(row.mint);
                } else if (row.token) {
                  window.open(
                    tokenChartUrl(row.token),
                    "_blank",
                    "noopener,noreferrer",
                  );
                }
              };
              return (
                <li
                  key={row.mint}
                  onClick={onRowClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick();
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition active:scale-[0.99] ${
                    isSelected
                      ? "border-dislike bg-dislike/10"
                      : "border-line bg-card hover:border-white/20"
                  }`}
                >
                  {selecting ? (
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                        isSelected
                          ? "border-dislike bg-dislike text-bg"
                          : "border-line"
                      }`}
                    >
                      {isSelected ? (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </div>
                  ) : null}
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
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <PillBadge tone="neutral">
                        {formatUsd(row.token!.mcapUsd)}
                      </PillBadge>
                      <ChangePill label="1h" value={row.token!.change2h} />
                      <ChangePill label="24h" value={row.token!.change24h} />
                      {kind === "liked" ? (
                        <EntryPill
                          entry={row.mcapAtSwipeUsd}
                          current={row.token!.mcapUsd}
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 text-[10px] text-white/40">
                      {v.verb} {formatRelative(row.createdAt)}
                    </div>
                  </div>
                  {selecting ? null : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeMut.mutate(row.mint);
                      }}
                      disabled={removeMut.isPending}
                      className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white/40 hover:bg-dislike/15 hover:text-dislike active:scale-90 disabled:opacity-40"
                      aria-label="Remove from list"
                      title="Remove (returns the token to swipe)"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selecting && selected.size > 0 ? (
        <div className="sticky bottom-[58px] z-20 border-t border-dislike/30 bg-bg/95 px-4 py-3 backdrop-blur">
          <button
            onClick={() => bulkDeleteMut.mutate(Array.from(selected))}
            disabled={bulkDeleteMut.isPending}
            className="w-full rounded-2xl bg-dislike py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {bulkDeleteMut.isPending
              ? "Deleting…"
              : `Delete ${selected.size} token${selected.size > 1 ? "s" : ""} permanently`}
          </button>
          <p className="mt-1.5 text-center text-[10px] text-white/40">
            Removed from the database — won't appear in swipe deck again.
          </p>
        </div>
      ) : null}

      <BottomNav active={v.navKey} />
    </div>
  );
}

function PillBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "up" | "down";
}) {
  const cls =
    tone === "up"
      ? "bg-like/15 text-like"
      : tone === "down"
        ? "bg-dislike/15 text-dislike"
        : "bg-black/40 text-white/80";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}
    >
      {children}
    </span>
  );
}

function ChangePill({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const n = value == null ? null : Number(value);
  const tone: "up" | "down" | "neutral" =
    n == null || n === 0 ? "neutral" : n > 0 ? "up" : "down";
  return (
    <PillBadge tone={tone}>
      <span className="opacity-60 mr-0.5">{label}</span>
      {formatPercent(n)}
    </PillBadge>
  );
}

/**
 * Shows the user's entry mcap (the snapshot taken when they liked) and
 * the % delta vs the current mcap. Only rendered for liked rows.
 */
function EntryPill({
  entry,
  current,
}: {
  entry: string | null;
  current: string | null;
}) {
  if (entry == null) return null;
  const entryN = Number(entry);
  const currentN = current == null ? null : Number(current);
  const deltaPct =
    currentN != null && entryN > 0 ? ((currentN - entryN) / entryN) * 100 : null;
  const tone: "up" | "down" | "neutral" =
    deltaPct == null || deltaPct === 0
      ? "neutral"
      : deltaPct > 0
        ? "up"
        : "down";
  return (
    <PillBadge tone={tone}>
      <span className="opacity-60 mr-0.5">entry</span>
      {formatUsd(entryN)}
      {deltaPct != null ? (
        <span className="ml-1 opacity-80">
          ({deltaPct > 0 ? "+" : ""}
          {deltaPct.toFixed(deltaPct >= 100 || deltaPct <= -100 ? 0 : 1)}%)
        </span>
      ) : null}
    </PillBadge>
  );
}
