import { createHash } from "crypto";
import bs58 from "bs58";
import type { ParsedTransaction, ParsedInstruction } from "./helius";
import { PUMPSWAP_PROGRAM_ID } from "./helius";

const WSOL = "So11111111111111111111111111111111111111112";

/**
 * Anchor discriminator for an instruction = first 8 bytes of
 * sha256("global:<ix_name>").
 */
function discriminator(ixName: string): Buffer {
  return createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

const CREATE_POOL_DISCRIMINATOR = discriminator("create_pool");

function rawIx(ix: ParsedInstruction): { data: Buffer; accounts: string[] } | null {
  if (ix.programId !== PUMPSWAP_PROGRAM_ID) return null;
  if (!ix.data || !ix.accounts) return null;
  try {
    const data = Buffer.from(bs58.decode(ix.data));
    return { data, accounts: ix.accounts };
  } catch {
    return null;
  }
}

export type DetectedMigration = {
  mint: string;
  poolAddress: string;
  signature: string;
  blockTime: Date;
  slot: number;
};

/**
 * Inspect a parsed transaction and return a migration record if it contains a
 * PumpSwap `create_pool` instruction.
 */
export function detectMigration(
  tx: ParsedTransaction | null,
  signature: string,
): DetectedMigration | null {
  if (!tx || tx.meta?.err) return null;
  const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
  if (!blockTime) return null;

  const allInstructions: ParsedInstruction[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions),
  ];

  for (const ix of allInstructions) {
    const raw = rawIx(ix);
    if (!raw) continue;
    if (raw.data.length < 8) continue;
    const disc = raw.data.subarray(0, 8);
    if (!disc.equals(CREATE_POOL_DISCRIMINATOR)) continue;

    // Account layout per PumpSwap IDL:
    //   0: pool, 1: globalConfig, 2: creator,
    //   3: baseMint, 4: quoteMint, 5: lpMint, ...
    const pool = raw.accounts[0];
    const candidates = [raw.accounts[3], raw.accounts[4]];
    const mint = candidates.find((a) => a && a !== WSOL);
    if (!pool || !mint) continue;

    return {
      mint,
      poolAddress: pool,
      signature,
      blockTime,
      slot: tx.slot,
    };
  }
  return null;
}

type WebhookIx = ParsedInstruction & {
  innerInstructions?: ParsedInstruction[];
};

/**
 * Helius webhook payloads ship parsed Solana transactions. The Enhanced
 * webhook format nests inner instructions inside each outer instruction
 * (not at top-level like the RPC format), so walk both shapes.
 */
export function detectFromWebhookEvent(
  event: {
    signature?: string;
    slot?: number;
    timestamp?: number;
    instructions?: WebhookIx[];
    innerInstructions?: { instructions: ParsedInstruction[] }[];
  },
): DetectedMigration | null {
  if (!event.signature) return null;
  const blockTime = event.timestamp
    ? new Date(event.timestamp * 1000)
    : new Date();

  const outer = event.instructions ?? [];
  const innerNested = outer.flatMap((ix) => ix.innerInstructions ?? []);
  const innerTopLevel = (event.innerInstructions ?? []).flatMap(
    (g) => g.instructions,
  );

  const allInstructions: ParsedInstruction[] = [
    ...outer,
    ...innerNested,
    ...innerTopLevel,
  ];

  for (const ix of allInstructions) {
    const raw = rawIx(ix);
    if (!raw) continue;
    if (raw.data.length < 8) continue;
    const disc = raw.data.subarray(0, 8);
    if (!disc.equals(CREATE_POOL_DISCRIMINATOR)) continue;

    const pool = raw.accounts[0];
    const candidates = [raw.accounts[3], raw.accounts[4]];
    const mint = candidates.find((a) => a && a !== WSOL);
    if (!pool || !mint) continue;

    return {
      mint,
      poolAddress: pool,
      signature: event.signature,
      blockTime,
      slot: event.slot ?? 0,
    };
  }
  return null;
}
