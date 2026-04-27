"use client";

import { useState } from "react";
import type { Filters } from "@/lib/types";
import { WalletButton } from "./WalletButton";
import { formatInt } from "@/lib/format";

const MCAP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Any" },
  { value: 10_000, label: "$10k" },
  { value: 50_000, label: "$50k" },
  { value: 100_000, label: "$100k" },
  { value: 250_000, label: "$250k" },
  { value: 500_000, label: "$500k" },
  { value: 1_000_000, label: "$1M" },
];
const HOLDERS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Any" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: 250, label: "250" },
  { value: 500, label: "500" },
  { value: 1_000, label: "1k" },
  { value: 5_000, label: "5k" },
];
const DAYS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "All" },
  { value: 1, label: "1d" },
  { value: 3, label: "3d" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
];

export function FilterBar({
  filters,
  onChange,
  onRefresh,
  refreshing,
  pendingCount,
  remaining,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onRefresh: () => void;
  refreshing: boolean;
  pendingCount: number | null;
  remaining: number | null;
}) {
  const [open, setOpen] = useState(false);
  const activeFilters =
    (filters.minMcap > 0 ? 1 : 0) +
    (filters.minHolders > 0 ? 1 : 0) +
    (filters.sinceDays > 0 ? 1 : 0);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">MemeSwipe</h1>
        {remaining != null ? (
          <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-white/70">
            {formatInt(remaining)} left
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="relative flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-sm"
            aria-label="Refresh"
            title="Fetch new migrations"
          >
            <span className={refreshing ? "animate-spin" : ""}>↻</span>
            {pendingCount != null && pendingCount > 0 ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1 text-[9px] font-bold text-black">
                +{pendingCount}
              </span>
            ) : null}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className={`relative flex h-8 items-center gap-1 rounded-full border px-3 text-xs ${
              activeFilters > 0
                ? "border-accent bg-accent/10 text-accent"
                : "border-line bg-card"
            }`}
            aria-expanded={open}
          >
            Filters
            {activeFilters > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-black">
                {activeFilters}
              </span>
            ) : null}
          </button>
          <WalletButton />
        </div>
      </div>

      {open ? (
        <div className="space-y-4 px-4 pb-4">
          <PillRow
            label="Min market cap"
            value={filters.minMcap}
            options={MCAP_OPTIONS}
            onChange={(v) => onChange({ ...filters, minMcap: v })}
          />
          <PillRow
            label="Min holders"
            value={filters.minHolders}
            options={HOLDERS_OPTIONS}
            onChange={(v) => onChange({ ...filters, minHolders: v })}
          />
          <PillRow
            label="Migrated within"
            value={filters.sinceDays}
            options={DAYS_OPTIONS}
            onChange={(v) => onChange({ ...filters, sinceDays: v })}
          />
          {activeFilters > 0 ? (
            <button
              onClick={() =>
                onChange({ minMcap: 0, minHolders: 0, sinceDays: 0 })
              }
              className="w-full rounded-full border border-line bg-card py-2 text-xs text-white/70"
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

function PillRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-white/50">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`min-h-[36px] rounded-full px-3 text-xs ${
                active
                  ? "bg-accent font-semibold text-black"
                  : "border border-line bg-card text-white/80 hover:bg-white/5"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
