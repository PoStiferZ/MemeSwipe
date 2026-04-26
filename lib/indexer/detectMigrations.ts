import {
  PUMPSWAP_PROGRAM_ID,
  getParsedTransactions,
  getSignaturesUntil,
  type SignatureInfo,
} from "@/lib/sources/helius";
import { detectMigration, type DetectedMigration } from "@/lib/sources/pumpswap";

/**
 * Walk PumpSwap program signatures back to `untilTs` (unix seconds), parse the
 * transactions in batches, and yield migration records.
 */
export async function findMigrationsSince(
  untilTs: number,
): Promise<DetectedMigration[]> {
  const sigs = await getSignaturesUntil(PUMPSWAP_PROGRAM_ID, untilTs);
  return await parseMigrations(sigs);
}

export async function parseMigrations(
  sigs: SignatureInfo[],
): Promise<DetectedMigration[]> {
  const out: DetectedMigration[] = [];
  const successful = sigs.filter((s) => !s.err);
  console.log(`[parse] ${successful.length} successful txs to inspect…`);
  const batchSize = 50;
  for (let i = 0; i < successful.length; i += batchSize) {
    const batch = successful.slice(i, i + batchSize);
    const txs = await getParsedTransactions(batch.map((s) => s.signature));
    txs.forEach((tx, idx) => {
      const m = detectMigration(tx, batch[idx].signature);
      if (m) out.push(m);
    });
    console.log(
      `[parse] ${Math.min(i + batchSize, successful.length)}/${successful.length} (found ${out.length} migrations so far)`,
    );
  }
  return out;
}
