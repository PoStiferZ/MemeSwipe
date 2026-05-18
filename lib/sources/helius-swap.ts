/**
 * Helius Enhanced Webhook → trade row.
 *
 * The Enhanced webhook payload for a SWAP event normalizes data across
 * DEX integrations (Pump.fun, Jupiter, Raydium, Meteora, Orca…). We
 * extract a single `{ wallet, direction, mint, tokenAmount, solAmount }`
 * tuple per tracked wallet involved in the swap.
 *
 * Most of the time `events.swap` is populated and gives us everything in
 * a structured shape. When it isn't (some routed swaps), we fall back to
 * walking `tokenTransfers` + `nativeTransfers` keyed off the tracked
 * wallet.
 */

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

type RawTokenAmount = {
  tokenAmount?: string;
  decimals?: number;
};
type SwapTokenEntry = {
  userAccount?: string;
  tokenAccount?: string;
  mint?: string;
  rawTokenAmount?: RawTokenAmount;
};
type SwapNativeEntry = {
  account?: string;
  amount?: string | number;
};

export type HeliusSwapEvent = {
  signature?: string;
  slot?: number;
  timestamp?: number;
  type?: string;
  source?: string;
  feePayer?: string;
  events?: {
    swap?: {
      nativeInput?: SwapNativeEntry | null;
      nativeOutput?: SwapNativeEntry | null;
      tokenInputs?: SwapTokenEntry[];
      tokenOutputs?: SwapTokenEntry[];
      innerSwaps?: unknown[];
    };
  };
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    fromTokenAccount?: string;
    toTokenAccount?: string;
    tokenAmount?: number;
    mint?: string;
  }[];
  nativeTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }[];
};

export type ExtractedTrade = {
  wallet: string;
  direction: "buy" | "sell";
  mint: string;
  tokenAmount: number | null;
  solAmount: number | null;
  signature: string;
  slot: number | null;
  blockTime: Date;
  dexSource: string | null;
};

