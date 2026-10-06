"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseHoldingsCsv } from "@/lib/csv";
import { Holding, loadHoldings, loadWatch, saveHoldings, saveWatch } from "@/lib/store";
import type { Quote } from "@/lib/yahoo";

const yen = (n: number) => Math.round(n).toLocaleString();
const sign = (n: number) => (n >= 0 ? "up" : "down");

export default function Home() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState("");

  useEffect(() => {
    setHoldings(loadHoldings());
    setWatch(loadWatch());
  }, []);

  const codes = useMemo(() => [...new Set([...holdings.map((h) => h.code), ...watch])], [holdings, watch]);
  const refresh = useCallback(async () => {
    if (!codes.length) return;
    const d: Quote[] = await (await fetch(`/api/quote?codes=${codes.join(",")}`)).json();
    setQuotes(Object.fromEntries(d.map((q) => [q.symbol, q])));
  }, [codes]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onCsv = async (f?: File) => {
    if (!f) return;
    try {
      const h = parseHoldingsCsv(await f.arrayBuffer());
      saveHoldings(h);
      setHoldings(h);
      setMsg(`${h.length}銘柄を取り込みました`);
    } catch (e) {
      setMsg(`取り込み失敗: ${(e as Error).message}`);
    }
  };
  const addWatch = () => {
    const c = add.trim().toUpperCase();
    if (!/^\d{4}[A-Z]?$/.test(c) || watch.includes(c)) return;
    const w = [...watch, c];
    saveWatch(w);
    setWatch(w);
    setAdd("");
  };
  const delWatch = (c: string) => {
    const w = watch.filter((x) => x !== c);
    saveWatch(w);
    setWatch(w);
  };

  const total = holdings.reduce(
    (a, h) => {
      const q = quotes[h.code];
      if (!q) return a;
      return { val: a.val + q.price * h.qty, pl: a.pl + (q.price - h.avgCost) * h.qty, day: a.day + q.change * h.qty };
    },
    { val: 0, pl: 0, day: 0 },
  );

  return (
    <>
      <div className="panel">
        <div className="row-b">
          <h2 style={{ margin: 0 }}>保有銘柄</h2>
          <input type="file" accept=".csv" onChange={(e) => onCsv(e.target.files?.[0])} />
          <span className="warn">{msg || "楽天証券の保有商品CSVを取り込み (データは端末内にのみ保存)"}</span>
        </div>
        {holdings.length > 0 && (
          <div className="row-b">
            評価額 <b>{yen(total.val)}円</b>
            損益 <b className={sign(total.pl)}>{yen(total.pl)}円</b>
            前日比 <b className={sign(total.day)}>{yen(total.day)}円</b>
          </div>
        )}
        <table>
          <thead>
            <tr><th>銘柄</th><th>現在値</th><th>前日比</th><th>株数</th><th>取得単価</th><th>評価損益</th></tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const q = quotes[h.code];
              const pl = q ? (q.price - h.avgCost) * h.qty : 0;
              return (
                <tr key={h.code} className="row" onClick={() => (location.href = `/stock/${h.code}`)}>
                  <td><Link href={`/stock/${h.code}`}>{h.name} <span className="warn">{h.code}</span></Link></td>
                  <td>{q ? q.price.toLocaleString() : "-"}</td>
                  <td className={q ? sign(q.change) : ""}>{q ? `${q.changePct.toFixed(2)}%` : "-"}</td>
                  <td>{h.qty.toLocaleString()}</td>
                  <td>{h.avgCost.toLocaleString()}</td>
                  <td className={sign(pl)}>{q ? `${yen(pl)}円 (${(((q.price - h.avgCost) / h.avgCost) * 100).toFixed(1)}%)` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="row-b">
          <h2 style={{ margin: 0 }}>ウォッチリスト</h2>
          <input type="text" inputMode="numeric" placeholder="証券コード 例: 7203" value={add}
            onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWatch()} />
          <button onClick={addWatch}>追加</button>
        </div>
        <table>
          <thead><tr><th>銘柄</th><th>現在値</th><th>前日比</th><th></th></tr></thead>
          <tbody>
            {watch.map((c) => {
              const q = quotes[c];
              return (
                <tr key={c}>
                  <td><Link href={`/stock/${c}`}>{q?.name ?? c} <span className="warn">{c}</span></Link></td>
                  <td>{q ? q.price.toLocaleString() : "-"}</td>
                  <td className={q ? sign(q.change) : ""}>{q ? `${q.changePct.toFixed(2)}%` : "-"}</td>
                  <td><button onClick={() => delWatch(c)}>削除</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
