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
const PORT = +process.env.PORT || 8000;
const APP_TOKEN = process.env.APP_TOKEN || '';   // 公開時は必ず設定(UIで入力)
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

// ---- プロバイダ・アダプタ(キーはここだけで使う) ----
// 全プロバイダは従量課金。paid:true は /api/generate で confirmPaid:true を必須にする。
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
  fal: {
    name: 'Kling 等 (fal.ai経由)', paid: true, aspects: ['16:9', '9:16', '1:1'],
    configured: () => !!process.env.FAL_KEY,
    h: () => ({ authorization: 'Key ' + process.env.FAL_KEY }),
    async start({ prompt, aspect }) {
      const model = process.env.FAL_MODEL || 'fal-ai/kling-video/v2.1/master/text-to-video';
      if (!/^[\w./-]+$/.test(model)) throw new Error('FAL_MODELが不正です');
      const r = await call(`https://queue.fal.run/${model}`, this.h(), { method: 'POST', body: JSON.stringify({ prompt, aspect_ratio: aspect }) });
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

// ---- ジョブ(メモリ上) ----
const jobs = new Map();
const hits = new Map();
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 30; };
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, ng) => { let d = ''; req.on('data', c => { d += c; if (d.length > 20000) { ng(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ng(new Error('bad json')); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const STATIC = new Set(['index.html', 'app.js', 'style.css']);

http.createServer(async (req, res) => {
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
      return send(res, 200, Object.entries(providers).map(([id, p]) => ({ id, name: p.name, paid: p.paid, aspects: p.aspects, configured: p.configured() })));
    if (req.method === 'POST' && parts[1] === 'generate') {
      const b = await body(req), p = providers[b.provider];
      if (!p || !p.configured()) return send(res, 400, { error: 'このプロバイダはサーバーにキーが未設定です' });
      const prompt = String(b.prompt || '').trim();
      if (!prompt || prompt.length > 2000) return send(res, 400, { error: 'プロンプトは1〜2000文字' });
      if (p.paid && b.confirmPaid !== true) return send(res, 400, { error: '有料APIです。料金発生の確認が必要です(confirmPaid)' });
      const aspect = p.aspects.includes(b.aspect) ? b.aspect : p.aspects[0];
      const id = crypto.randomUUID();
      jobs.set(id, { provider: b.provider, ...(await p.start({ prompt, aspect })), status: 'running' });
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
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('error:', e.message);                     // キーは出力しない
    send(res, 500, { error: String(e.message).slice(0, 200) });
  }
}).listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}  (APP_TOKEN: ${APP_TOKEN ? '有効' : '未設定'})`));
