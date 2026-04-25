"use client";

import bs58 from "bs58";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { LoginMessage } from "@/lib/auth/verifySignature";
import { buildLoginMessage } from "@/lib/auth/verifySignature";

const STORAGE_KEY = "memeswipe.session";
const SESSION_TTL_MS = 23 * 60 * 60_000; // 23h, refresh before server expiry (24h)

type Session = {
  wallet: string;
  message: LoginMessage;
  signature: string; // base58
};

function load(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (Date.now() - s.message.issuedAt > SESSION_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}

function save(s: Session) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

export async function getOrCreateSession(
  wallet: WalletContextState,
): Promise<Session> {
  if (!wallet.publicKey || !wallet.signMessage) {
    throw new Error("Wallet not connected");
  }
  const walletAddr = wallet.publicKey.toBase58();
  const cached = load();
  if (cached && cached.wallet === walletAddr) return cached;

  const message = buildLoginMessage(window.location.host);
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  const signature = await wallet.signMessage(encoded);
  const session: Session = {
    wallet: walletAddr,
    message,
    signature: bs58.encode(signature),
  };
  save(session);
  return session;
}

export async function authedSwipe(
  wallet: WalletContextState,
  mint: string,
  action: "like" | "dislike",
) {
  const session = await getOrCreateSession(wallet);
  const res = await fetch("/api/swipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: session.wallet,
      mint,
      action,
      message: session.message,
      signature: session.signature,
    }),
  });
  if (res.status === 401) {
    clearSession();
    throw new Error("Session expired, please sign again");
  }
  if (!res.ok) throw new Error(`Swipe failed: ${res.status}`);
  return res.json();
}
