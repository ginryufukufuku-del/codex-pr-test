// 動画生成AIハブ: 依存なしのNodeサーバー。APIキーは環境変数/.envからのみ読み、ブラウザには一切渡さない。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

// .env を読む(既存の環境変数を優先)
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const HOST = process.env.HOST || '127.0.0.1';   // 既定はローカルのみ
const PORT = process.env.PORT === undefined || process.env.PORT === '' ? 8000 : +process.env.PORT;   // '0' は空きポート自動選択(デスクトップアプリ用)
const APP_TOKEN = process.env.APP_TOKEN || '';   // 公開時は必ず設定(UIで入力)
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

// ---- プロバイダ・アダプタ(キーはここだけで使う) ----
// 全プロバイダは従量課金。paid:true は /api/generate で confirmPaid:true を必須にする。
const LUMA = 'https://api.lumalabs.ai/dream-machine/v1';
const RUNWAY = 'https://api.dev.runwayml.com/v1';
const hostOk = (u, re) => { try { const x = new URL(u); return x.protocol === 'https:' && re.test(x.hostname); } catch { return false; } };
async function call(url, headers, opt = {}) {
  const res = await fetch(url, { ...opt, headers: { 'content-type': 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`上流API ${res.status}: ${j.error?.message || j.message || j.detail || '失敗'}`);
  return j;
}
const providers = {
  veo: {
    name: 'Google Veo (Gemini API)', paid: true, aspects: ['16:9', '9:16'],
    configured: () => !!process.env.GEMINI_API_KEY,
    h: () => ({ 'x-goog-api-key': process.env.GEMINI_API_KEY }),
    async start({ prompt, aspect }) {
      const model = process.env.VEO_MODEL || 'veo-3.1-generate-preview';
      const r = await call(`${GEMINI}/models/${model}:predictLongRunning`, this.h(),
        { method: 'POST', body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: aspect } }) });
      if (!r.name) throw new Error('操作IDが返りませんでした');
      return { ref: r.name };
    },
    async poll(j) {
      const r = await call(`${GEMINI}/${j.ref}`, this.h());
      if (!r.done) return { status: 'running' };
      if (r.error) return { status: 'failed', error: r.error.message || '失敗' };
      const v = r.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      return v && hostOk(v, /^generativelanguage\.googleapis\.com$/) ? { status: 'done', videoUrl: v, dlAuth: true } : { status: 'failed', error: '動画が返りませんでした(安全フィルタ等の可能性)' };
    },
    dlHeaders() { return this.h(); }
  },
  runway: {
    name: 'Runway', paid: true, aspects: ['16:9', '9:16'],
    configured: () => !!process.env.RUNWAY_API_KEY,
    h: () => ({ authorization: 'Bearer ' + process.env.RUNWAY_API_KEY, 'x-runway-version': '2024-11-06' }),
    async start({ prompt, aspect }) {
      const r = await call(`${RUNWAY}/text_to_video`, this.h(), { method: 'POST', body: JSON.stringify({
        model: process.env.RUNWAY_MODEL || 'gen4.5', promptText: prompt, ratio: aspect === '9:16' ? '720:1280' : '1280:720', duration: 5 }) });
      if (!r.id) throw new Error('タスクIDが返りませんでした');
      return { ref: r.id };
    },
    async poll(j) {
      const r = await call(`${RUNWAY}/tasks/${encodeURIComponent(j.ref)}`, this.h());
      if (r.status === 'FAILED') return { status: 'failed', error: r.failure || '失敗' };
      const v = r.output?.[0];
      return r.status === 'SUCCEEDED' && v && hostOk(v, /./) ? { status: 'done', videoUrl: v } : { status: 'running' };
    },
    dlHeaders: () => ({})   // 署名付きURLなのでキーは送らない
  },
  luma: {
    name: 'Luma Dream Machine', paid: true, aspects: ['16:9', '9:16', '1:1'],
    configured: () => !!process.env.LUMA_API_KEY,
    h: () => ({ authorization: 'Bearer ' + process.env.LUMA_API_KEY }),
    async start({ prompt, aspect }) {
      const r = await call(`${LUMA}/generations/video`, this.h(), { method: 'POST', body: JSON.stringify({
        prompt, model: process.env.LUMA_MODEL || 'ray-2', aspect_ratio: aspect }) });
      if (!r.id) throw new Error('生成IDが返りませんでした');
      return { ref: r.id };
    },
    async poll(j) {
      const r = await call(`${LUMA}/generations/${encodeURIComponent(j.ref)}`, this.h());
      if (r.state === 'failed') return { status: 'failed', error: r.failure_reason || '失敗' };
      const v = r.assets?.video;
      return r.state === 'completed' && v && hostOk(v, /./) ? { status: 'done', videoUrl: v } : { status: 'running' };
    },
    dlHeaders: () => ({})
  },
  fal: {
    name: 'fal.ai経由(Kling/Hailuo/Wan/Seedance)', paid: true, aspects: ['16:9', '9:16', '1:1'],
    // 公式ページでIDを確認済みのモデルのみ許可。aspect:true のモデルだけ aspect_ratio を送る(他は未確認のため送らない)
    models: [
      { id: 'fal-ai/kling-video/v2.1/master/text-to-video', label: 'Kling v2.1 Master', aspect: true },
      { id: 'fal-ai/minimax/hailuo-02/standard/text-to-video', label: 'MiniMax Hailuo 02 Standard (768p)', aspect: false },
      { id: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', label: 'MiniMax Hailuo 2.3 Standard (768p)', aspect: false },
      { id: 'alibaba/wan-3.0/text-to-video', label: 'Alibaba Wan 3.0', aspect: false },
      { id: 'bytedance/seedance-2.0/text-to-video', label: 'ByteDance Seedance 2.0', aspect: false }
    ],
    configured: () => !!process.env.FAL_KEY,
    h: () => ({ authorization: 'Key ' + process.env.FAL_KEY }),
    async start({ prompt, aspect, model }) {
      const m = model === undefined ? this.models[0] : this.models.find(x => x.id === model);
      if (!m) throw new Error('未対応のモデルです');
      const body = m.aspect ? { prompt, aspect_ratio: aspect } : { prompt };
      const r = await call(`https://queue.fal.run/${m.id}`, this.h(), { method: 'POST', body: JSON.stringify(body) });
      if (!hostOk(r.status_url, /(^|\.)fal\.(run|ai)$/) || !hostOk(r.response_url, /(^|\.)fal\.(run|ai)$/)) throw new Error('不正な応答');
      return { ref: r.request_id, statusUrl: r.status_url, responseUrl: r.response_url };
    },
    async poll(j) {
      const s = await call(j.statusUrl, this.h());
      if (s.status !== 'COMPLETED') return { status: 'running' };
      const r = await call(j.responseUrl, this.h());
      const v = r.video?.url;
      return v && hostOk(v, /./) ? { status: 'done', videoUrl: v } : { status: 'failed', error: '動画が返りませんでした' };
    },
    dlHeaders: () => ({})
  }
};

