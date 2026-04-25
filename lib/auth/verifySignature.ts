import nacl from "tweetnacl";
import bs58 from "bs58";

const MAX_AGE_MS = 24 * 60 * 60_000; // 24h session

/**
 * Verify a Sign-In With Solana style payload: the wallet signs a JSON message
 * containing a timestamp, then we send `{ wallet, message, signature }` on
 * each authenticated request.
 *
 * Message format:
 *   { domain: string, statement: string, issuedAt: number, nonce: string }
 */
export function buildLoginMessage(domain: string) {
  const issuedAt = Date.now();
  const nonce = Math.random().toString(36).slice(2, 12);
  return {
    domain,
    statement: "Sign in to MemeSwipe",
    issuedAt,
    nonce,
  };
}

export type LoginMessage = ReturnType<typeof buildLoginMessage>;

export function verifyLogin(args: {
  wallet: string;
  message: LoginMessage;
  signatureBase58: string;
  expectedDomain: string;
}): { ok: true } | { ok: false; reason: string } {
  if (args.message.domain !== args.expectedDomain) {
    return { ok: false, reason: "domain mismatch" };
  }
  if (Date.now() - args.message.issuedAt > MAX_AGE_MS) {
    return { ok: false, reason: "expired" };
  }
  try {
    const pubkey = bs58.decode(args.wallet);
    const sig = bs58.decode(args.signatureBase58);
    const data = new TextEncoder().encode(JSON.stringify(args.message));
    const ok = nacl.sign.detached.verify(data, sig, pubkey);
    if (!ok) return { ok: false, reason: "bad signature" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
