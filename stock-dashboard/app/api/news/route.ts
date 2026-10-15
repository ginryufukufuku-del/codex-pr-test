import { NextRequest, NextResponse } from "next/server";
import { getMarketNews, getStockNews } from "@/lib/news";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  try {
    return NextResponse.json(q ? await getStockNews(q) : await getMarketNews());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
