import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const cols = await sql`
    select column_name, data_type, numeric_precision, numeric_scale
    from information_schema.columns
    where table_name = 'swipes' and column_name = 'mcap_at_swipe_usd'
  `;
  console.log("Column metadata:", cols[0] ?? "(missing)");

  const counts = await sql`
    select
      count(*)::int as total,
      count(mcap_at_swipe_usd)::int as with_mcap,
      count(*) filter (where action = 'like') ::int as likes_total,
      count(mcap_at_swipe_usd) filter (where action = 'like')::int as likes_with_mcap
    from swipes
  `;
  console.log("Counts:", counts[0]);

  const samples = await sql`
    select wallet, mint, action, mcap_at_swipe_usd, created_at
    from swipes
    where action = 'like'
    order by created_at desc
    limit 8
  `;
  console.log("\nLatest 8 likes:");
  for (const r of samples) {
    console.log(
      `  ${r.created_at?.toISOString?.()} mint=${String(r.mint).slice(0, 6)}…  entry=${r.mcap_at_swipe_usd ?? "NULL"}`,
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
