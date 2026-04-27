import { SwipesListView } from "@/components/SwipesListView";
import { WalletGate } from "@/components/WalletGate";

export default function LikedPage() {
  return (
    <main className="min-h-dvh">
      <WalletGate>
        <SwipesListView kind="liked" />
      </WalletGate>
    </main>
  );
}
