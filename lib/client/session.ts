"use client";

export async function swipe(
  walletAddr: string,
  mint: string,
  action: "like" | "dislike",
) {
  if (!walletAddr) throw new Error("Wallet not connected");
  const res = await fetch("/api/swipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletAddr, mint, action }),
  });
  if (!res.ok) throw new Error(`Swipe failed: ${res.status}`);
  return res.json();
}