// ---- AI制作チーム(4人のエージェント) ----
const studio = require('./studio'), media = require('./media'), voice = require('./voice'), { fetchAozora } = require('./aozora');
if (process.env.STUDIO_MOCK === '1') providers.mock = require('./test/studio-mock').mockProvider(require('os').tmpdir());   // テスト用
studio.init(providers);

// ---- ジョブ(メモリ上) ----
const jobs = new Map();
const hits = new Map();
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 120; };   // 制作の進み具合を数秒ごとに問い合わせるため余裕を持たせる
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = (req, max = 20000) => new Promise((ok, ng) => { let d = ''; req.on('data', c => { d += c; if (d.length > max) { ng(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ng(new Error('bad json')); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const STATIC = new Set(['index.html', 'app.js', 'style.css']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
  try {
    if (!url.pathname.startsWith('/api/')) {
      const f = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!STATIC.has(f)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] });
      return res.end(fs.readFileSync(path.join(__dirname, f)));
    }
    // ---- API: 認証・CSRF・レート制限 ----
    if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'リクエストが多すぎます' });
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'origin不一致' });
    if (APP_TOKEN) {
      const t = req.headers['x-app-token'] || url.searchParams.get('t') || '';
      if (!safeEq(String(t), APP_TOKEN)) return send(res, 401, { error: '認証が必要です' });
    }
    const parts = url.pathname.split('/').filter(Boolean); // api, ...
    if (req.method === 'GET' && parts[1] === 'providers')
      return send(res, 200, Object.entries(providers).map(([id, p]) => ({ id, name: p.name, paid: p.paid, aspects: p.aspects, models: p.models, configured: p.configured() })));
    if (req.method === 'POST' && parts[1] === 'generate') {
      const b = await body(req), p = providers[b.provider];
      if (!p || !p.configured()) return send(res, 400, { error: 'このプロバイダはサーバーにキーが未設定です' });
      const prompt = String(b.prompt || '').trim();
      if (!prompt || prompt.length > 2000) return send(res, 400, { error: 'プロンプトは1〜2000文字' });
      if (p.paid && b.confirmPaid !== true) return send(res, 400, { error: '有料APIです。料金発生の確認が必要です(confirmPaid)' });
      const aspect = p.aspects.includes(b.aspect) ? b.aspect : p.aspects[0];
      const id = crypto.randomUUID();
      jobs.set(id, { provider: b.provider, ...(await p.start({ prompt, aspect, model: b.model })), status: 'running' });
      return send(res, 200, { id });
    }
    if (req.method === 'GET' && parts[1] === 'jobs' && jobs.has(parts[2])) {
      const j = jobs.get(parts[2]), p = providers[j.provider];
      if (parts[3] === 'video') {
        if (j.status !== 'done') return send(res, 409, { error: '未完了' });
        const up = await fetch(j.videoUrl, { headers: p.dlHeaders(), redirect: 'follow', signal: AbortSignal.timeout(120000) });
        if (!up.ok) return send(res, 502, { error: '動画取得失敗' });
        res.writeHead(200, { 'content-type': up.headers.get('content-type') || 'video/mp4', 'cache-control': 'no-store' });
        return up.body ? require('stream').Readable.fromWeb(up.body).pipe(res) : res.end();
      }
      if (j.status === 'running') Object.assign(j, await p.poll(j));
      return send(res, 200, { status: j.status, error: j.error });   // videoUrl(上流URL)は返さない
    }
    if (parts[1] === 'studio') return await studioApi(req, res, parts);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('error:', e.message);                     // キーは出力しない
    send(res, 500, { error: String(e.message).slice(0, 200) });
  }
});
async function studioApi(req, res, parts) {
  const intIn = (v, lo, hi, d) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
  if (req.method === 'GET' && parts[2] === 'status') {
    const sp = await voice.speakers();
    return send(res, 200, { configured: studio.configured(), ffmpeg: await media.available(), model: studio.MODEL, voices: sp.length, voiceNames: [...new Set(sp.map(s => s.character))] });
  }
  if (req.method === 'POST' && parts[2] === 'aozora') {
    const b = await body(req);
    try { return send(res, 200, await fetchAozora(String(b.url || ''))); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && parts[2] === 'bgm') {   // BGM の音声ファイル(30MBまで)
    const type = String(req.headers['content-type'] || '');
    const ext = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg' }[type.split(';')[0]];
    if (!ext) return send(res, 400, { error: '音声ファイル(mp3/wav/m4a/aac/ogg)を選んでください' });
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 30 * 1024 * 1024) return send(res, 413, { error: '30MBまでです' }); chunks.push(c); }
    const id = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(studio.uploadDir(), id), Buffer.concat(chunks));
    return send(res, 200, { bgmId: id });
  }
  if (req.method === 'POST' && parts[2] === 'start') {
    if (!studio.configured()) return send(res, 400, { error: 'Claude の APIキー(ANTHROPIC_API_KEY)が未設定です' });
    if (!(await media.available())) return send(res, 400, { error: 'ffmpeg が見つかりません' });
    const b = await body(req, 120000), p = providers[b.provider];
    if (b.confirmPaid !== true) return send(res, 400, { error: '有料です。料金発生の確認が必要です(confirmPaid)' });
    if (!p || !p.configured()) return send(res, 400, { error: 'この動画生成AIはキーが未設定です' });
    const brief = String(b.brief || '').trim(), text = String(b.sourceText || '').trim();
    if (!brief || brief.length > 2000) return send(res, 400, { error: '依頼内容は1〜2000文字で入力してください' });
    if (text.length > 45000) return send(res, 400, { error: '原作の文章が長すぎます(45000文字まで)' });
    let bgmFile = null;
    if (b.bgmId) {
      if (!/^[0-9a-f-]{36}\.(mp3|wav|m4a|aac|ogg)$/.test(b.bgmId)) return send(res, 400, { error: 'BGMの指定が不正です' });
      bgmFile = path.join(studio.uploadDir(), b.bgmId);
      if (!fs.existsSync(bgmFile)) return send(res, 400, { error: 'BGMが見つかりません。もう一度選んでください' });
    }
    try {
      const id = await studio.start({ brief, aspect: p.aspects.includes(b.aspect) ? b.aspect : p.aspects[0], provider: b.provider,
        model: p.models ? b.model : undefined, targetSec: intIn(b.targetSec, 5, 120, 30), maxShots: intIn(b.maxShots, 1, 12, 4),
        maxGenerations: intIn(b.maxGenerations, 1, 20, 6), rounds: intIn(b.rounds, 1, 3, 2), useVoice: b.useVoice !== false, bgmFile,
        source: { text: text || '(原作なし。依頼内容から自由に創作)', title: String(b.sourceTitle || '').slice(0, 100), author: String(b.sourceAuthor || '').slice(0, 100),
          credit: String(b.sourceCredit || '').slice(0, 300), truncated: !!b.sourceTruncated } });
      return send(res, 200, { id });
    } catch (e) { return send(res, 409, { error: e.message }); }
  }
  const id = parts[2];
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return send(res, 404, { error: 'not found' });
  if (req.method === 'POST' && parts[3] === 'stop') return send(res, 200, { ok: studio.stop(id) });
  if (req.method === 'GET' && parts[3] === 'final') {
    const f = studio.finalFile(id);
    if (!f || !fs.existsSync(f)) return send(res, 404, { error: 'まだ完成していません' });
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': fs.statSync(f).size, 'cache-control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  if (req.method === 'GET' && !parts[3]) { const v = studio.view(id); return v ? send(res, 200, v) : send(res, 404, { error: 'not found' }); }
  send(res, 404, { error: 'not found' });
}

server.listen(PORT, HOST, () => console.log(`http://${HOST}:${server.address().port}  (APP_TOKEN: ${APP_TOKEN ? '有効' : '未設定'})`));
module.exports = server;   // デスクトップアプリ(Electron)から読み込めるようにする
