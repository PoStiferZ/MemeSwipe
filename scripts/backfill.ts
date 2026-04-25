import { findMigrationsSince } from "@/lib/indexer/detectMigrations";
import { backfillSlowFields, buildTokenRow, upsertToken } from "@/lib/indexer/enrichToken";

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 45;
  const untilTs = Math.floor(Date.now() / 1000) - days * 86400;
  console.log(`[backfill] scanning PumpSwap migrations of the last ${days}d…`);

  const migrations = await findMigrationsSince(untilTs);
  console.log(`[backfill] detected ${migrations.length} migrations`);

  let i = 0;
  for (const m of migrations) {
    i++;
    try {
      const row = await buildTokenRow(m);
      await upsertToken(row);
      if (i % 50 === 0) console.log(`[backfill] upserted ${i}/${migrations.length}`);
    } catch (err) {
      console.error(`[backfill] failed ${m.mint}:`, (err as Error).message);
    }
  }
  console.log(`[backfill] core data done. Filling holders + creation time…`);

  for (let j = 0; j < migrations.length; j++) {
    try {
      await backfillSlowFields(migrations[j].mint);
      if ((j + 1) % 25 === 0) console.log(`[backfill] slow fields ${j + 1}/${migrations.length}`);
    } catch (err) {
      console.error(`[backfill] slow ${migrations[j].mint}:`, (err as Error).message);
    }
  }
  console.log(`[backfill] done`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
