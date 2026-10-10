#!/bin/bash
# 診断用(GitHub の Mac で実行): 組み立てたアプリを起動し、結果・出力・クラッシュレポートを表示する。常に成功(終了コード0)で終わる。
set +e
APP="$1"; NAME="動画生成AIハブ"
echo "=== sw_vers ==="; sw_vers
echo "=== codesign verify (fresh build) ==="
codesign --verify --deep --strict --verbose=1 "$APP" 2>&1 | tail -5
echo "=== launch app ==="
rm -f /tmp/app.log; mkdir -p ~/Library/Logs/DiagnosticReports
BEFORE=$(ls ~/Library/Logs/DiagnosticReports 2>/dev/null | wc -l)
ELECTRON_ENABLE_LOGGING=1 "$APP/Contents/MacOS/$NAME" > /tmp/app.log 2>&1 &
PID=$!
sleep 20
if kill -0 $PID 2>/dev/null; then echo "RESULT: still running after 20s (OK)"; kill $PID; else wait $PID; echo "RESULT: exited with code $?"; fi
echo "--- app output (first 80 lines) ---"; head -80 /tmp/app.log
sleep 5
echo "--- crash reports ---"
ls -la ~/Library/Logs/DiagnosticReports /Library/Logs/DiagnosticReports 2>/dev/null | tail -8
for f in $(ls -t ~/Library/Logs/DiagnosticReports/*.ips /Library/Logs/DiagnosticReports/*.ips 2>/dev/null | head -1); do echo "== $f"; python3 - "$f" <<'PY'
import sys, json
raw = open(sys.argv[1], errors='replace').read()
try:
    head, body = raw.split('\n', 1)
    j = json.loads(body)
    print('exception:', j.get('exception'))
    print('termination:', j.get('termination'))
    print('os:', j.get('osVersion'))
    for t in j.get('threads', []):
        if t.get('triggered'):
            print('crashed thread frames:')
            for fr in t.get('frames', [])[:25]:
                im = j['usedImages'][fr['imageIndex']] if 'imageIndex' in fr else {}
                print('  ', im.get('name', '?'), fr.get('symbol', ''))
except Exception as e:
    print('(parse failed)', e); print(raw[:5000])
PY
done
exit 0
