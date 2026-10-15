// Yahoo Finance 非公式チャートAPI。公式APIではなく、仕様変更・規約上の制限があり得る。個人利用前提。
const UA = "Mozilla/5.0 (compatible; personal-stock-dashboard)";

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
};
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export const toSymbol = (code: string) => (/^\^|\./.test(code) ? code : `${code}.T`);

async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo ${symbol} no data`);
  return r;
}

export async function getQuote(code: string): Promise<Quote> {
  const symbol = toSymbol(code);
  const r = await fetchChart(symbol, "5d", "1d");
  const m = r.meta;
  const price = m.regularMarketPrice as number;
  const prevClose = (m.chartPreviousClose ?? m.previousClose) as number;
  return {
    symbol: code,
    name: m.shortName ?? m.longName ?? code,
    price,
    prevClose,
    change: price - prevClose,
    changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
  };
}

const RANGES: Record<string, [string, string]> = {
  "1d": ["1d", "5m"],
  "5d": ["5d", "30m"],
  "1mo": ["1mo", "1d"],
  "6mo": ["6mo", "1d"],
  "1y": ["1y", "1d"],
  "5y": ["5y", "1wk"],
};

export async function getCandles(code: string, range = "6mo"): Promise<Candle[]> {
  const [rg, iv] = RANGES[range] ?? RANGES["6mo"];
  const r = await fetchChart(toSymbol(code), rg, iv);
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators.quote[0];
  const out: Candle[] = [];
  ts.forEach((t, i) => {
    if (q.close[i] == null) return;
    out.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 });
  });
  return out;
}
