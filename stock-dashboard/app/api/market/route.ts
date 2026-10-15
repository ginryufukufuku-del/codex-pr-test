import { NextResponse } from "next/server";
import { getQuote } from "@/lib/yahoo";

// TOPIXは指数シンボルが不安定なため、連動ETF(1306)を代用表示する
const INDEXES = [
  { code: "^N225", label: "日経平均" },
  { code: "1306", label: "TOPIX(連動ETF 1306)" },
  { code: "^DJI", label: "NYダウ" },
  { code: "^GSPC", label: "S&P500" },
  { code: "USDJPY=X", label: "ドル円" },
];

export async function GET() {
  const res = await Promise.allSettled(INDEXES.map((i) => getQuote(i.code)));
  return NextResponse.json(
    res.flatMap((r, i) => (r.status === "fulfilled" ? [{ ...r.value, label: INDEXES[i].label }] : [])),
  );
}
