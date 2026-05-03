import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const cid = "bafkreigxoxi3a6nnafuk6emshgzh4fmjluq4ofhcbhfbqm45u7b4fp5k6a";
  const rows = await sql`
    select mint, ticker, image_url, metadata_uri, last_indexed_at
    from tokens
    where image_url like ${"%" + cid + "%"} or metadata_uri like ${"%" + cid + "%"}
  `;
  console.log(`Found ${rows.length} rows containing CID`);
  for (const r of rows) {
    console.log(`  ticker=${r.ticker}`);
    console.log(`  image_url   =${r.image_url}`);
    console.log(`  metadata_uri=${r.metadata_uri}`);
    console.log(`  indexed     =${r.last_indexed_at?.toISOString?.()}`);
  }

  const stillWrapped = await sql`
    select count(*)::int as c from tokens
    where image_url like 'https://cdn.helius-rpc.com/%'
  `;
  console.log(`\nRows still wrapped with Helius CDN: ${stillWrapped[0].c}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
