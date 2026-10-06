# 動画生成AIハブ デスクトップアプリ(Mac)

`video-ai-hub/` をそのまま Mac アプリ(アイコンをダブルクリックで開く)にします。Node.js は不要です。

## 入手と使い方
1. GitHub の **Actions** タブ → **Build Mac app** → **Run workflow**(完了まで数分)
2. 完了した実行の **Artifacts** から `video-ai-hub-mac` をダウンロードして展開
3. お使いのMacに合うほうの `.dmg` を開く
   - Apple のチップ(M1/M2/M3…): `arm64`
   - Intel Mac: `x64`
4. 「動画生成AIハブ」を **アプリケーション** にドラッグ。必要ならアイコンをDockやデスクトップに置く(アプリケーションからデスクトップへ、Optionキー+Cmdキーを押しながらドラッグでエイリアス)
5. 初回だけ: アイコンを **右クリック → 開く**(開発元未確認の警告が出るため)。開けない場合はターミナルで
   `xattr -cr "/Applications/動画生成AIハブ.app"`
6. メニュー **動画生成AIハブ → APIキー設定…**(⌘,)でキーを入力(使うサービスだけ)

## アイコン(マスコット)の差し替え
1. Canva の画像 https://www.canva.com/M/MAHXPirtwJA を開き、**共有 → ダウンロード → PNG** で保存
2. GitHub のこのリポジトリで `desktop/build/` を開き、**Add file → Upload files** で、保存した画像を `mascot-source.png` という名前でアップロード(コミット)
3. Actions で **Build Mac app** を実行 → 自動で角丸・透明な 1024px アイコンに整えてアプリに使われます
   (手元で試す場合: `pip3 install pillow` のあと `python3 scripts/make-icon.py build/mascot-source.png build/icon.png`)

## 安全面
- APIキーはMacのキーチェーン連携(safeStorage)で暗号化して保存。画面には再表示しません。
- 内部サーバーは `127.0.0.1` の空きポートでのみ待受け、起動ごとのランダムなトークンで保護(外部からは使えません)。
- 生成した動画は、動画を右クリック → **動画を保存…**
- API生成は**有料**です(画面の確認チェックが必要)。

## 開発者向け
`cd desktop && npm install && npm start`(Mac/Linux)。アイコンは `build/icon.png`(1024×1024 PNG)を差し替えます。
