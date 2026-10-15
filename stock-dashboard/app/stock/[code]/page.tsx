"use client";
import { use, useEffect, useState } from "react";
import Chart from "@/components/Chart";
import NewsAi from "@/components/NewsAi";
import type { Quote } from "@/lib/yahoo";

export default function StockPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [q, setQ] = useState<Quote | null>(null);
  useEffect(() => {
    fetch(`/api/quote?codes=${code}`).then((r) => r.json()).then((d) => setQ(d[0] ?? null));
  }, [code]);
  const cls = q && (q.change >= 0 ? "up" : "down");
  return (
    <div className="split">
      <div className="col">
        <div className="panel">
          <div className="row-b">
            <b>{q?.name ?? code}</b> <span className="warn">{code}</span>
          </div>
          {q && (
            <div className={`big ${cls}`}>
              {q.price.toLocaleString()}{" "}
              <small>{q.change >= 0 ? "+" : ""}{q.change.toFixed(1)} ({q.changePct.toFixed(2)}%)</small>
            </div>
          )}
          <Chart code={code} />
        </div>
      </div>
      <div className="col">
        <NewsAi code={code} name={q?.name} query={q?.name ?? code} />
      </div>
    </div>
  );
}
