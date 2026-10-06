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
const providers = {
  veo: {
    name: 'Google Veo (Gemini API)',
    aspects: ['16:9', '9:16'],
    configured: () => !!process.env.GEMINI_API_KEY,
    async start({ prompt, aspect }) {
      const model = process.env.VEO_MODEL || 'veo-3.1-generate-preview';
      const r = await upstream(`${GEMINI}/models/${model}:predictLongRunning`, {
        method: 'POST',
        body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: aspect } })
      });
      if (!r.name) throw new Error('操作IDが返りませんでした');
      return r.name;
    },
    async poll(ref) {
      const r = await upstream(`${GEMINI}/${ref}`);
      if (!r.done) return { status: 'running' };
      if (r.error) return { status: 'failed', error: r.error.message || '失敗' };
      const v = r.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      return v ? { status: 'done', videoUrl: v } : { status: 'failed', error: '動画が返りませんでした(安全フィルタ等の可能性)' };
    },
    async download(url) {
      if (!url.startsWith(GEMINI + '/') && !/^https:\/\/generativelanguage\.googleapis\.com\//.test(url)) throw new Error('不正なURL');
      return fetch(url, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, redirect: 'follow' });
    }
  }
};
async function upstream(url, opt = {}) {
  const res = await fetch(url, { ...opt, headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`上流API ${res.status}: ${j.error?.message || '失敗'}`);
  return j;
}

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
      return send(res, 200, Object.entries(providers).map(([id, p]) => ({ id, name: p.name, aspects: p.aspects, configured: p.configured() })));
    if (req.method === 'POST' && parts[1] === 'generate') {
      const b = await body(req), p = providers[b.provider];
      if (!p || !p.configured()) return send(res, 400, { error: 'このプロバイダはサーバーにキーが未設定です' });
      const prompt = String(b.prompt || '').trim();
      if (!prompt || prompt.length > 2000) return send(res, 400, { error: 'プロンプトは1〜2000文字' });
      const aspect = p.aspects.includes(b.aspect) ? b.aspect : p.aspects[0];
      const ref = await p.start({ prompt, aspect });
      const id = crypto.randomUUID();
      jobs.set(id, { provider: b.provider, ref, status: 'running' });
      return send(res, 200, { id });
    }
    if (req.method === 'GET' && parts[1] === 'jobs' && jobs.has(parts[2])) {
      const j = jobs.get(parts[2]), p = providers[j.provider];
      if (parts[3] === 'video') {
        if (j.status !== 'done') return send(res, 409, { error: '未完了' });
        const up = await p.download(j.videoUrl);
        if (!up.ok) return send(res, 502, { error: '動画取得失敗' });
        res.writeHead(200, { 'content-type': up.headers.get('content-type') || 'video/mp4', 'cache-control': 'no-store' });
        return up.body ? require('stream').Readable.fromWeb(up.body).pipe(res) : res.end();
      }
      if (j.status === 'running') Object.assign(j, await p.poll(j.ref));
      return send(res, 200, { status: j.status, error: j.error });   // videoUrl(上流URL)は返さない
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('error:', e.message);                     // キーは出力しない
    send(res, 500, { error: String(e.message).slice(0, 200) });
  }
}).listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}  (APP_TOKEN: ${APP_TOKEN ? '有効' : '未設定'})`));
