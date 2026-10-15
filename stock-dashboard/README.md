# Stock Dashboard (日本株・個人利用)

iPad横向きブラウザ向けの情報収集 + AIコメント表示アプリ。自動売買なし(発注は楽天証券アプリで手動)。

## 画面
- `/` 保有銘柄(CSV取込) + ウォッチリスト
- `/stock/[code]` 左: チャート / 右: AIコメント + ニュース
- `/market` 主要指数 + 世界情勢ニュース + AI市場見解

## 起動
```
cp .env.example .env.local   # ANTHROPIC_API_KEY / APP_PASSWORD を設定
npm install && npm run dev   # iPadからは http://<PCのIP>:3000
```

## テスト
`npx tsx scripts/csv-test.ts`（CSVパーサのサンプル検証。実CSVでの確認は別途必要）

## データソースの注意
- 株価: Yahoo Finance **非公式**チャートAPI(`7203.T`形式)。公式APIではなく、仕様変更・規約上の制限があり得る。TOPIXは連動ETF(1306)で代用。
- ニュース: Google News RSS(銘柄別) / Yahoo!ニュースRSS(市場全体)。
- 保有銘柄: 楽天証券に公式の個人向けAPIは確認できないため、保有商品CSVをアップロード(列名は部分一致で判定。実CSVでの検証が必要)。データはブラウザのlocalStorageのみ。
- AI: Anthropic API。株価・見出しのみを根拠にプロンプト化。
- 個人利用限定(投資助言業に該当しないため、他者への提供はしない)。外部公開する場合は `APP_PASSWORD` でBASIC認証を有効化。
