/**
 * One-shot script: registers (or updates) the Helius webhook that POSTs
 * Pump.fun migration events to /api/webhooks/helius.
 *
 * The migration `create_pool` instruction is a CPI from the Pump.fun V1
 * program — subscribing to that program and filtering by CREATE_POOL gives
 * us exactly the events we care about (and avoids the ~3000/20s firehose
 * of unrelated `claim_cashback` and other "ANY" transactions).
 *
 * Usage: pnpm register-webhook
 */

const PUMPFUN_V1_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const auth = process.env.HELIUS_WEBHOOK_AUTH_TOKEN;
  if (!apiKey || !appUrl || !auth) {
    console.error("Missing HELIUS_API_KEY / NEXT_PUBLIC_APP_URL / HELIUS_WEBHOOK_AUTH_TOKEN");
    process.exit(1);
  }

  const webhookURL = `${appUrl.replace(/\/$/, "")}/api/webhooks/helius`;
  const payload = {
    webhookURL,
    accountAddresses: [PUMPFUN_V1_PROGRAM_ID],
    transactionTypes: ["CREATE_POOL"],
    webhookType: "enhanced",
    authHeader: auth,
  };

  const list = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`).then(
    (r) => r.json() as Promise<{ webhookID: string; webhookURL: string }[]>,
  );
  const existing = list.find((w) => w.webhookURL === webhookURL);

  const url = existing
    ? `https://api.helius.xyz/v0/webhooks/${existing.webhookID}?api-key=${apiKey}`
    : `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`;
  const method = existing ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`[webhook] ${method} failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  console.log(`[webhook] ${existing ? "updated" : "created"} ✔︎`, body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
