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
  // Token-2022 stores metadata inside the mint via the TokenMetadata extension;
  // DAS surfaces it here.
  mint_extensions?: {
    metadata?: {
      uri?: string;
      mint?: string;
      name?: string;
      symbol?: string;
    };
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

/**
 * Wrap a raw image URL with the Helius CDN (CF Image proxy) so it loads
 * fast & reliably even when the source is a slow IPFS gateway.
 */
function viaHeliusCdn(url: string | null): string | null {
  if (!url) return null;
  if (url.includes("cdn.helius-rpc.com")) return url;
  return `https://cdn.helius-rpc.com/cdn-cgi/image//${url}`;
}

export type TokenMetadata = {
  imageUrl: string | null;
  name: string | null;
  symbol: string | null;
  description: string | null;
  socials: {
    twitter?: string;
    telegram?: string;
    website?: string;
    discord?: string;
  };
  metadataUri?: string | null;
};

/**
 * The single official image-resolution path:
 *   1. DAS getAsset → extract the canonical Metaplex metadata URI
 *      (works for legacy Metaplex AND Token-2022 mint extensions).
 *   2. Fetch the JSON at that URI → read its `image` field.
 *   3. Return everything (image, name, symbol, description, socials, URI).
 *
 * The URI is returned so the caller can persist it; future refreshes can
 * skip the DAS call entirely and just refetch the JSON.
 */
export async function fetchTokenMetadata(
  mint: string,
): Promise<TokenMetadata> {
  const asset = await getAsset(mint).catch(() => null);
  const uri = pickMetadataUri(asset);

  if (!uri) {
    // No URI at all — only thing we can return is what DAS surfaced directly.
    return {
      imageUrl: viaHeliusCdn(pickAssetImage(asset)),
      name:
        asset?.content?.metadata?.name ??
        asset?.mint_extensions?.metadata?.name ??
        null,
      symbol:
        asset?.content?.metadata?.symbol ??
        asset?.mint_extensions?.metadata?.symbol ??
        null,
      description: asset?.content?.metadata?.description ?? null,
      socials: {},
      metadataUri: null,
    };
  }

  const json = await fetchMetadataJson(uri);
  return {
    imageUrl:
      json?.imageUrl ?? viaHeliusCdn(pickAssetImage(asset)),
    name:
      json?.name ??
      asset?.content?.metadata?.name ??
      asset?.mint_extensions?.metadata?.name ??
      null,
    symbol:
      json?.symbol ??
      asset?.content?.metadata?.symbol ??
      asset?.mint_extensions?.metadata?.symbol ??
      null,
    description:
      json?.description ?? asset?.content?.metadata?.description ?? null,
    socials: json?.socials ?? {},
    metadataUri: uri,
  };
}

/**
 * Batch version: 1 Helius credit for up to 1000 mints.
 * Used by the list view's "Refresh" button to bulk-update images.
 */
export async function fetchTokenMetadataBatch(
  mints: string[],
): Promise<Map<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  if (mints.length === 0) return out;

  const assets = await getAssetBatch(mints).catch(() => null);
  if (!assets) return out;

  // Fetch all JSON URIs in parallel (concurrency cap to be polite to IPFS).
  const tasks = mints.map(async (mint, i) => {
    const asset = assets[i];
    const uri = pickMetadataUri(asset);
    const json = uri ? await fetchMetadataJson(uri) : null;
    out.set(mint, {
      imageUrl:
        json?.imageUrl ?? viaHeliusCdn(pickAssetImage(asset)),
      name:
        json?.name ??
        asset?.content?.metadata?.name ??
        asset?.mint_extensions?.metadata?.name ??
        null,
      symbol:
        json?.symbol ??
        asset?.content?.metadata?.symbol ??
        asset?.mint_extensions?.metadata?.symbol ??
        null,
      description:
        json?.description ?? asset?.content?.metadata?.description ?? null,
      socials: json?.socials ?? {},
      metadataUri: uri,
    });
  });
  await Promise.all(tasks);
  return out;
}

export async function getAsset(mint: string): Promise<DasAsset | null> {
  // Helius DAS methods take a single object param (not the JSON-RPC array shape).
  return rpc<DasAsset | null>("getAsset", { id: mint });
}

/**
 * Batch fetch up to 1000 mints in a single HTTP call (1 Helius credit).
 * Order of returned assets matches the input ids.
 */
export async function getAssetBatch(
  mints: string[],
): Promise<(DasAsset | null)[]> {
  if (mints.length === 0) return [];
  return rpc<(DasAsset | null)[]>("getAssetBatch", { ids: mints });
}

/**
 * Extract the canonical Metaplex metadata URI from a DAS asset.
 * Works for both legacy Metaplex (content.json_uri) and Token-2022
 * (mint_extensions.metadata.uri).
 */
export function pickMetadataUri(asset: DasAsset | null): string | null {
  if (!asset) return null;
  return (
    asset.content?.json_uri ?? asset.mint_extensions?.metadata?.uri ?? null
  );
}

/**
 * Fetch & parse the off-chain Metaplex JSON file. This is the "metadata"
 * the user is asking about: { name, symbol, image, description, ... }
 *
 * Returns null on network/parse failure.
 */
export async function fetchMetadataJson(
  uri: string,
): Promise<TokenMetadata | null> {
  try {
    const res = await fetch(uri, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const imageUrl =
      (typeof json.image === "string" ? json.image : null) ??
      (typeof json.image_url === "string" ? json.image_url : null);
    return {
      imageUrl: viaHeliusCdn(imageUrl),
      name: typeof json.name === "string" ? json.name : null,
      symbol: typeof json.symbol === "string" ? json.symbol : null,
      description:
        typeof json.description === "string" ? json.description : null,
      socials: {
        twitter: typeof json.twitter === "string" ? json.twitter : undefined,
        telegram: typeof json.telegram === "string" ? json.telegram : undefined,
        website: typeof json.website === "string" ? json.website : undefined,
      },
    };
  } catch {
    return null;
  }
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
