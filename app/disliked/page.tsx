import { SwipesListView } from "@/components/SwipesListView";
import { WalletGate } from "@/components/WalletGate";

export default function DislikedPage() {
  return (
    <main className="min-h-dvh">
      <WalletGate>
        <SwipesListView kind="disliked" />
      </WalletGate>
    </main>
  );
}
