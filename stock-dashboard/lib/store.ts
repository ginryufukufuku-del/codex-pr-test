"use client";
// 保有銘柄・ウォッチリストはブラウザのlocalStorageに保存 (サーバーに個人データを置かない)
export type Holding = { code: string; name: string; qty: number; avgCost: number };

const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "") as T;
  } catch {
    return d;
  }
};
export const loadHoldings = () => read<Holding[]>("holdings", []);
export const saveHoldings = (h: Holding[]) => localStorage.setItem("holdings", JSON.stringify(h));
export const loadWatch = () => read<string[]>("watch", []);
export const saveWatch = (w: string[]) => localStorage.setItem("watch", JSON.stringify(w));
