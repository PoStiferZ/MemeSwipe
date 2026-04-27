/**
 * One-shot migration: add ath_mcap_usd column to tokens.
 * Backfills existing rows with current mcap_usd as a starting ATH.
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { prepare: false, max: 1 });
  await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS ath_mcap_usd numeric(20, 2)`;
  const updated = await sql`UPDATE tokens SET ath_mcap_usd = mcap_usd WHERE ath_mcap_usd IS NULL AND mcap_usd IS NOT NULL`;
  console.log(`✓ column added; ${updated.count} rows back-filled`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
