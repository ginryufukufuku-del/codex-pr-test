import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/yahoo";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json(await getCandles(p.get("code") ?? "", p.get("range") ?? "6mo"));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
