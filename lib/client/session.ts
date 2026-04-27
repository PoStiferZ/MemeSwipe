"use client";

import type { WalletContextState } from "@solana/wallet-adapter-react";

export async function swipe(
  wallet: WalletContextState,
  mint: string,
  action: "like" | "dislike",
) {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const res = await fetch("/api/swipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: wallet.publicKey.toBase58(),
      mint,
      action,
    }),
  });
  if (!res.ok) throw new Error(`Swipe failed: ${res.status}`);
  return res.json();
}
