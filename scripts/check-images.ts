import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const [{ c: total }] = await sql`select count(*)::int as c from tokens`;
  const [{ c: noImg }] = await sql`select count(*)::int as c from tokens where image_url is null`;
  const [{ c: noUri }] = await sql`select count(*)::int as c from tokens where metadata_uri is null`;
  const [{ c: noImgWithUri }] = await sql`select count(*)::int as c from tokens where image_url is null and metadata_uri is not null`;
  const [{ c: noImgNoUri }] = await sql`select count(*)::int as c from tokens where image_url is null and metadata_uri is null`;

  console.log("Total tokens:        ", total);
  console.log("No image_url:        ", noImg);
  console.log("No metadata_uri:     ", noUri);
  console.log("No img, with URI:    ", noImgWithUri);
  console.log("No img, NO URI:      ", noImgNoUri);

  const samples = await sql`select mint, ticker, image_url, metadata_uri, migrated_at from tokens where image_url is null order by migrated_at desc limit 10`;
  console.log("\nSample missing-image tokens (newest first):");
  for (const r of samples) {
    console.log(`  ${String(r.ticker ?? "?").padEnd(12)} mint=${r.mint} uri=${r.metadata_uri ? "YES" : "NO"} migrated=${r.migrated_at?.toISOString?.() ?? r.migrated_at}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
