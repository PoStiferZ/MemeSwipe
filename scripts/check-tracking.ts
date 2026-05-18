import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const tracked = await sql`
      SELECT owner_wallet, tracked_wallet, label, created_at
      FROM tracked_wallets
      ORDER BY created_at DESC
    `;
    console.log(`\n=== tracked_wallets (${tracked.length}) ===`);
    for (const r of tracked) {
      console.log(
        ` - tracked=${r.tracked_wallet} label=${r.label ?? "—"} owner=${r.owner_wallet.slice(0, 6)}… at=${r.created_at.toISOString()}`,
      );
    }

    const tradesCount = await sql`SELECT count(*)::int AS n FROM wallet_trades`;
    console.log(`\n=== wallet_trades total: ${tradesCount[0].n} ===`);

    const recent = await sql`
      SELECT signature, wallet, direction, mint, dex_source, token_amount,
             sol_amount, usd_value, block_time, created_at
      FROM wallet_trades
      ORDER BY block_time DESC
      LIMIT 10
    `;
    console.log(`\n=== last 10 trades ===`);
    for (const r of recent) {
      console.log(
        ` - ${r.direction.toUpperCase()} ${r.dex_source ?? "?"} wallet=${r.wallet.slice(0, 6)}… mint=${r.mint.slice(0, 6)}… amt=${r.token_amount ?? "—"} usd=${r.usd_value ?? "—"} blockTime=${r.block_time?.toISOString?.() ?? r.block_time} sig=${r.signature.slice(0, 10)}…`,
      );
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
