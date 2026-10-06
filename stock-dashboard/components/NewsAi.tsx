"use client";
import { useEffect, useState } from "react";
import type { NewsItem } from "@/lib/news";

export default function NewsAi({ code, name, query }: { code?: string; name?: string; query?: string }) {
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [ai, setAi] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNews(null);
    fetch(`/api/news${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setNews(Array.isArray(d) ? d : []))
      .catch(() => setNews([]));
  }, [query]);

  const ask = async () => {
    setBusy(true);
    const r = await fetch("/api/ai", { method: "POST", body: JSON.stringify({ code, name }) });
    setAi((await r.json()).text);
    setBusy(false);
  };

  return (
    <>
      <div className="panel">
        <h2>AIコメント</h2>
        <button onClick={ask} disabled={busy}>{busy ? "生成中…" : ai ? "再生成" : "生成する"}</button>
        {ai && <p className="ai">{ai}</p>}
        <p className="warn">AIの示唆は参考情報です。最終判断・発注はご自身で行ってください。</p>
      </div>
      <div className="panel news">
        <h2>ニュース</h2>
        {news === null && "読み込み中…"}
        {news?.length === 0 && "ニュースを取得できませんでした"}
        {news?.map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer">
            {n.title}
            <br />
            <small>{n.source} ・ {n.pubDate && new Date(n.pubDate).toLocaleString("ja-JP")}</small>
          </a>
        ))}
      </div>
    </>
  );
}
