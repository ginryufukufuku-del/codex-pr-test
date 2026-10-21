#!/bin/bash
# 診断用(GitHub の Mac で実行): 何も入っていない最小のアプリを、Electron のバージョンごとに起動して結果を比べる。常に成功(終了コード0)で終わる。
set +e
echo "=== $(sw_vers -productName) $(sw_vers -productVersion) / $(uname -m) ==="
rm -rf /tmp/mini; mkdir -p /tmp/mini
echo '{"name":"mini","version":"1.0.0","main":"main.js"}' > /tmp/mini/package.json
echo "const {app}=require('electron');console.log('MINI_STARTED');app.whenReady().then(()=>{console.log('MINI_READY');setTimeout(()=>app.quit(),1000)});" > /tmp/mini/main.js
run_one() {   # $1=Electron の実行ファイル  $2..=追加の引数
  BIN="$1"; shift
  rm -f /tmp/m.log
  ELECTRON_ENABLE_LOGGING=1 "$BIN" "$@" /tmp/mini > /tmp/m.log 2>&1 &
  PID=$!
  for i in $(seq 1 20); do kill -0 $PID 2>/dev/null || break; sleep 1; done
  if kill -0 $PID 2>/dev/null; then echo "  -> 20秒たっても終了しない(固まった)"; kill -9 $PID; wait $PID 2>/dev/null
  else wait $PID; CODE=$?; if grep -q MINI_READY /tmp/m.log; then echo "  -> 正常に起動して終了 (exit $CODE)"; else echo "  -> 起動に失敗 (exit code $CODE)"; fi; fi
  head -6 /tmp/m.log | sed 's/^/     | /'
}
for V in 33 36 37 38 39 latest; do
  D=/tmp/el-$V; rm -rf $D; mkdir -p $D
  (cd $D && npm init -y >/dev/null 2>&1 && npm install electron@$V --no-audit --no-fund >/dev/null 2>&1)
  if [ ! -f "$D/node_modules/electron/package.json" ]; then echo "electron@$V: インストールできず(その版は存在しない可能性)"; continue; fi
  VER=$(node -p "require('$D/node_modules/electron/package.json').version")
  BIN="$D/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  echo "electron $VER (指定: $V):"; run_one "$BIN"
  if [ "$V" = "33" ]; then echo "electron $VER + --no-sandbox --disable-gpu:"; run_one "$BIN" --no-sandbox --disable-gpu; fi
done
exit 0
