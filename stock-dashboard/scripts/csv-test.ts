import { parseHoldingsCsv } from "../lib/csv";
import assert from "node:assert";

const sample = `"保有商品詳細 (すべて)"
"▼株式(現物/特定預り)"
"銘柄コード","銘柄名","保有数量","平均取得価額","現在値"
"7203","トヨタ自動車","100","2,500.5","2,900"
"9984","ソフトバンクG","200","7,000","8,100"
`;
const rows = parseHoldingsCsv(new TextEncoder().encode(sample).buffer as ArrayBuffer);
assert.equal(rows.length, 2);
assert.deepEqual(rows[0], { code: "7203", name: "トヨタ自動車", qty: 100, avgCost: 2500.5 });
console.log("csv ok");
