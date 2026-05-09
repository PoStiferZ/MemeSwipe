"use client";

import { useState } from "react";
import type { ApiToken } from "@/lib/types";
import {
  formatDuration,
  formatInt,
  formatPercent,
  formatRelative,
  formatUsd,
  tokenChartUrl,
} from "@/lib/format";

const SOCIAL_ICONS: Record<string, string> = {
  twitter: "𝕏",
  telegram: "✈",
  website: "🌐",
  discord: "💬",
};

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
      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-card to-black/60">
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
        <a
          href={tokenChartUrl(token)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 active:scale-95"
          aria-label="Open on Axiom"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 14v7H3V3h7" />
          </svg>
        </a>

        <div className="absolute bottom-2 left-3 right-3">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight">
                ${token.ticker ?? "?"}
              </div>
              <div className="truncate text-xs text-white/70">
                {token.name ?? "Unknown"}
              </div>
            </div>
            <div className="flex shrink-0 items-stretch gap-1.5">
              <InfoChip label="MCAP" value={formatUsd(token.mcapUsd)} />
              <InfoChip label="ATH" value={formatUsd(token.athMcapUsd)} />
              <button
                onClick={copyCa}
                className={`flex flex-col items-center justify-center rounded-lg px-2 py-1 backdrop-blur-sm transition active:scale-95 ${
                  copied
                    ? "bg-like/30 text-like"
                    : "bg-black/60 text-white hover:bg-black/80"
                }`}
                title="Copy contract address"
              >
                <div className="text-[9px] font-medium uppercase leading-tight tracking-wide opacity-70">
                  {copied ? "Copied" : "CA"}
                </div>
                <div className="mt-0.5">
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
                </div>
              </button>
            </div>
          </div>
          <div className="mt-1.5 text-right text-[10px] text-white/50">
            migrated {formatRelative(token.migratedAt)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 px-3 pt-3 text-center">
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
        <Stat label="Liquidity" value={formatUsd(token.liquidityUsd)} />
        <Stat label="Vol 24h" value={formatUsd(token.volume24h)} />
        <Stat label="Cre→Mig" value={formatDuration(created, migrated)} />
      </div>

      {token.socials &&
      Object.values(token.socials).some(Boolean) ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          {Object.entries(token.socials)
            .filter(([, v]) => Boolean(v))
            .map(([k, v]) => (
              <a
                key={k}
                href={v as string}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full border border-line bg-black/30 px-2.5 py-1 text-[11px] hover:bg-black/50"
              >
                <span className="mr-0.5">{SOCIAL_ICONS[k] ?? "🔗"}</span>
                {k}
              </a>
            ))}
        </div>
      ) : null}

      <div className="px-3 pb-3 pt-2">
        <a
          href={tokenChartUrl(token)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2 text-xs font-semibold text-black active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 14v7H3V3h7" />
          </svg>
          Open on Axiom
        </a>
      </div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-black/60 px-2 py-1 backdrop-blur-sm">
      <div className="text-[9px] font-medium uppercase leading-tight tracking-wide text-white/60">
        {label}
      </div>
      <div className="text-xs font-semibold leading-tight">{value}</div>
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
    <div className="rounded-lg bg-black/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-white/50">{label}</div>
      <div
        className={
          "text-xs font-semibold leading-tight " +
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
