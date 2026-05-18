/**
 * Quick on-chain activity probe: for each tracked wallet, asks Helius
 * Enhanced API for the last 10 parsed transactions and counts SWAPs.
 * If a wallet has SWAPs more recent than its created_at in
 * `tracked_wallets`, Helius *should* have pushed them — silence in the
 * DB then points to a webhook handler issue.
 */
import postgres from "postgres";

const HELIUS_BASE = "https://api.helius.xyz/v0";

type Tx = { type?: string; timestamp?: number; signature?: string };

async function main() {
  const apiKey = process.env.HELIUS_API_KEY!;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = await sql<{ tracked_wallet: string; label: string | null; created_at: Date }[]>`
      SELECT tracked_wallet, label, created_at FROM tracked_wallets
    `;

    for (const r of rows) {
      const url = `${HELIUS_BASE}/addresses/${r.tracked_wallet}/transactions?api-key=${apiKey}&limit=20`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`\n[${r.label}] HELIUS ${res.status}: ${await res.text()}`);
        continue;
      }
      const txs = (await res.json()) as Tx[];
      const sinceAdd = txs.filter(
        (t) => (t.timestamp ?? 0) * 1000 >= r.created_at.getTime(),
      );
      const swaps = sinceAdd.filter((t) => t.type === "SWAP");
      console.log(`\n[${r.label} ${r.tracked_wallet.slice(0, 6)}…]`);
      console.log(
        `  tracked since: ${r.created_at.toISOString()}  |  last 20 tx fetched, ${sinceAdd.length} since add, ${swaps.length} SWAPs`,
      );
      for (const t of swaps.slice(0, 5)) {
        console.log(
          `    SWAP ts=${new Date((t.timestamp ?? 0) * 1000).toISOString()} sig=${t.signature?.slice(0, 12)}…`,
        );
      }
      // Also show the most recent tx types so we know if Helius parses them.
      const recentTypes = txs.slice(0, 10).map((t) => t.type ?? "?");
      console.log(`  recent types: ${recentTypes.join(", ")}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
