"use client";

import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { isValidSolanaAddress, setManualWallet } from "@/lib/client/wallet";

export function LoginScreen() {
  const { setVisible } = useWalletModal();
  const [input, setInput] = useState("");
  const valid = isValidSolanaAddress(input);

  const submit = () => {
    if (!valid) return;
    setManualWallet(input.trim());
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-4xl font-extrabold tracking-tight">
            Meme<span className="text-accent">Swipe</span>
          </div>
          <div className="mt-2 text-sm text-white/50">
            Discover graduated PumpFun tokens
          </div>
        </div>

        <button
          onClick={() => setVisible(true)}
          className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold text-black active:scale-[0.98]"
        >
          Connect Wallet
        </button>

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-white/30">
          <div className="h-px flex-1 bg-line" />
          or use an address
          <div className="h-px flex-1 bg-line" />
        </div>

        <div className="space-y-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Solana wallet address"
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            className="w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={submit}
            disabled={!valid}
            className="w-full rounded-2xl border border-line bg-card py-3.5 text-sm font-semibold disabled:opacity-40"
          >
            Continue
          </button>
        </div>

        <p className="text-center text-[11px] text-white/30">
          Your address is stored locally and only used to track your swipes.
        </p>
      </div>
    </div>
  );
}
