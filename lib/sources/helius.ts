/**
 * Helius RPC + DAS + Webhooks helpers.
 * Docs: https://www.helius.dev/docs
 */

const API_KEY = process.env.HELIUS_API_KEY;

function rpcUrl() {
  if (!API_KEY) throw new Error("HELIUS_API_KEY is not set");
  return `https://mainnet.helius-rpc.com/?api-key=${API_KEY}`;
}

export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(
  method: string,
  params: unknown[] | Record<string, unknown>,
): Promise<T> {
  let attempt = 0;
  while (true) {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(`Helius ${method} ${res.status} after retries`);
      const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
      await sleep(backoff);
      attempt++;
      continue;
    }
    if (!res.ok) throw new Error(`Helius ${method} ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`Helius ${method}: ${body.error.message}`);
    return body.result as T;
  }
}

export type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

/**
 * Page through signatures for an address (program or mint), newest first.
 * Stops when `untilTs` (unix seconds) is reached.
 */
const THROTTLE_MS = Number(process.env.HELIUS_THROTTLE_MS ?? 1200);

export async function getSignaturesUntil(
  address: string,
  untilTs: number,
  pageLimit = 1000,
): Promise<SignatureInfo[]> {
  const out: SignatureInfo[] = [];
  let before: string | undefined;
  while (true) {
    const page = await rpc<SignatureInfo[]>("getSignaturesForAddress", [
      address,
      { limit: pageLimit, before },
    ]);
    if (!page.length) break;
    for (const sig of page) {
      if (sig.blockTime && sig.blockTime < untilTs) return out;
      out.push(sig);
    }
    before = page[page.length - 1]?.signature;
    if (!before) break;
    await sleep(THROTTLE_MS);
  }
  return out;
}

export type ParsedTransaction = {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
  meta: {
    err: unknown;
    logMessages?: string[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
  } | null;
};

export type ParsedInstruction = {
  programId: string;
  program?: string;
  parsed?: { type: string; info: Record<string, unknown> };
  accounts?: string[];
  data?: string;
};

export async function getParsedTransactions(
  signatures: string[],
): Promise<(ParsedTransaction | null)[]> {
  const out: (ParsedTransaction | null)[] = [];
  for (let i = 0; i < signatures.length; i++) {
    const tx = await rpc<ParsedTransaction | null>("getTransaction", [
      signatures[i],
      {
        maxSupportedTransactionVersion: 0,
        encoding: "jsonParsed",
        commitment: "confirmed",
      },
    ]);
    out.push(tx);
    if (i < signatures.length - 1) await sleep(THROTTLE_MS);
  }
  return out;
}

export type DasAsset = {
  id: string;
  content?: {
    json_uri?: string;
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
    };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string; mime?: string; type?: string }[];
  };
  token_info?: {
    symbol?: string;
    decimals?: number;
    supply?: number;
  };
};

/**
 * Pick the most reliable image URL from a DAS asset:
 * 1. Helius CDN-cached image (fast, CORS-friendly, never broken)
 * 2. DAS metadata "links.image"
 * 3. First image file's URI
 */
export function pickAssetImage(asset: DasAsset | null): string | null {
  if (!asset?.content) return null;
  const files = asset.content.files ?? [];
  const imageFile = files.find(
    (f) =>
      (f.mime ?? f.type ?? "").startsWith("image") ||
      Boolean(f.cdn_uri) ||
      Boolean(f.uri),
  );
  return (
    imageFile?.cdn_uri ??
    asset.content.links?.image ??
    imageFile?.uri ??
    null
  );
}

export async function getAsset(mint: string): Promise<DasAsset | null> {
  // Helius DAS methods take a single object param (not the JSON-RPC array shape).
  return rpc<DasAsset | null>("getAsset", { id: mint });
}

export async function getHoldersCount(mint: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  while (true) {
    const page = await rpc<{
      total: number;
      limit: number;
      cursor?: string;
      token_accounts: { address: string; amount: number }[];
    }>("getTokenAccounts", {
      mint,
      limit: 1000,
      cursor,
      options: { showZeroBalance: false },
    });
    total += page.token_accounts.filter((a) => a.amount > 0).length;
    cursor = page.cursor;
    if (!cursor || page.token_accounts.length < 1000) break;
    if (total > 50_000) break; // safety cap
  }
  return total;
}

/**
 * Fetch the first transaction signature for a mint to derive its on-chain
 * creation timestamp.
 */
export async function getMintCreationTime(mint: string): Promise<Date | null> {
  let before: string | undefined;
  let oldest: SignatureInfo | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await rpc<SignatureInfo[]>("getSignaturesForAddress", [
      mint,
      { limit: 1000, before },
    ]);
    if (!page.length) break;
    oldest = page[page.length - 1];
    if (page.length < 1000) break;
    before = oldest.signature;
  }
  if (!oldest?.blockTime) return null;
  return new Date(oldest.blockTime * 1000);
}
