import { NextRequest, NextResponse } from "next/server";
import { refreshRecentTokens } from "@/lib/indexer/refreshSnapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await refreshRecentTokens(200);
  return NextResponse.json({ ok: true, ...result });
}
