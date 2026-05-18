/**
 * Helpers to manage the "tracking" Helius webhook from app code.
 *
 * Whenever the user adds or removes a tracked wallet, we re-PUT the
 * webhook with the up-to-date union of every address present in
 * `tracked_wallets`. The webhook ID is resolved once per process (by
 * listing the account's webhooks and matching the URL suffix) and then
 * cached in module-scope.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

const HELIUS_API = "https://api.helius.xyz/v0/webhooks";
const TRACKING_URL_SUFFIX = "/api/webhooks/helius-wallets";
// Helius enforces a hard cap of 100 addresses per webhook on the free plan.
// We surface an explicit error rather than letting the PUT silently fail.
const MAX_ADDRESSES = 100;

type WebhookDto = {
  webhookID: string;
  webhookURL: string;
  accountAddresses?: string[];
  transactionTypes?: string[];
};

let cachedWebhookId: string | null = null;

function apiKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY is not set");
  return k;
}

async function listWebhooks(): Promise<WebhookDto[]> {
  const res = await fetch(`${HELIUS_API}?api-key=${apiKey()}`);
  if (!res.ok) throw new Error(`helius list webhooks ${res.status}`);
  return (await res.json()) as WebhookDto[];
}

async function resolveTrackingWebhookId(): Promise<string | null> {
  if (cachedWebhookId) return cachedWebhookId;
  const all = await listWebhooks();
  const hit = all.find((w) => w.webhookURL?.endsWith(TRACKING_URL_SUFFIX));
  if (hit) {
    cachedWebhookId = hit.webhookID;
    return hit.webhookID;
  }
  return null;
}

/**
 * Recompute the union of all tracked wallet addresses and sync the
 * Helius webhook. Lazily CREATEs the webhook on the first add (Helius
 * requires ≥1 address at creation time), then PUTs on subsequent
 * changes. When the last wallet is removed, the webhook is DELETEd —
 * cleaner than leaving a phantom address behind.
 */
export async function syncTrackingWebhookAddresses(): Promise<{
  webhookId: string | null;
  addressCount: number;
  action: "created" | "updated" | "deleted" | "noop";
}> {
  const rows = await db
    .selectDistinct({ wallet: schema.trackedWallets.trackedWallet })
    .from(schema.trackedWallets);
  const addresses = rows.map((r) => r.wallet).filter(Boolean);

  if (addresses.length > MAX_ADDRESSES) {
    throw new Error(
      `Helius webhook caps at ${MAX_ADDRESSES} addresses (would be ${addresses.length}).`,
    );
  }

  const auth = process.env.HELIUS_WEBHOOK_AUTH_TOKEN;
  if (!auth) throw new Error("HELIUS_WEBHOOK_AUTH_TOKEN is not set");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");

  const webhookURL = `${appUrl.replace(/\/$/, "")}${TRACKING_URL_SUFFIX}`;
  const existingId = await resolveTrackingWebhookId();

  // Case 1: nothing to watch.
  if (addresses.length === 0) {
    if (!existingId) return { webhookId: null, addressCount: 0, action: "noop" };
    const res = await fetch(
      `${HELIUS_API}/${existingId}?api-key=${apiKey()}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`helius DELETE webhook ${res.status}: ${text.slice(0, 200)}`);
    }
    cachedWebhookId = null;
    return { webhookId: null, addressCount: 0, action: "deleted" };
  }

  // Case 2: addresses exist — create or update.
  const payload = {
    webhookURL,
    accountAddresses: addresses,
    transactionTypes: ["SWAP"],
    webhookType: "enhanced",
    authHeader: auth,
  };

  if (!existingId) {
    const res = await fetch(`${HELIUS_API}?api-key=${apiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`helius POST webhook ${res.status}: ${text.slice(0, 200)}`);
    }
    const created = (await res.json()) as { webhookID: string };
    cachedWebhookId = created.webhookID;
    return {
      webhookId: created.webhookID,
      addressCount: addresses.length,
      action: "created",
    };
  }

  const res = await fetch(`${HELIUS_API}/${existingId}?api-key=${apiKey()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Maybe the webhook was deleted from the Helius dashboard out-of-band.
    cachedWebhookId = null;
    throw new Error(`helius PUT webhook ${res.status}: ${text.slice(0, 200)}`);
  }
  return {
    webhookId: existingId,
    addressCount: addresses.length,
    action: "updated",
  };
}

/**
 * Read-only cached list of tracked wallets for hot-path use in the
 * webhook handler. Re-fetches every CACHE_MS, which is acceptable
 * because the only sources of change (add/remove via the UI) also call
 * `syncTrackingWebhookAddresses` synchronously — Helius won't start
 * pushing for an address before the PUT completes anyway.
 */
let trackedCache: { set: Set<string>; fetchedAt: number } | null = null;
const CACHE_MS = 60_000;

export async function getTrackedWalletsSet(): Promise<Set<string>> {
  if (trackedCache && Date.now() - trackedCache.fetchedAt < CACHE_MS) {
    return trackedCache.set;
  }
  const rows = await db
    .selectDistinct({ wallet: schema.trackedWallets.trackedWallet })
    .from(schema.trackedWallets);
  const set = new Set(rows.map((r) => r.wallet));
  trackedCache = { set, fetchedAt: Date.now() };
  return set;
}

/**
 * Used after add/remove to force the next webhook event to see the new
 * list without waiting for the 60s TTL.
 */
export function invalidateTrackedWalletsCache(): void {
  trackedCache = null;
}

// `selectDistinct` returns rows shaped like { wallet: string }, so the
// drizzle helper above does the dedup at the SQL level.
export const _sql = sql;
