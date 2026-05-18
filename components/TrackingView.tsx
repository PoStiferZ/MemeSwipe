"use client";

import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BottomNav } from "./BottomNav";
import { WalletButton } from "./WalletButton";
import { useEffectiveWallet, isValidSolanaAddress } from "@/lib/client/wallet";
import {
  formatPercent,
  formatRelative,
  formatUsd,
  tokenChartUrl,
} from "@/lib/format";

type TrackedWallet = {
  id: number;
  trackedWallet: string;
  label: string | null;
  createdAt: string;
  tradeCount: number;
};

type TradeRow = {
  id: number;
  signature: string;
  wallet: string;
  direction: "buy" | "sell";
  mint: string;
  dexSource: string | null;
  tokenAmount: string | null;
  solAmount: string | null;
  usdValue: string | null;
  priceUsd: string | null;
  blockTime: string;
  label: string | null;
  ticker: string | null;
  name: string | null;
  imageUrl: string | null;
  poolAddress: string | null;
};

type TradesPage = { trades: TradeRow[]; nextCursor: string | null };

type DirectionFilter = "all" | "buy" | "sell";

export function TrackingView() {
  const { address: walletAddr } = useEffectiveWallet();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [filterWallet, setFilterWallet] = useState<string | null>(null);

  const walletsKey = useMemo(
    () => ["tracking-wallets", walletAddr],
    [walletAddr],
  );
  const tradesKey = useMemo(
    () => ["tracking-trades", walletAddr, direction, filterWallet],
    [walletAddr, direction, filterWallet],
  );

  const { data: walletsData, isLoading: walletsLoading } = useQuery({
    queryKey: walletsKey,
    enabled: Boolean(walletAddr),
    queryFn: async () => {
      const res = await fetch(`/api/tracking/wallets?wallet=${walletAddr}`);
      if (!res.ok) throw new Error(`wallets ${res.status}`);
      return (await res.json()) as { wallets: TrackedWallet[] };
    },
  });
  const wallets = walletsData?.wallets ?? [];

  const {
    data: tradesData,
    isLoading: tradesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: tradesKey,
    enabled: Boolean(walletAddr),
    initialPageParam: null as string | null,
    refetchInterval: 20_000, // poll for newly-arrived trades while page is open
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ wallet: walletAddr!, limit: "50" });
      if (direction !== "all") params.set("direction", direction);
      if (filterWallet) params.set("filterWallet", filterWallet);
      if (pageParam) params.set("cursor", pageParam);
      const res = await fetch(`/api/tracking/trades?${params.toString()}`);
      if (!res.ok) throw new Error(`trades ${res.status}`);
      return (await res.json()) as TradesPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const trades = tradesData?.pages.flatMap((p) => p.trades) ?? [];

  const addMut = useMutation({
    mutationFn: async () => {
      const tracked = addInput.trim();
      const label = addLabel.trim() || undefined;
      if (!walletAddr) throw new Error("Connect a wallet first");
      if (!isValidSolanaAddress(tracked))
        throw new Error("Invalid Solana address");
      const res = await fetch("/api/tracking/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, tracked, label }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `add failed (${res.status})`);
      }
    },
    onSuccess: () => {
      setAddInput("");
      setAddLabel("");
      setAddError(null);
      setAdding(false);
      qc.invalidateQueries({ queryKey: walletsKey });
      qc.invalidateQueries({ queryKey: ["tracking-trades", walletAddr] });
    },
    onError: (err: Error) => setAddError(err.message),
  });

  const removeMut = useMutation({
    mutationFn: async (tracked: string) => {
      const params = new URLSearchParams({ wallet: walletAddr!, tracked });
      const res = await fetch(`/api/tracking/wallets?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
    },
    onSuccess: (_data, tracked) => {
      qc.invalidateQueries({ queryKey: walletsKey });
      qc.invalidateQueries({ queryKey: ["tracking-trades", walletAddr] });
      if (filterWallet === tracked) setFilterWallet(null);
    },
  });

  const submitAdd = () => {
    if (!addInput.trim()) {
      setAddError("Paste an address");
      return;
    }
    addMut.mutate();
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">Tracking</h1>
          <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-white/70">
            {wallets.length} wallet{wallets.length === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setAdding((a) => !a);
                setAddError(null);
              }}
              aria-label={adding ? "Close add wallet" : "Add wallet"}
              title={adding ? "Close" : "Add wallet"}
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
            <WalletButton compact />
          </div>
        </div>

        {adding ? (
          <div className="mt-2 space-y-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder="Wallet address"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                disabled={addMut.isPending}
                className="flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm outline-none placeholder:text-white/40 focus:border-accent disabled:opacity-50"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Label (optional, e.g. Whale-A)"
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
                disabled={addMut.isPending}
                className="flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm outline-none placeholder:text-white/40 focus:border-accent disabled:opacity-50"
              />
              <button
                onClick={submitAdd}
                disabled={addMut.isPending || addInput.trim().length === 0}
                className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                {addMut.isPending ? "Adding…" : "Add"}
              </button>
            </div>
            {addError ? (
              <div className="px-1 text-[11px] text-dislike">{addError}</div>
            ) : (
              <div className="px-1 text-[11px] text-white/40">
                Adds the wallet to your Helius webhook — trades land here within seconds.
              </div>
            )}
          </div>
        ) : null}

        {wallets.length > 0 ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            <WalletChip
              active={filterWallet === null}
              onClick={() => setFilterWallet(null)}
              label="All wallets"
              count={wallets.reduce((s, w) => s + w.tradeCount, 0)}
            />
            {wallets.map((w) => (
              <WalletChip
                key={w.id}
                active={filterWallet === w.trackedWallet}
                onClick={() => setFilterWallet(w.trackedWallet)}
                onRemove={() => {
                  if (confirm(`Stop tracking ${w.label ?? w.trackedWallet}?`)) {
                    removeMut.mutate(w.trackedWallet);
                  }
                }}
                label={w.label ?? shortAddr(w.trackedWallet)}
                count={w.tradeCount}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-white/40">
            Direction
          </span>
          {(["all", "buy", "sell"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${
                direction === d
                  ? d === "buy"
                    ? "bg-like font-semibold text-black"
                    : d === "sell"
                      ? "bg-dislike font-semibold text-black"
                      : "bg-accent font-semibold text-black"
                  : "border border-line bg-card text-white/70"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 px-4 py-3 pb-24">
        {!walletAddr ? (
          <div className="mt-20 text-center text-white/50">
            Connect a wallet (top right) to start tracking.
          </div>
        ) : walletsLoading ? (
          <TrackingSkeleton />
        ) : wallets.length === 0 ? (
          <div className="mt-20 space-y-2 text-center text-white/50">
            <p>No wallets tracked yet.</p>
            <p className="text-xs text-white/40">Tap + to paste a Solana address.</p>
          </div>
        ) : tradesLoading ? (
          <TrackingSkeleton />
        ) : trades.length === 0 ? (
          <div className="mt-20 text-center text-white/50">
            No trades yet. Waiting for activity…
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {trades.map((t) => (
                <TradeRowItem key={`${t.id}`} trade={t} />
              ))}
            </ul>
            {hasNextPage ? (
              <div className="pt-3 text-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="rounded-full border border-line bg-card px-4 py-1.5 text-xs text-white/70 disabled:opacity-40"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <BottomNav active="tracking" />
    </div>
  );
}

function WalletChip({
  label,
  count,
  active,
  onClick,
  onRemove,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-line bg-card text-white/70"
      }`}
    >
      <button onClick={onClick} className="flex items-center gap-1.5">
        <span className="font-medium">{label}</span>
        <span className="rounded-full bg-black/40 px-1.5 text-[10px] text-white/60">
          {count}
        </span>
      </button>
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label="Stop tracking this wallet"
          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white/40 hover:bg-dislike/30 hover:text-dislike"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function TradeRowItem({ trade }: { trade: TradeRow }) {
  const onClick = () => {
    if (!trade.mint) return;
    const url = tokenChartUrl({
      mint: trade.mint,
      poolAddress: trade.poolAddress,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const isBuy = trade.direction === "buy";
  const tokenAmtNum = trade.tokenAmount ? Number(trade.tokenAmount) : null;
  const usdNum = trade.usdValue ? Number(trade.usdValue) : null;
  const solNum = trade.solAmount ? Number(trade.solAmount) : null;

  return (
    <li
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-card p-3 transition hover:border-white/20 active:scale-[0.99]"
    >
      {trade.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trade.imageUrl}
          alt={trade.ticker ?? trade.mint}
          className="h-12 w-12 shrink-0 rounded-lg object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-black/40 text-[10px] text-white/30">
          ?
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              isBuy ? "bg-like text-black" : "bg-dislike text-white"
            }`}
          >
            {isBuy ? "Buy" : "Sell"}
          </span>
          <span className="truncate text-sm font-semibold">
            ${trade.ticker ?? shortAddr(trade.mint)}
          </span>
          {trade.name ? (
            <span className="truncate text-[11px] text-white/40">
              {trade.name}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/70">
          <span className="font-medium">
            {tokenAmtNum != null ? formatTokenAmount(tokenAmtNum) : "—"} tokens
          </span>
          {usdNum != null ? (
            <span className="text-white/60">≈ {formatUsd(usdNum)}</span>
          ) : null}
          {solNum != null && solNum > 0 ? (
            <span className="text-white/60">{solNum.toFixed(solNum >= 1 ? 2 : 4)} SOL</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/40">
          <span>{trade.label ?? shortAddr(trade.wallet)}</span>
          <span>·</span>
          <span>{prettyDex(trade.dexSource)}</span>
          <span>·</span>
          <span>{formatRelative(trade.blockTime)}</span>
        </div>
      </div>
    </li>
  );
}

function TrackingSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3"
        >
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/5" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-white/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatTokenAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function prettyDex(src: string | null): string {
  if (!src) return "DEX";
  return src
    .split("_")
    .map((s) => s[0] + s.slice(1).toLowerCase())
    .join(" ");
}

// Touch unused import to keep tree-shaking happy in case formatPercent is
// useful when we add a "price moved X% since trade" indicator later.
void formatPercent;
