"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  isValidSolanaAddress,
  useEffectiveWallet,
} from "@/lib/client/wallet";

function shorten(addr: string) {
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

export function WalletButton() {
  const real = useWallet();
  const { setVisible } = useWalletModal();
  const { address, isReal, manual, setManual, clearManual } =
    useEffectiveWallet();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const submitManual = () => {
    const v = input.trim();
    if (!isValidSolanaAddress(v)) return;
    setManual(v);
    setInput("");
    setOpen(false);
  };

  const reset = () => {
    if (isReal) {
      real.disconnect().catch(() => undefined);
    } else {
      clearManual();
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={popRef}>
      {address ? (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isReal ? "bg-like" : "bg-accent"
            }`}
            title={isReal ? "Connected wallet" : "Manual address"}
          />
          {shorten(address)}
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-black"
        >
          Connect
        </button>
      )}

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-line bg-card p-3 shadow-lg">
          {address ? (
            <>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-white/40">
                {isReal ? "Connected wallet" : "Manual address"}
              </div>
              <div className="mb-3 break-all text-xs">{address}</div>
              <button
                onClick={reset}
                className="w-full rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/5"
              >
                {isReal ? "Disconnect" : "Clear address"}
              </button>
              {!isReal ? (
                <button
                  onClick={() => {
                    setOpen(false);
                    setVisible(true);
                  }}
                  className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black"
                >
                  Connect real wallet
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setOpen(false);
                  setVisible(true);
                }}
                className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black"
              >
                Connect wallet
              </button>
              <div className="my-3 flex items-center gap-2 text-[10px] uppercase text-white/30">
                <div className="h-px flex-1 bg-line" />
                or
                <div className="h-px flex-1 bg-line" />
              </div>
              <label className="block text-[10px] uppercase text-white/40">
                Enter address
              </label>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
                placeholder="Solana wallet address"
                spellCheck={false}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs outline-none focus:border-accent"
              />
              <button
                onClick={submitManual}
                disabled={!isValidSolanaAddress(input)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-xs disabled:opacity-40"
              >
                Use this address
              </button>
              {manual ? (
                <div className="mt-2 text-[10px] text-white/40">
                  Previous: {shorten(manual)}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
