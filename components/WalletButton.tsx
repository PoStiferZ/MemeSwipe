"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (publicKey) {
    const short = publicKey.toBase58().slice(0, 4) + "…" + publicKey.toBase58().slice(-4);
    return (
      <button
        onClick={disconnect}
        className="rounded-full border border-line bg-card px-3 py-1 text-xs"
        title="Disconnect"
      >
        {short}
      </button>
    );
  }
  return (
    <button
      onClick={() => setVisible(true)}
      disabled={connecting}
      className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black"
    >
      {connecting ? "…" : "Connect"}
    </button>
  );
}
