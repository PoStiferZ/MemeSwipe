"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const KEY = "memeswipe.manual_wallet";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(addr: string): boolean {
  return BASE58.test(addr.trim());
}

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
function readManual(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setManualWallet(addr: string) {
  window.localStorage.setItem(KEY, addr.trim());
  notify();
}
export function clearManualWallet() {
  window.localStorage.removeItem(KEY);
  notify();
}

export function useEffectiveWallet() {
  const real = useWallet();
  const manual = useSyncExternalStore(subscribe, readManual, () => null);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) notify();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const realAddress = real.publicKey?.toBase58() ?? null;
  const address = realAddress ?? manual;
  return {
    address,
    realAddress,
    manual,
    isReal: realAddress != null,
    setManual: setManualWallet,
    clearManual: clearManualWallet,
  };
}
