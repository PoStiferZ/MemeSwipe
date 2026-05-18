/**
 * One-shot script: registers (or updates) the Helius "tracking" webhook
 * that POSTs SWAP events for the wallets the user follows to
 * /api/webhooks/helius-wallets.
 *
 * Run this once after deploying the Tracking feature. The webhook is
 * created with `accountAddresses: []` (or the current set if anything
 * is already in `tracked_wallets`); every subsequent add/remove in the
 * UI re-syncs the address list via `syncTrackingWebhookAddresses`.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/register-tracking-webhook.ts
 */
import postgres from "postgres";

const HELIUS_API = "https://api.helius.xyz/v0/webhooks";
const URL_SUFFIX = "/api/webhooks/helius-wallets";

type WebhookDto = {
  webhookID: string;
  webhookURL: string;
};

async function loadTrackedAddresses(): Promise<string[]> {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false });
  try {
    const rows = await sql<
      { tracked_wallet: string }[]
    >`SELECT DISTINCT tracked_wallet FROM tracked_wallets`;
    return rows.map((r) => r.tracked_wallet).filter(Boolean);
  } finally {
    await sql.end();
  }
}

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const auth = process.env.HELIUS_WEBHOOK_AUTH_TOKEN;
  if (!apiKey || !appUrl || !auth) {
    console.error(
      "Missing HELIUS_API_KEY / NEXT_PUBLIC_APP_URL / HELIUS_WEBHOOK_AUTH_TOKEN",
    );
    process.exit(1);
  }

  const webhookURL = `${appUrl.replace(/\/$/, "")}${URL_SUFFIX}`;
  const addresses = await loadTrackedAddresses();
  console.log(
    `[register-tracking-webhook] target URL: ${webhookURL} — seeding with ${addresses.length} addresses`,
  );

  const payload = {
    webhookURL,
    accountAddresses: addresses,
    transactionTypes: ["SWAP"],
    webhookType: "enhanced",
    authHeader: auth,
  };

  const list = (await fetch(`${HELIUS_API}?api-key=${apiKey}`).then((r) =>
    r.json(),
  )) as WebhookDto[];
  const existing = list.find((w) => w.webhookURL?.endsWith(URL_SUFFIX));

  const url = existing
    ? `${HELIUS_API}/${existing.webhookID}?api-key=${apiKey}`
    : `${HELIUS_API}?api-key=${apiKey}`;
  const method = existing ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(
      `[register-tracking-webhook] ${method} failed ${res.status}: ${await res.text()}`,
    );
    process.exit(1);
  }
  const body = await res.json();
  console.log(
    `[register-tracking-webhook] ${existing ? "updated" : "created"} ✔︎`,
    body,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
