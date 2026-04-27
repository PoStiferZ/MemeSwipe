"use client";

import { useState } from "react";
import type { ApiToken } from "@/lib/types";
import {
  formatDuration,
  formatInt,
  formatPercent,
  formatRelative,
  formatUsd,
} from "@/lib/format";

const SOCIAL_ICONS: Record<string, string> = {
  twitter: "𝕏",
  telegram: "✈",
  website: "🌐",
  discord: "💬",
};

function shortenMint(m: string) {
  return m.slice(0, 4) + "…" + m.slice(-4);
}

export function TokenCard({ token }: { token: ApiToken }) {
  const created = token.createdAt ? new Date(token.createdAt).getTime() : null;
  const migrated = new Date(token.migratedAt).getTime();
  const change6h = token.change6h ? Number(token.change6h) : null;
  const change24h = token.change24h ? Number(token.change24h) : null;
  const [copied, setCopied] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const copyCa = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(token.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-line bg-card shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
      <div className="relative aspect-square w-full bg-gradient-to-br from-card to-black/60">
        {token.imageUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.imageUrl}
            alt={token.ticker ?? token.mint}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/30">
            <div className="text-5xl font-extrabold tracking-tight text-white/40">
              ${token.ticker ?? "?"}
            </div>
            <div className="text-xs uppercase tracking-wider">no image</div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <a
          href={`https://dexscreener.com/solana/${token.mint}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 active:scale-95"
          aria-label="Open on DexScreener"
          title="Open on DexScreener"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 14v7H3V3h7" />
          </svg>
        </a>
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold leading-none">
              ${token.ticker ?? "?"}
            </div>
            <div className="mt-1 text-sm text-white/70 truncate max-w-[18ch]">
              {token.name ?? "Unknown"}
            </div>
          </div>
          <div className="text-right text-xs text-white/60">
            migrated {formatRelative(token.migratedAt)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4 text-center text-xs">
        <Stat label="MCAP" value={formatUsd(token.mcapUsd)} />
        <Stat label="ATH MCAP" value={formatUsd(token.athMcapUsd)} />
        <Stat label="Holders" value={formatInt(token.holdersCount)} />
        <Stat
          label="6h"
          value={formatPercent(change6h)}
          tone={tone(change6h)}
        />
        <Stat
          label="24h"
          value={formatPercent(change24h)}
          tone={tone(change24h)}
        />
        <Stat label="Vol 24h" value={formatUsd(token.volume24h)} />
        <Stat label="Liquidity" value={formatUsd(token.liquidityUsd)} />
        <Stat label="Cre→Mig" value={formatDuration(created, migrated)} />
        <button
          onClick={copyCa}
          className={`group rounded-xl p-2 transition active:scale-[0.97] ${
            copied
              ? "bg-like/15 text-like"
              : "bg-black/30 text-white hover:bg-black/50"
          }`}
          title="Copy contract address"
        >
          <div className="text-[10px] uppercase tracking-wide text-white/50 group-hover:text-white/70">
            {copied ? "Copied!" : "Copy CA"}
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold">
            {copied ? (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {shortenMint(token.mint)}
          </div>
        </button>
      </div>

      {token.description ? (
        <div className="px-4 pb-3 text-xs text-white/60 line-clamp-3">
          {token.description}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        {token.socials &&
          Object.entries(token.socials)
            .filter(([, v]) => Boolean(v))
            .map(([k, v]) => (
              <a
                key={k}
                href={v as string}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full border border-line bg-black/30 px-3 py-1.5 text-xs hover:bg-black/50"
              >
                <span className="mr-1">{SOCIAL_ICONS[k] ?? "🔗"}</span>
                {k}
              </a>
            ))}
      </div>

      <div className="px-4 pb-4">
        <a
          href={`https://dexscreener.com/solana/${token.mint}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-xs font-semibold text-black active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 14v7H3V3h7" />
          </svg>
          Open on DexScreener
        </a>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-xl bg-black/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-white/50">{label}</div>
      <div
        className={
          "mt-0.5 text-sm font-semibold " +
          (tone === "up" ? "text-like" : tone === "down" ? "text-dislike" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

function tone(n: number | null): "up" | "down" | undefined {
  if (n == null) return undefined;
  if (n > 0) return "up";
  if (n < 0) return "down";
  return undefined;
}
