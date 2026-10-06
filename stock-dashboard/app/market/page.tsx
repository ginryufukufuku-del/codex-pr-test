"use client";
import { useEffect, useState } from "react";
import NewsAi from "@/components/NewsAi";

type Idx = { symbol: string; label: string; price: number; change: number; changePct: number };

export default function MarketPage() {
  const [idx, setIdx] = useState<Idx[]>([]);
  useEffect(() => {
    fetch("/api/market").then((r) => r.json()).then(setIdx);
  }, []);
  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h2>主要指数</h2>
          <table>
            <thead><tr><th>指数</th><th>値</th><th>前日比</th><th>%</th></tr></thead>
            <tbody>
              {idx.map((i) => (
                <tr key={i.symbol} className={i.change >= 0 ? "up" : "down"}>
                  <td style={{ color: "var(--fg)" }}>{i.label}</td>
                  <td>{i.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td>{i.change.toFixed(2)}</td>
                  <td>{i.changePct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div><NewsAi /></div>
    </div>
  );
}
