import type { Holding } from "./store";

const splitLine = (line: string) => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};
const num = (s: string) => Number(s.replace(/[,円株\s]/g, ""));

/** 楽天証券の保有商品CSV(Shift_JIS/UTF-8)を想定。列名は部分一致で柔軟に判定。 */
export function parseHoldingsCsv(buf: ArrayBuffer): Holding[] {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("shift_jis").decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const hi = lines.findIndex((l) => /銘柄/.test(l) && /(数量|保有)/.test(l));
  if (hi < 0) throw new Error("ヘッダー行(銘柄・保有数量)が見つかりません");
  const head = splitLine(lines[hi]);
  const idx = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iCode = idx(/コード|ティッカー/);
  const iName = idx(/銘柄名|^銘柄$/);
  const iQty = idx(/保有数量|数量/);
  const iCost = idx(/平均取得|取得単価|取得価額/);
  if (iCode < 0 || iQty < 0 || iCost < 0) throw new Error("必要な列(コード/数量/取得単価)が見つかりません");
  const rows: Holding[] = [];
  for (const l of lines.slice(hi + 1)) {
    const c = splitLine(l);
    const code = c[iCode]?.match(/\d{4}[A-Z]?/)?.[0];
    const qty = num(c[iQty] ?? "");
    const avgCost = num(c[iCost] ?? "");
    if (code && qty > 0 && avgCost > 0) rows.push({ code, name: c[iName] ?? code, qty, avgCost });
  }
  if (!rows.length) throw new Error("有効な行がありません");
  return rows;
}
