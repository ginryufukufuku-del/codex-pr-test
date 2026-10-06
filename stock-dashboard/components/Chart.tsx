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
    const min = Math.min(...data.map((d) => d.l)), max = Math.max(...data.map((d) => d.h));
    const x = (i: number) => P + (i / Math.max(data.length - 1, 1)) * (W - P * 2);
    const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - P * 2);
    const ma = (n: number) =>
      cs.map((_, i) => (i < n - 1 ? null : cs.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
    const path = (arr: (number | null)[]) =>
      arr.flatMap((v, i) => (v == null ? [] : [`${i && arr[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`])).join("");
    const bw = Math.max(1, ((W - P * 2) / data.length) * 0.6);

    body = (
      <>
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#2a3441" />
            <text x={4} y={y(v) + 4} fill="#8b98a8" fontSize={12}>{Math.round(v).toLocaleString()}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const c = d.c >= d.o ? "#ef5350" : "#26a69a";
          return (
            <g key={i} stroke={c} fill={c}>
              <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(d.l)} />
              <rect x={x(i) - bw / 2} y={y(Math.max(d.o, d.c))} width={bw} height={Math.max(1, Math.abs(y(d.o) - y(d.c)))} />
            </g>
          );
        })}
        <path d={path(ma(5))} fill="none" stroke="#ffb74d" strokeWidth={1.5} />
        <path d={path(ma(25))} fill="none" stroke="#4c9aff" strokeWidth={1.5} />
      </>
    );
  }
  return (
    <div>
      <div className="row-b">
        {RANGES.map((r) => (
          <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
        ))}
        <span className="warn">ローソク足 / <span style={{ color: "#ffb74d" }}>MA5</span> <span style={{ color: "#4c9aff" }}>MA25</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>{body}</svg>
    </div>
  );
}
