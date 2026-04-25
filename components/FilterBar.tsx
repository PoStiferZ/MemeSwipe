"use client";

import { useState } from "react";
import type { Filters } from "@/lib/types";
import { WalletButton } from "./WalletButton";
import { formatUsd, formatInt } from "@/lib/format";

const MCAP_STEPS = [0, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const HOLDERS_STEPS = [0, 50, 100, 250, 500, 1_000, 5_000];
const DAYS_STEPS = [1, 3, 7, 14, 30, 45];

export function FilterBar({
  filters,
  onChange,
  onRefresh,
  refreshing,
  pendingCount,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onRefresh: () => void;
  refreshing: boolean;
  pendingCount: number | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">MemeSwipe</h1>
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto rounded-full border border-line px-3 py-1 text-xs"
          aria-expanded={open}
        >
          Filters {open ? "▴" : "▾"}
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="relative rounded-full border border-line bg-card px-3 py-1 text-xs"
        >
          {refreshing ? "…" : "Refresh"}
          {pendingCount != null && pendingCount > 0 ? (
            <span className="absolute -right-2 -top-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">
              +{pendingCount}
            </span>
          ) : null}
        </button>
        <WalletButton />
      </div>

      {open ? (
        <div className="grid grid-cols-1 gap-4 px-4 pb-4">
          <Slider
            label="Min mcap"
            value={filters.minMcap}
            steps={MCAP_STEPS}
            format={formatUsd}
            onChange={(v) => onChange({ ...filters, minMcap: v })}
          />
          <Slider
            label="Min holders"
            value={filters.minHolders}
            steps={HOLDERS_STEPS}
            format={formatInt}
            onChange={(v) => onChange({ ...filters, minHolders: v })}
          />
          <Slider
            label="Migrated within"
            value={filters.sinceDays}
            steps={DAYS_STEPS}
            format={(d) => `${d}d`}
            onChange={(v) => onChange({ ...filters, sinceDays: v })}
          />
        </div>
      ) : null}
    </header>
  );
}

function Slider({
  label,
  value,
  steps,
  format,
  onChange,
}: {
  label: string;
  value: number;
  steps: number[];
  format: (n: number) => string;
  onChange: (v: number) => void;
}) {
  const idx = Math.max(0, steps.indexOf(value));
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/60">{label}</span>
        <span className="font-semibold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={idx < 0 ? 0 : idx}
        onChange={(e) => onChange(steps[Number(e.target.value)])}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent"
      />
    </label>
  );
}
