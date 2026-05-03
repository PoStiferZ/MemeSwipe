import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { prepare: false, max: 1 });
  await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_uri text`;
  console.log("✓ metadata_uri column added");
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
