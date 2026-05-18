/**
 * Telegram migration alerts.
 *
 * Posted as a `sendPhoto` with an HTML caption when the token has a
 * resolvable image, otherwise we fall back to `sendMessage` with the
 * same caption (Telegram lets us bind inline-keyboard buttons to both).
 *
 * Disabled silently when `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is
 * not set — local dev or accounts that don't want alerts simply leave
 * the vars unset.
 */
import type { schema } from "@/lib/db/client";
import { axiomUrl, dexscreenerUrl } from "@/lib/format";

type TokenRow = typeof schema.tokens.$inferInsert;

const API_BASE = "https://api.telegram.org/bot";
// sendPhoto caption hard limit. Trim anything we'd append past this.
const CAPTION_MAX = 1024;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUsdShort(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(3)}`;
}

function formatPct(n: string | number | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function changeEmoji(n: string | number | null | undefined): string {
  if (n == null) return "·";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v) || v === 0) return "·";
  return v > 0 ? "🟢" : "🔴";
}

function buildCaption(token: TokenRow): string {
  const ticker = token.ticker ? `$${escapeHtml(token.ticker)}` : "$?";
  const name = token.name ? ` · <i>${escapeHtml(token.name)}</i>` : "";
  const mcap = formatUsdShort(token.mcapUsd);
  const vol = formatUsdShort(token.volume24h);
  const liq = formatUsdShort(token.liquidityUsd);
  const ch1h = token.change2h;
  const ch24h = token.change24h;

  const lines = [
    `🚀 <b>${ticker}</b>${name}`,
    `<i>Just migrated on Pump.fun</i>`,
    ``,
    `💰 <b>MCAP</b>   ${mcap}`,
    `📊 <b>24h Vol</b> ${vol}`,
    `💧 <b>Liq</b>    ${liq}`,
    `${changeEmoji(ch1h)} <b>1h</b>     ${formatPct(ch1h)}    ${changeEmoji(ch24h)} <b>24h</b>     ${formatPct(ch24h)}`,
    ``,
    `<code>${escapeHtml(token.mint)}</code>`,
  ];

  const out = lines.join("\n");
  return out.length > CAPTION_MAX ? out.slice(0, CAPTION_MAX - 1) + "…" : out;
}

function buildKeyboard(token: TokenRow) {
  return {
    inline_keyboard: [
      [
        {
          text: "🚀 Axiom",
          url: axiomUrl({ mint: token.mint, poolAddress: token.poolAddress }),
        },
        { text: "📊 DexScreener", url: dexscreenerUrl(token.mint) },
      ],
      [
        {
          text: "💊 Pump.fun",
          url: `https://pump.fun/coin/${token.mint}`,
        },
      ],
    ],
  };
}

async function postJson(method: string, body: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[telegram] ${method} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

/**
 * Push a migration alert for the given token to the configured channel.
 * Never throws — Telegram failures are logged but must not break the
 * webhook handler.
 */
export async function sendMigrationAlert(token: TokenRow): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const caption = buildCaption(token);
  const reply_markup = buildKeyboard(token);

  try {
    if (token.imageUrl) {
      const res = await postJson("sendPhoto", {
        chat_id: chatId,
        photo: token.imageUrl,
        caption,
        parse_mode: "HTML",
        reply_markup,
      });
      // Telegram occasionally refuses a photo URL it can't fetch — fall
      // back to a text message so we never silently drop an alert.
      if (res && res.ok) return;
    }
    await postJson("sendMessage", {
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup,
    });
  } catch (err) {
    console.warn("[telegram] alert failed", err);
  }
}

export type TradeAlertContext = {
  wallet: string;
  label: string | null;
  direction: "buy" | "sell";
  mint: string;
  ticker: string | null;
  name: string | null;
  imageUrl: string | null;
  tokenAmount: number | null;
  solAmount: number | null;
  usdValue: number | null;
  dexSource: string | null;
  signature: string;
  poolAddress: string | null;
};

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTokenAmount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function prettyDex(src: string | null): string {
  if (!src) return "DEX";
  // Helius source enums come in SCREAMING_SNAKE_CASE — turn them into
  // something readable.
  return src
    .split("_")
    .map((s) => s[0] + s.slice(1).toLowerCase())
    .join(" ");
}

function buildTradeCaption(t: TradeAlertContext): string {
  const arrow = t.direction === "buy" ? "🟢" : "🔴";
  const verb = t.direction === "buy" ? "BUY" : "SELL";
  const tickerLine = t.ticker
    ? `📊 <b>$${escapeHtml(t.ticker)}</b>${t.name ? ` · <i>${escapeHtml(t.name)}</i>` : ""}`
    : `📊 <code>${escapeHtml(shortAddr(t.mint))}</code>`;
  const who = t.label
    ? `<b>${escapeHtml(t.label)}</b>`
    : `<code>${escapeHtml(shortAddr(t.wallet))}</code>`;
  const tokenAmt = formatTokenAmount(t.tokenAmount);
  const usdLine =
    t.usdValue != null
      ? ` (≈${formatUsdShort(t.usdValue)})`
      : "";
  const solLine =
    t.solAmount != null && t.solAmount > 0
      ? `\n💎 ${t.solAmount.toFixed(t.solAmount >= 1 ? 2 : 4)} SOL`
      : "";

  const lines = [
    `${arrow} <b>${verb}</b> · ${who}`,
    tickerLine,
    ``,
    `${tokenAmt} tokens${usdLine}${solLine}`,
    `via ${escapeHtml(prettyDex(t.dexSource))}`,
    ``,
    `<code>${escapeHtml(t.mint)}</code>`,
  ];
  const out = lines.join("\n");
  return out.length > CAPTION_MAX ? out.slice(0, CAPTION_MAX - 1) + "…" : out;
}

function buildTradeKeyboard(t: TradeAlertContext) {
  return {
    inline_keyboard: [
      [
        {
          text: "🚀 Axiom",
          url: axiomUrl({ mint: t.mint, poolAddress: t.poolAddress }),
        },
        { text: "📊 DexScreener", url: dexscreenerUrl(t.mint) },
      ],
      [
        {
          text: "👤 Wallet",
          url: `https://solscan.io/account/${t.wallet}`,
        },
        {
          text: "🔗 Tx",
          url: `https://solscan.io/tx/${t.signature}`,
        },
      ],
    ],
  };
}

/**
 * Push a buy/sell alert for a tracked wallet to the configured chat.
 * Never throws — Telegram failures are logged but must not break the
 * webhook handler.
 */
export async function sendWalletTradeAlert(t: TradeAlertContext): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const caption = buildTradeCaption(t);
  const reply_markup = buildTradeKeyboard(t);

  try {
    if (t.imageUrl) {
      const res = await postJson("sendPhoto", {
        chat_id: chatId,
        photo: t.imageUrl,
        caption,
        parse_mode: "HTML",
        reply_markup,
      });
      if (res && res.ok) return;
    }
    await postJson("sendMessage", {
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup,
    });
  } catch (err) {
    console.warn("[telegram] trade alert failed", err);
  }
}
