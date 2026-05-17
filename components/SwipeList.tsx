"use client";

import type { ApiToken } from "@/lib/types";
import { formatPercent, formatRelative, formatUsd, tokenChartUrl } from "@/lib/format";

type Props = {
  tokens: ApiToken[];
  totalRemaining: number | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  isFetching: boolean;
  onSwipe: (token: ApiToken, action: "like" | "dislike") => void;
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
  sortDir,
  onSortChange,
}: Props) {
  const totalPages = totalRemaining
    ? Math.max(1, Math.ceil(totalRemaining / pageSize))
    : 1;

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
      </div>

      {/*
        Render the rows even while a background refetch is happening.
        That's the whole point of optimistic updates — the swiped row is
        already gone from the cache, so showing a loading spinner here
        would just blank the page during the next paint.
      */}
      {tokens.length === 0 && isFetching ? (
        <ListSkeleton />
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
        disabled={false}
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
    window.open(tokenChartUrl(token), "_blank", "noopener,noreferrer");
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
          <Socials socials={token.socials} />
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
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
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
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function Socials({ socials }: { socials: ApiToken["socials"] }) {
  if (!socials) return null;
  const items: { key: string; href: string; label: string; glyph: string }[] = [];
  if (socials.twitter) items.push({ key: "twitter", href: socials.twitter, label: "Twitter", glyph: "𝕏" });
  if (socials.telegram) items.push({ key: "telegram", href: socials.telegram, label: "Telegram", glyph: "✈" });
  if (socials.website) items.push({ key: "website", href: socials.website, label: "Website", glyph: "🌐" });
  if (socials.discord) items.push({ key: "discord", href: socials.discord, label: "Discord", glyph: "💬" });
  if (items.length === 0) return null;
  return (
    <span className="ml-0.5 inline-flex items-center gap-1">
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={it.label}
          title={it.label}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-[11px] text-white/70 hover:bg-black/60 hover:text-white"
        >
          {it.glyph}
        </a>
      ))}
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

function ListSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3"
        >
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/5" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-4 w-1/3 animate-pulse rounded bg-white/10" />
            <div className="flex gap-1">
              <div className="h-4 w-14 animate-pulse rounded-full bg-white/5" />
              <div className="h-4 w-12 animate-pulse rounded-full bg-white/5" />
              <div className="h-4 w-12 animate-pulse rounded-full bg-white/5" />
            </div>
            <div className="h-3 w-1/4 animate-pulse rounded bg-white/5" />
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="h-9 w-9 animate-pulse rounded-full bg-like/15" />
            <div className="h-9 w-9 animate-pulse rounded-full bg-dislike/15" />
          </div>
        </li>
      ))}
    </ul>
  );
}
