import { SwipeView } from "@/components/SwipeView";
import { WalletGate } from "@/components/WalletGate";

export default function Home() {
  return (
    <main className="min-h-dvh">
      <WalletGate>
        <SwipeView />
      </WalletGate>
    </main>
  );
}
