/**
 * Minimal Helius test: fetch recent PumpSwap signatures and find the
 * most recent `create_pool` (= a migrated token), using batch RPC.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/test-helius.ts
 */
import { PUMPSWAP_PROGRAM_ID } from "@/lib/sources/helius";
import { detectMigration } from "@/lib/sources/pumpswap";

const API_KEY = process.env.HELIUS_API_KEY;
if (!API_KEY) {
  console.error("HELIUS_API_KEY missing");
  process.exit(1);
}
const RPC = `https://mainnet.helius-rpc.com/?api-key=${API_KEY}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(body: unknown, label: string): Promise<unknown> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(20_000, 1000 * 2 ** attempt);
      console.log(`  ! ${label} HTTP ${res.status} — waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    console.log(`  → ${label} HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${label} exhausted retries`);
}

async function main() {
  console.log("1. Fetching last 100 PumpSwap signatures…");
  const sigsResp = (await postWithRetry(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [PUMPSWAP_PROGRAM_ID, { limit: 100 }],
    },
    "getSignaturesForAddress",
  )) as {
    result: { signature: string; slot: number; err: unknown; blockTime: number | null }[];
  };
  const sigs = sigsResp.result;
  const successful = sigs.filter((s) => !s.err);
  console.log(`   got ${sigs.length} (${successful.length} successful)`);
  console.log(`   newest: ${sigs[0]?.signature.slice(0, 20)}… ts=${sigs[0]?.blockTime}`);

  const PAUSE_MS = 1200;
  console.log(`\n2. Sequential getTransaction with ${PAUSE_MS}ms throttle (early-exit on first migration)…`);
  for (let i = 0; i < successful.length; i++) {
    const sig = successful[i].signature;
    const resp = (await postWithRetry(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          sig,
          {
            maxSupportedTransactionVersion: 0,
            encoding: "jsonParsed",
            commitment: "confirmed",
          },
        ],
      },
      `tx ${i + 1}/${successful.length}`,
    )) as { result: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = detectMigration(resp.result as any, sig);
    if (m) {
      console.log("\n✅ FOUND MIGRATION:");
      console.log("   mint:      ", m.mint);
      console.log("   pool:      ", m.poolAddress);
      console.log("   signature: ", m.signature);
      console.log("   blockTime: ", m.blockTime.toISOString());
      console.log("   slot:      ", m.slot);
      console.log(`\n   (scanned ${i + 1}/${successful.length} txs to find it)`);
      process.exit(0);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`\n❌ No migration found in those ${successful.length} txs (all swaps).`);
  console.log("   Try again — PumpSwap has many swaps per new pool.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
