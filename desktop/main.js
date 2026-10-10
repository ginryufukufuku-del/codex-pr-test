// 動画生成AIハブ デスクトップアプリ(Electron)
// ローカルの server.js を 127.0.0.1 のランダムポートで起動し、ウィンドウに表示する。
// APIキーは macOS のキーチェーン連携(safeStorage)で暗号化して保存し、画面(ブラウザ側)には渡さない。
const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell, session } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');

const KEY_NAMES = ['GEMINI_API_KEY', 'RUNWAY_API_KEY', 'LUMA_API_KEY', 'FAL_KEY', 'ANTHROPIC_API_KEY'];
const keyFile = () => path.join(app.getPath('userData'), 'keys.json');
let mainWin = null, settingsWin = null, origin = '';

const readKeys = () => { try { return JSON.parse(fs.readFileSync(keyFile(), 'utf8')); } catch { return {}; } };
function applyKeys() {                       // 保存済みキーを復号して環境変数へ(server.js が呼び出し時に読む)
  const k = readKeys();
  for (const n of KEY_NAMES) {
    delete process.env[n];
    if (k[n]) { try { process.env[n] = safeStorage.decryptString(Buffer.from(k[n], 'base64')); } catch {} }
  }
}
function writeKeys(k) { fs.writeFileSync(keyFile(), JSON.stringify(k), { mode: 0o600 }); }

function registerIpc() {
  const fromSettings = e => settingsWin && e.sender === settingsWin.webContents;   // 設定画面からのみ受け付ける
  ipcMain.handle('keys:status', e => { if (!fromSettings(e)) return {}; const k = readKeys(); return Object.fromEntries(KEY_NAMES.map(n => [n, !!k[n]])); });
  ipcMain.handle('keys:set', (e, name, value) => {
    if (!fromSettings(e) || !KEY_NAMES.includes(name) || typeof value !== 'string' || !value || value.length > 512) return false;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('この環境では暗号化保存が使えないため、キーを保存できません');
    const k = readKeys(); k[name] = safeStorage.encryptString(value).toString('base64'); writeKeys(k);
    applyKeys(); mainWin && mainWin.reload(); return true;
  });
  ipcMain.handle('keys:clear', (e, name) => {
    if (!fromSettings(e) || !KEY_NAMES.includes(name)) return false;
    const k = readKeys(); delete k[name]; writeKeys(k); applyKeys(); mainWin && mainWin.reload(); return true;
  });
}

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({ width: 640, height: 420, title: 'APIキー設定', parent: mainWin || undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.webContents.on('will-navigate', e => e.preventDefault());
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openExternal(url) { if (/^https?:\/\//i.test(url)) shell.openExternal(url); }

async function startServer() {
  const token = crypto.randomBytes(24).toString('hex');
  process.env.HOST = '127.0.0.1'; process.env.PORT = '0'; process.env.APP_TOKEN = token;   // 読み込み前に設定
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'projects');                    // 制作物の保存先
  try { process.env.FFMPEG_PATH = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'); } catch {}   // 同梱の ffmpeg
  const server = require('./app/server.js');
  if (!server.listening) await new Promise(ok => server.once('listening', ok));
  origin = `http://127.0.0.1:${server.address().port}`;
  // トークンはアプリ内部でだけ付与(画面のJavaScriptには見えない)
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (d, cb) => {
    d.requestHeaders['x-app-token'] = token; cb({ requestHeaders: d.requestHeaders });
  });
}

function createWindow() {
  mainWin = new BrowserWindow({ width: 1100, height: 900, minWidth: 360, title: '動画生成AIハブ',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWin.loadURL(origin + '/');
  mainWin.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin + '/')) { e.preventDefault(); openExternal(url); } });
  // 生成した動画は右クリックで保存できる
  mainWin.webContents.on('context-menu', (e, p) => {
    const items = [];
    if (p.mediaType === 'video') items.push({ label: '動画を保存…', click: () => mainWin.webContents.downloadURL(p.srcURL) });
    if (p.isEditable) items.push({ role: 'cut', label: '切り取り' }, { role: 'copy', label: 'コピー' }, { role: 'paste', label: '貼り付け' });
    else if (p.selectionText) items.push({ role: 'copy', label: 'コピー' });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '動画生成AIハブ', submenu: [
      { label: 'APIキー設定…', accelerator: 'CmdOrCtrl+,', click: openSettings }, { type: 'separator' },
      { role: 'hide', label: '動画生成AIハブを隠す' }, { role: 'hideOthers', label: 'ほかを隠す' }, { type: 'separator' },
      { role: 'quit', label: '終了' }] },
    { label: '編集', submenu: [
      { role: 'undo', label: '取り消す' }, { role: 'redo', label: 'やり直す' }, { type: 'separator' },
      { role: 'cut', label: '切り取り' }, { role: 'copy', label: 'コピー' }, { role: 'paste', label: '貼り付け' }, { role: 'selectAll', label: 'すべてを選択' }] },
    { label: '表示', submenu: [{ role: 'reload', label: '再読み込み' }, { role: 'togglefullscreen', label: 'フルスクリーン' }] },
    { label: 'ウィンドウ', submenu: [{ role: 'minimize', label: 'しまう' }, { role: 'close', label: '閉じる' }] }
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(async () => {
    registerIpc(); applyKeys(); buildMenu(); await startServer(); createWindow();
    app.on('activate', () => { if (!mainWin) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
