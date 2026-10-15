// 動画・音声の処理(ffmpeg)。確認用のコマ画像、明るさ・音量の測定、色/明るさ/トリミング、つなぎ、音入れ。
const fs = require('fs'), path = require('path');
const { execFile } = require('child_process');

const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
const clamp = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function ff(args, timeout = 600000) {
  return new Promise(ok => execFile(ffmpegPath(), ['-hide_banner', '-y', ...args], { maxBuffer: 64 * 1024 * 1024, timeout },
    (err, stdout, stderr) => ok({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })));
}
async function available() { return (await ff(['-version'], 15000)).code === 0; }

async function probe(file) {
  const { stderr } = await ff(['-i', file], 30000);
  const d = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = stderr.match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
  return { duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : 0, width: v ? +v[1] : 0, height: v ? +v[2] : 0, hasAudio: /Audio: /.test(stderr) };
}

// 指定した秒数のコマ画像(JPEG・幅512px)を base64 で返す
async function framesAt(file, times, dir, tag) {
  const out = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(dir, `${tag}_${i}.jpg`);
    await ff(['-ss', Math.max(0, t).toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '4', f], 60000);
    if (fs.existsSync(f)) out.push({ t: +t.toFixed(2), data: fs.readFileSync(f).toString('base64') });
  }
  return out;
}
const framesSpread = (file, dur, n, dir, tag) => framesAt(file, Array.from({ length: n }, (_, i) => dur * (n === 1 ? 0.5 : 0.05 + 0.9 * i / (n - 1))), dir, tag);

async function brightness(file) {            // 平均の明るさ(0〜255)
  const { stdout, stderr } = await ff(['-i', file, '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], 120000);
  const vals = [...(stdout + stderr).matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(m => +m[1]);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
async function volume(file) {                // 平均と最大の音量(dB)
  const { stderr } = await ff(['-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], 120000);
  const m = stderr.match(/mean_volume: (-?[\d.]+) dB/), x = stderr.match(/max_volume: (-?[\d.]+) dB/);
  return { mean_db: m ? +m[1] : null, max_db: x ? +x[1] : null };
}

// 1ショットを共通の解像度・30fps・ステレオ音声にそろえ、色/明るさ/トリミングを反映する
async function normalizeShot(file, edit, W, H, out) {
  const e = edit || {};
  const info = await probe(file);
  const start = clamp(e.trim_start_sec, 0, Math.max(0, info.duration - 0.5), 0);
  const end = clamp(e.trim_end_sec, 0, Math.max(0, info.duration - start - 0.5), 0);
  const len = Math.max(0.5, info.duration - start - end);
  const b = clamp(e.brightness, -0.3, 0.3, 0), c = clamp(e.contrast, 0.5, 1.5, 1), s = clamp(e.saturation, 0, 2, 1), w = clamp(e.warmth, -1, 1, 0);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,` +
    `eq=brightness=${b}:contrast=${c}:saturation=${s},colorbalance=rm=${(w * 0.15).toFixed(3)}:bm=${(-w * 0.15).toFixed(3)},format=yuv420p`;
  const args = ['-ss', String(start), '-t', String(len), '-i', file];
  let amap = '0:a';
  if (!info.hasAudio) { args.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=48000:cl=stereo'); amap = '1:a'; }
  args.push('-filter_complex', `[0:v]${vf}[v];[${amap}]aresample=48000,aformat=channel_layouts=stereo[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', out);
  const r = await ff(args);
  if (r.code !== 0) throw new Error('ショットの整形に失敗: ' + r.stderr.slice(-300));
  return (await probe(out)).duration;
}

// ショットをつなぐ(カット/フェード)。各ショットの開始秒も返す
async function join(parts, durs, fade, dir) {
  const out = path.join(dir, 'joined.mp4');
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0) - i * fade);
  let r;
  if (!fade || parts.length < 2) {
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, parts.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    r = await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  } else {
    const fc = []; let v = '[0:v]', a = '[0:a]';
    for (let i = 1; i < parts.length; i++) {
      fc.push(`${v}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${starts[i].toFixed(3)}[v${i}]`, `${a}[${i}:a]acrossfade=d=${fade}[a${i}]`);
      v = `[v${i}]`; a = `[a${i}]`;
    }
    r = await ff([...parts.flatMap(f => ['-i', f]), '-filter_complex', fc.join(';'), '-map', v, '-map', a,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', out]);
  }
  if (r.code !== 0) throw new Error('つなぎに失敗: ' + r.stderr.slice(-300));
  return { file: out, starts, total: (await probe(out)).duration };
}

// 音入れ: 元の音 + BGM + 声(各セリフを指定秒に配置)を重ね、終わりをフェードアウト
async function mixAudio(video, total, { originalVolume = 1, bgmFile = null, bgmVolume = 0.3, fadeOut = 1, cues = [] }, out) {
  const inputs = ['-i', video], fc = [`[0:a]volume=${clamp(originalVolume, 0, 1.5, 1)}[a0]`], labels = ['[a0]'];
  let n = 1;
  if (bgmFile) {
    inputs.push('-stream_loop', '-1', '-i', bgmFile);
    fc.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${clamp(bgmVolume, 0, 1.5, 0.3)},atrim=0:${total.toFixed(3)}[b]`);
    labels.push('[b]'); n++;
  }
  for (const c of cues) {
    const ms = Math.round(clamp(c.at, 0, total, 0) * 1000);
    inputs.push('-i', c.file);
    fc.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${clamp(c.volume, 0, 2, 1)}[c${n}]`);
    labels.push(`[c${n}]`); n++;
  }
  const fo = Math.min(clamp(fadeOut, 0, 5, 1), total / 2);
  fc.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,afade=t=out:st=${Math.max(0, total - fo).toFixed(3)}:d=${fo.toFixed(3)}[a]`);
  const r = await ff([...inputs, '-filter_complex', fc.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), out]);
  if (r.code !== 0) throw new Error('音入れに失敗: ' + r.stderr.slice(-300));
  return out;
}

module.exports = { ff, available, probe, framesAt, framesSpread, brightness, volume, normalizeShot, join, mixAudio, clamp };
