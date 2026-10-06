// macOS用: アプリに簡易署名(ad-hoc)を付ける。Appleの開発者証明書なしでも、Apple Silicon(M1以降)で起動できるようにするため。
const { execFileSync } = require('child_process'), path = require('path');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
