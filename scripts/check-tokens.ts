import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const tickers = ["ORC", "May4tl", "DUKE", "RNUT", "GOLD", "VINCENT", "LUCY", "DOGE"];
  for (const t of tickers) {
    const rows = await sql`select mint, ticker, name, image_url, metadata_uri, migrated_at, last_indexed_at from tokens where ticker = ${t} order by migrated_at desc limit 3`;
    if (!rows.length) {
      console.log(`[${t}] no rows`);
      continue;
    }
    for (const r of rows) {
      console.log(`[${r.ticker}] mint=${r.mint}`);
      console.log(`         image_url=${r.image_url ?? "NULL"}`);
      console.log(`         metadata_uri=${r.metadata_uri ?? "NULL"}`);
      console.log(`         migrated=${r.migrated_at?.toISOString?.()} indexed=${r.last_indexed_at?.toISOString?.()}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
