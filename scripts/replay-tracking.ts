/**
 * Pull a real recent SWAP for one of our tracked wallets via Helius's
 * parsed-tx endpoint and run it through `extractTradesFromSwap` exactly
 * like the webhook handler does. Tells us whether the parser fails (→
 * code bug) or succeeds (→ pipeline issue beyond parsing).
 */
import { extractTradesFromSwap, type HeliusSwapEvent } from "../lib/sources/helius-swap";

const CRISSY = "7FJDJ1HaQfL3GAcMCzoBrJ9Accnf5GUYYwfEPCBCDcVK";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY!;
  const res = await fetch(
    `https://api.helius.xyz/v0/addresses/${CRISSY}/transactions?api-key=${apiKey}&type=SWAP&limit=3`,
  );
  if (!res.ok) {
    console.error("helius", res.status, await res.text());
    process.exit(1);
  }
  const txs = (await res.json()) as HeliusSwapEvent[];
  console.log(`Got ${txs.length} parsed SWAP tx(s) for Crissy`);

  const tracked = new Set([CRISSY]);
  for (const tx of txs) {
    console.log(`\n=== sig=${tx.signature?.slice(0, 14)}… source=${tx.source} ===`);
    console.log("  feePayer:", tx.feePayer);
    console.log("  events.swap keys:", Object.keys(tx.events?.swap ?? {}));
    const swap = tx.events?.swap;
    if (swap) {
      console.log("  nativeInput:", swap.nativeInput);
      console.log("  nativeOutput:", swap.nativeOutput);
      console.log(
        "  tokenInputs:",
        swap.tokenInputs?.map((t) => ({
          userAccount: t.userAccount,
          mint: t.mint,
          amount: t.rawTokenAmount?.tokenAmount,
        })),
      );
      console.log(
        "  tokenOutputs:",
        swap.tokenOutputs?.map((t) => ({
          userAccount: t.userAccount,
          mint: t.mint,
          amount: t.rawTokenAmount?.tokenAmount,
        })),
      );
    }
    console.log(
      "  tokenTransfers (raw):",
      (tx.tokenTransfers ?? []).slice(0, 4).map((t) => ({
        from: t.fromUserAccount,
        to: t.toUserAccount,
        mint: t.mint,
        amount: t.tokenAmount,
      })),
    );
    const trades = extractTradesFromSwap(tx, tracked);
    console.log("  → extracted trades:", trades);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
