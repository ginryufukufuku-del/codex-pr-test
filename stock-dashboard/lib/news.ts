export type NewsItem = { title: string; link: string; source: string; pubDate: string };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

function parseRss(xml: string, limit: number): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, limit).map((b) => ({
    title: tag(b, "title"),
    link: tag(b, "link"),
    source: tag(b, "source") || "Yahoo!ニュース",
    pubDate: tag(b, "pubDate"),
  }));
}

async function rss(url: string, limit: number) {
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`rss ${res.status}`);
  return parseRss(await res.text(), limit);
}

/** 銘柄別: Google News RSS を銘柄名/コードで検索 */
export const getStockNews = (query: string, limit = 15) =>
  rss(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query + " 株")}&hl=ja&gl=JP&ceid=JP:ja`,
    limit,
  );

/** 市場全体: Yahoo!ニュース 経済・国際 RSS */
export async function getMarketNews(limit = 20) {
  const feeds = [
    "https://news.yahoo.co.jp/rss/topics/business.xml",
    "https://news.yahoo.co.jp/rss/topics/world.xml",
  ];
  const all = (await Promise.allSettled(feeds.map((f) => rss(f, limit)))).flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );
  return all.slice(0, limit * 2);
}
