"use client";

import { useEffect, useState } from "react";
import { useEffectiveWallet } from "@/lib/client/wallet";
import { LoginScreen } from "./LoginScreen";

export function WalletGate({ children }: { children: React.ReactNode }) {
  const { address } = useEffectiveWallet();
  // Avoid SSR/CSR mismatch: localStorage is only readable client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (!address) return <LoginScreen />;
  return <>{children}</>;
}
