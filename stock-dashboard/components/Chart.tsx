"use client";
import { useEffect, useState } from "react";
import type { Candle } from "@/lib/yahoo";

const RANGES = ["1d", "5d", "1mo", "6mo", "1y", "5y"];

export default function Chart({ code }: { code: string }) {
  const [range, setRange] = useState("6mo");
  const [data, setData] = useState<Candle[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null);
    setErr("");
    fetch(`/api/chart?code=${code}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((e) => setErr(`チャート取得失敗: ${e}`));
  }, [code, range]);

  const W = 800, H = 420, P = 40;
  let body = <text x={W / 2} y={H / 2} fill="#8b98a8" textAnchor="middle">{err || "読み込み中…"}</text>;
  if (data?.length) {
    const cs = data.map((d) => d.c);
    const min = Math.min(...cs), max = Math.max(...cs);
    const x = (i: number) => P + (i / Math.max(data.length - 1, 1)) * (W - P * 2);
    const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - P * 2);
    const line = cs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const up = cs[cs.length - 1] >= cs[0];
    const col = up ? "#ef5350" : "#26a69a";
    body = (
      <>
        <path d={`${line}L${x(cs.length - 1)},${H - P}L${x(0)},${H - P}Z`} fill={col} opacity={0.12} />
        <path d={line} fill="none" stroke={col} strokeWidth={2} />
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#2a3441" />
            <text x={4} y={y(v) + 4} fill="#8b98a8" fontSize={12}>{Math.round(v).toLocaleString()}</text>
          </g>
        ))}
      </>
    );
  }
  return (
    <div>
      <div className="row-b">
        {RANGES.map((r) => (
          <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>{body}</svg>
    </div>
  );
}
