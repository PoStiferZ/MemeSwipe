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
