import { NextRequest, NextResponse } from "next/server";
import { generateComment } from "@/lib/ai";
import { getCandles, getQuote } from "@/lib/yahoo";
import { getMarketNews, getStockNews } from "@/lib/news";

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

export async function POST(req: NextRequest) {
  const { code, name } = (await req.json()) as { code?: string; name?: string };
  try {
    if (code) {
      const [q, c, news] = await Promise.all([
        getQuote(code),
        getCandles(code, "6mo"),
        getStockNews(name || code, 10).catch(() => []),
      ]);
      const hi = Math.max(...c.map((x) => x.h));
      const lo = Math.min(...c.map((x) => x.l));
      const first = c[0]?.c ?? q.price;
      const ctx = `銘柄: ${name || q.name} (${code})
現在値 ${fmt(q.price)} / 前日比 ${fmt(q.change)} (${fmt(q.changePct)}%)
直近6か月: 始値比 ${fmt(((q.price - first) / first) * 100)}% / 高値 ${fmt(hi)} / 安値 ${fmt(lo)}
ニュース見出し:\n${news.map((n) => `- ${n.title}`).join("\n")}`;
      return NextResponse.json({ text: await generateComment(ctx) });
    }
    const [idx, news] = await Promise.all([
      Promise.allSettled([getQuote("^N225"), getQuote("1306"), getQuote("^GSPC"), getQuote("USDJPY=X")]),
      getMarketNews(10).catch(() => []),
    ]);
    const lines = idx.flatMap((r) =>
      r.status === "fulfilled" ? [`${r.value.name}: ${fmt(r.value.price)} (${fmt(r.value.changePct)}%)`] : [],
    );
    const ctx = `市場全体の見解を求めます。\n指標:\n${lines.join("\n")}\nニュース見出し:\n${news.map((n) => `- ${n.title}`).join("\n")}`;
    return NextResponse.json({ text: await generateComment(ctx) });
  } catch (e) {
    return NextResponse.json({ text: `生成に失敗しました: ${String(e)}` }, { status: 502 });
  }
}