function asNumber(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

function decimalAmount(raw: RawTokenAmount | undefined): number | null {
  if (!raw) return null;
  const amt = asNumber(raw.tokenAmount);
  if (amt == null) return null;
  const dec = typeof raw.decimals === "number" ? raw.decimals : 0;
  return amt / 10 ** dec;
}

/**
 * Build a trade tuple for each tracked wallet found in the swap. Most
 * swaps will yield exactly one tuple (the feePayer). A single tx that
 * happens to touch two tracked wallets produces two tuples — each owner
 * sees their own row.
 */
export function extractTradesFromSwap(
  event: HeliusSwapEvent,
  trackedWallets: Set<string>,
): ExtractedTrade[] {
  if (!event.signature) return [];

  const slot = typeof event.slot === "number" ? event.slot : null;
  const blockTime = new Date(
    (typeof event.timestamp === "number" ? event.timestamp : Date.now() / 1000) * 1000,
  );
  const dexSource = event.source ?? null;

  // Build the set of candidate wallets (feePayer + every userAccount
  // referenced by the swap) so we can later filter to only the ones the
  // app actually wants to track.
  const candidates = new Set<string>();
  if (event.feePayer) candidates.add(event.feePayer);

  const swap = event.events?.swap;
  for (const entry of swap?.tokenInputs ?? [])
    if (entry.userAccount) candidates.add(entry.userAccount);
  for (const entry of swap?.tokenOutputs ?? [])
    if (entry.userAccount) candidates.add(entry.userAccount);
  if (swap?.nativeInput?.account) candidates.add(swap.nativeInput.account);
  if (swap?.nativeOutput?.account) candidates.add(swap.nativeOutput.account);

  for (const t of event.tokenTransfers ?? []) {
    if (t.fromUserAccount) candidates.add(t.fromUserAccount);
    if (t.toUserAccount) candidates.add(t.toUserAccount);
  }

  const involved = [...candidates].filter((w) => trackedWallets.has(w));
  if (involved.length === 0) return [];

  const trades: ExtractedTrade[] = [];
  for (const wallet of involved) {
    const t = buildTradeForWallet(event, wallet);
    if (t)
      trades.push({
        ...t,
        signature: event.signature,
        slot,
        blockTime,
        dexSource,
      });
  }
  return trades;
}

function buildTradeForWallet(
  event: HeliusSwapEvent,
  wallet: string,
): Pick<ExtractedTrade, "wallet" | "direction" | "mint" | "tokenAmount" | "solAmount"> | null {
  const swap = event.events?.swap;

  if (swap) {
    // Tokens the wallet *received*.
    const received = (swap.tokenOutputs ?? []).filter(
      (e) => e.userAccount === wallet && e.mint && e.mint !== WRAPPED_SOL_MINT,
    );
    // Tokens the wallet *sent*.
    const sent = (swap.tokenInputs ?? []).filter(
      (e) => e.userAccount === wallet && e.mint && e.mint !== WRAPPED_SOL_MINT,
    );

    // Native SOL movements (in lamports). nativeInput = SOL spent by the
    // user, nativeOutput = SOL received by the user.
    const solSpent =
      swap.nativeInput?.account === wallet
        ? (asNumber(swap.nativeInput.amount) ?? 0) / LAMPORTS_PER_SOL
        : 0;
    const solReceived =
      swap.nativeOutput?.account === wallet
        ? (asNumber(swap.nativeOutput.amount) ?? 0) / LAMPORTS_PER_SOL
        : 0;

    // BUY: spent SOL, received a non-SOL token.
    if (received.length > 0 && (solSpent > 0 || sent.length === 0)) {
      const top = received[0];
      return {
        wallet,
        direction: "buy",
        mint: top.mint!,
        tokenAmount: decimalAmount(top.rawTokenAmount),
        solAmount: solSpent > 0 ? solSpent : null,
      };
    }
    // SELL: sent a non-SOL token, received SOL.
    if (sent.length > 0 && (solReceived > 0 || received.length === 0)) {
      const top = sent[0];
      return {
        wallet,
        direction: "sell",
        mint: top.mint!,
        tokenAmount: decimalAmount(top.rawTokenAmount),
        solAmount: solReceived > 0 ? solReceived : null,
      };
    }
    // Token → Token swap (Jupiter route through stables, etc.). Treat
    // the received side as a buy of that mint — it's the more useful
    // half for tracking purposes (you went INTO this token).
    if (received.length > 0) {
      const top = received[0];
      return {
        wallet,
        direction: "buy",
        mint: top.mint!,
        tokenAmount: decimalAmount(top.rawTokenAmount),
        solAmount: null,
      };
    }
    if (sent.length > 0) {
      const top = sent[0];
      return {
        wallet,
        direction: "sell",
        mint: top.mint!,
        tokenAmount: decimalAmount(top.rawTokenAmount),
        solAmount: null,
      };
    }
  }

  // Fallback path — no events.swap, walk raw transfers.
  const tokenIn = (event.tokenTransfers ?? []).find(
    (t) => t.toUserAccount === wallet && t.mint && t.mint !== WRAPPED_SOL_MINT,
  );
  const tokenOut = (event.tokenTransfers ?? []).find(
    (t) => t.fromUserAccount === wallet && t.mint && t.mint !== WRAPPED_SOL_MINT,
  );
  const solOut = (event.nativeTransfers ?? [])
    .filter((n) => n.fromUserAccount === wallet)
    .reduce((sum, n) => sum + (n.amount ?? 0), 0);
  const solIn = (event.nativeTransfers ?? [])
    .filter((n) => n.toUserAccount === wallet)
    .reduce((sum, n) => sum + (n.amount ?? 0), 0);

  if (tokenIn) {
    return {
      wallet,
      direction: "buy",
      mint: tokenIn.mint!,
      tokenAmount: tokenIn.tokenAmount ?? null,
      solAmount: solOut > 0 ? solOut / LAMPORTS_PER_SOL : null,
    };
  }
  if (tokenOut) {
    return {
      wallet,
      direction: "sell",
      mint: tokenOut.mint!,
      tokenAmount: tokenOut.tokenAmount ?? null,
      solAmount: solIn > 0 ? solIn / LAMPORTS_PER_SOL : null,
    };
  }

  return null;
}
