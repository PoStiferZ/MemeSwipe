export {};

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set");
    process.exit(1);
  }
  const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`);
  if (!res.ok) {
    console.error("list failed", res.status, await res.text());
    process.exit(1);
  }
  const list = (await res.json()) as Array<{
    webhookID: string;
    webhookURL: string;
    transactionTypes?: string[];
    accountAddresses?: string[];
    webhookType?: string;
  }>;
  console.log(`=== ${list.length} webhook(s) ===`);
  for (const w of list) {
    console.log("\n---");
    console.log("id:", w.webhookID);
    console.log("url:", w.webhookURL);
    console.log("type:", w.webhookType);
    console.log("txTypes:", w.transactionTypes);
    console.log("addresses:", w.accountAddresses?.length, "→", w.accountAddresses);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
