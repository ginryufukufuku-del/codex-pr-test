import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/yahoo";

export async function GET(req: NextRequest) {
  const codes = (req.nextUrl.searchParams.get("codes") ?? "").split(",").filter(Boolean).slice(0, 50);
  const res = await Promise.allSettled(codes.map(getQuote));
  return NextResponse.json(res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
}
