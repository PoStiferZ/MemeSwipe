"use client";

import { useMemo, useState } from "react";
import type { ApiToken } from "@/lib/types";
import { formatPercent, formatRelative, formatUsd } from "@/lib/format";
import { isCanonicalImageUrl } from "@/lib/sources/helius";

type Props = {
  tokens: ApiToken[];
  totalRemaining: number | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  isFetching: boolean;
  onSwipe: (token: ApiToken, action: "like" | "dislike") => void;
  onRefreshBulk: (visible: ApiToken[]) => Promise<void>;
  sortDir: "desc" | "asc";
  onSortChange: (dir: "desc" | "asc") => void;
};

export function SwipeList({
  tokens,
  totalRemaining,
  page,
  pageSize,
  onPageChange,
  isFetching,
  onSwipe,
  onRefreshBulk,
  sortDir,
  onSortChange,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);

  // Counts rows whose `image_url` isn't in the canonical raw form — exactly
  // the rows the refresh button will re-resolve.
  const missingImages = useMemo(
    () => tokens.filter((t) => !isCanonicalImageUrl(t.imageUrl)).length,
    [tokens],
  );

  const totalPages = totalRemaining
    ? Math.max(1, Math.ceil(totalRemaining / pageSize))
    : 1;

  const refreshImages = async () => {
    if (refreshing || tokens.length === 0) return;
    setRefreshing(true);
    try {
      await onRefreshBulk(tokens);
    } finally {
      setRefreshing(false);
    }
  };

  if (tokens.length === 0 && !isFetching) {
    return (
      <div className="mt-20 text-center text-white/50">
        Plus de tokens pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-white/40">
          Migrated
        </span>
        <button
          onClick={() => onSortChange("desc")}
          className={`rounded-full px-2.5 py-1 text-[11px] ${
            sortDir === "desc"
              ? "bg-accent font-semibold text-black"
              : "border border-line bg-card text-white/70"
          }`}
        >
          Newest first
        </button>
        <button
          onClick={() => onSortChange("asc")}
          className={`rounded-full px-2.5 py-1 text-[11px] ${
            sortDir === "asc"
              ? "bg-accent font-semibold text-black"
              : "border border-line bg-card text-white/70"
          }`}
        >
          Oldest first
        </button>
        <button
          onClick={refreshImages}
          disabled={refreshing || tokens.length === 0}
          className={`ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] disabled:opacity-40 ${
            missingImages > 0
              ? "border border-accent bg-accent/10 text-accent"
              : "border border-line bg-card text-white/70"
          }`}
          title={
            missingImages > 0
              ? `${missingImages} missing — refresh all visible`
              : "Refresh all visible images"
          }
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {refreshing
            ? "Refreshing…"
            : missingImages > 0
              ? `Refresh (${missingImages} missing)`
              : "Refresh"}
        </button>
      </div>

      {isFetching ? (
        <div className="py-8 text-center text-xs text-white/40">Loading…</div>
      ) : (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <Row key={t.mint} token={t} onSwipe={onSwipe} />
          ))}
        </ul>
      )}

      <Pager
        page={page}
        totalPages={totalPages}
        onChange={onPageChange}
        disabled={isFetching}
      />
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  disabled?: boolean;
}) {
  if (totalPages <= 1) return null;
  // Build a window of page numbers around current: 1 … (page-1) page (page+1) … N
  const pages = pageWindow(page, totalPages);
  return (
    <div className="flex items-center justify-center gap-1 pt-3">
      <PagerBtn
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        aria="Previous page"
      >
        ‹
      </PagerBtn>
      {pages.map((p, idx) =>
        p === "…" ? (
          <span key={`gap-${idx}`} className="px-1 text-white/30">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            disabled={disabled}
            className={`min-w-[34px] rounded-full px-2 py-1 text-xs ${
              p === page
                ? "bg-accent font-semibold text-black"
                : "border border-line bg-card text-white/70"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <PagerBtn
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        aria="Next page"
      >
        ›
      </PagerBtn>
    </div>
  );
}

function PagerBtn({
  children,
  onClick,
  disabled,
  aria,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  aria: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-sm text-white/70 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

function Row({
  token,
  onSwipe,
}: {
  token: ApiToken;
  onSwipe: (token: ApiToken, action: "like" | "dislike") => void;
}) {
  const onRowClick = () =>
    window.open(
      `https://dexscreener.com/solana/${token.mint}`,
      "_blank",
      "noopener,noreferrer",
    );
  const change1h = token.change2h == null ? null : Number(token.change2h);
  const change24h = token.change24h == null ? null : Number(token.change24h);

  return (
    <li
      onClick={onRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick();
        }
      }}
      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-card p-3 transition hover:border-white/20 active:scale-[0.99]"
    >
      {token.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={token.imageUrl}
          alt={token.ticker ?? token.mint}
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
        <div className="truncate font-semibold">
          ${token.ticker ?? "?"}{" "}
          <span className="text-xs font-normal text-white/50">
            {token.name}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Pill tone="neutral">{formatUsd(token.mcapUsd)}</Pill>
          <ChangePill label="1h" value={change1h} />
          <ChangePill label="24h" value={change24h} />
        </div>
        <div className="mt-1 text-[10px] text-white/40">
          migrated {formatRelative(token.migratedAt)}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSwipe(token, "like");
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-like/40 bg-like/10 text-like hover:bg-like/25 active:scale-90"
          aria-label="Like"
          title="Like"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 21s-7-4.534-9.193-9.066C1.62 9.5 2.97 6 6.36 6c1.97 0 3.32 1.16 4.14 2.4.21.32.69.32.9 0C12.22 7.16 13.57 6 15.54 6c3.39 0 4.74 3.5 3.55 5.934C19.0 16.466 12 21 12 21z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSwipe(token, "dislike");
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-dislike/40 bg-dislike/10 text-dislike hover:bg-dislike/25 active:scale-90"
          aria-label="Dislike"
          title="Dislike"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </li>
  );
}

function Pill({
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
  value: number | null;
}) {
  const tone: "up" | "down" | "neutral" =
    value == null || value === 0 ? "neutral" : value > 0 ? "up" : "down";
  return (
    <Pill tone={tone}>
      <span className="mr-0.5 opacity-60">{label}</span>
      {formatPercent(value)}
    </Pill>
  );
}
