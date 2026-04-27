"use client";

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

export function TokenCard({ token }: { token: ApiToken }) {
  const created = token.createdAt ? new Date(token.createdAt).getTime() : null;
  const migrated = new Date(token.migratedAt).getTime();
  const change6h = token.change6h ? Number(token.change6h) : null;
  const change24h = token.change24h ? Number(token.change24h) : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-line bg-card shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
      <div className="relative aspect-square w-full bg-black/40">
        {token.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.imageUrl}
            alt={token.ticker ?? token.mint}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-6xl text-white/20">?</div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
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
        <Stat label="Liquidity" value={formatUsd(token.liquidityUsd)} />
        <Stat label="Vol 24h" value={formatUsd(token.volume24h)} />
        <Stat label="Cre→Mig" value={formatDuration(created, migrated)} />
      </div>

      {token.description ? (
        <div className="px-4 pb-3 text-xs text-white/60 line-clamp-3">
          {token.description}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-4 pb-4">
        {token.socials &&
          Object.entries(token.socials)
            .filter(([, v]) => Boolean(v))
            .map(([k, v]) => (
              <a
                key={k}
                href={v as string}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-line bg-black/30 px-3 py-1 text-xs hover:bg-black/50"
              >
                <span className="mr-1">{SOCIAL_ICONS[k] ?? "🔗"}</span>
                {k}
              </a>
            ))}
        <a
          href={`https://dexscreener.com/solana/${token.mint}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded-full border border-line bg-black/30 px-3 py-1 text-xs hover:bg-black/50"
        >
          chart →
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
