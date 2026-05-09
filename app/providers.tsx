"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useMemo, useState } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  // If the user already has a manual wallet address saved, the auto-connect
  // dance with Phantom/Solflare adds 1–3s of dead time on every page load
  // for no benefit. Skip it in that case.
  const [autoConnect] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return !window.localStorage.getItem("memeswipe.manual_wallet");
    } catch {
      return true;
    }
  });

  return (
    <QueryClientProvider client={client}>
      <ConnectionProvider endpoint={RPC_ENDPOINT}>
        <WalletProvider wallets={wallets} autoConnect={autoConnect}>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
