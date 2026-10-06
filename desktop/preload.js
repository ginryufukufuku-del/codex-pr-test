// 設定画面用: キーの「設定済みかどうか」と保存だけを公開(保存済みのキー本体は画面に返さない)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('keys', {
  status: () => ipcRenderer.invoke('keys:status'),
  set: (name, value) => ipcRenderer.invoke('keys:set', name, value),
  clear: name => ipcRenderer.invoke('keys:clear', name)
});
