import { TrackingView } from "@/components/TrackingView";
import { WalletGate } from "@/components/WalletGate";

export default function TrackingPage() {
  return (
    <main className="min-h-dvh">
      <WalletGate>
        <TrackingView />
      </WalletGate>
    </main>
  );
}
