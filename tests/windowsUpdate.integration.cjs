const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { NsisUpdater } = require('electron-updater');
const { GitHubTagProvider } = require('../src/electron/githubTagProvider');
const {
  ElectronHttpExecutor,
} = require('electron-updater/out/electronHttpExecutor');
const {
  createWindowsInstallerUpdater,
} = require('../src/electron/windowsUpdate');
class NodeExecutor extends ElectronHttpExecutor {
  createRequest(options, callback) {
    return http.request(options, callback);
  }
  addRedirectHandlers() {}
}
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ypm-nsis-integration-')
  );
  const originalResourcesPath = process.resourcesPath;
  try {
    for (const corrupt of [false, true]) {
      const dir = path.join(root, corrupt ? 'corrupt' : 'success');
      await fs.mkdir(dir);
      const appImage = path.join(dir, 'installed-version-marker');
      const old = '#!/bin/sh\nexit 0\n';
      const next = '#!/bin/sh\n# verified new release\nexit 0\n';
      await fs.writeFile(appImage, old, { mode: 0o755 });
      process.resourcesPath = dir;
      const digest =
        'sha256:' + crypto.createHash('sha256').update(next).digest('hex');
      const server = http.createServer((req, res) => {
        if (req.url === '/releases/latest') {
          res.end(
            JSON.stringify({
              tag_name: 'v1.0.1',
              draft: false,
              prerelease: false,
              published_at: new Date().toISOString(),
              assets: [
                {
                  name: 'YesPlayMusic.Setup.1.0.1.exe',
                  state: 'uploaded',
                  size: Buffer.byteLength(next),
                  digest,
                  browser_download_url: `http://127.0.0.1:${server.address().port}/releases/download/v1.0.1/YesPlayMusic.Setup.1.0.1.exe`,
                },
              ],
            })
          );
        } else if (req.url.endsWith('.exe')) {
          res.end(corrupt ? next.replace('verified', 'tampered') : next);
        } else {
          res.statusCode = 404;
          res.end('No update manifests exist');
        }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const config = path.join(dir, 'app-update.yml');
        await fs.writeFile(config, 'updaterCacheDirName: update-test\n');
        const updater = new NsisUpdater(null, {
          version: '1.0.0',
          name: 'YesPlayMusic',
          isPackaged: true,
          userDataPath: dir,
          baseCachePath: dir,
          appUpdateConfigPath: config,
          whenReady: async () => {},
          onQuit() {},
          quit() {},
        });
        updater.httpExecutor = new NodeExecutor();
        updater.setFeedURL({
          provider: 'custom',
          platform: 'win32',
          updateProvider: GitHubTagProvider,
          arch: 'x64',
          apiUrl: `http://127.0.0.1:${server.address().port}/releases/latest`,
          repositoryUrl: `http://127.0.0.1:${server.address().port}`,
        });
        const launches = [];
        updater.spawnLog = async (file, args) => {
          launches.push({ file, args });
        };
        updater.disableDifferentialDownload = true;
        updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
        const messages = [];
        let finish;
        const done = new Promise(resolve => {
          finish = resolve;
        });
        const controller = createWindowsInstallerUpdater({
          updater,
          env: {},
          log() {},
          dialog: {
            showMessageBox: async options => {
              messages.push(options);
              finish();
              return { response: 1 };
            },
          },
        });
        await controller.check();
        let timeout;
        try {
          await Promise.race([
            done,
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Download timed out')),
                10000
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        await new Promise(resolve => setImmediate(resolve));
        if (corrupt) {
          assert.equal(messages[0].type, 'error');
          assert.match(messages[0].detail, /sha256|checksum/i);
          assert.equal(await fs.readFile(appImage, 'utf8'), old);
          assert.equal(updater.installerPath, null);
          assert.deepEqual(launches, []);
          console.log(
            'PASS: tampered HTTP payload rejected; installed application untouched'
          );
        } else {
          assert.equal(messages[0].title, '更新已下载');
          assert.equal(await fs.readFile(appImage, 'utf8'), old);
          const installer = updater.installerPath;
          assert.equal(await fs.readFile(installer, 'utf8'), next);
          assert.equal(updater.install(false, true), true);
          assert.equal(launches.length, 1);
          assert.equal(launches[0].file, path.join(dir, 'elevate.exe'));
          assert.deepEqual(launches[0].args, [
            installer,
            '--updated',
            '--force-run',
          ]);
          console.log(
            'PASS: real NSIS updater Release tag -> SHA256 download -> elevation and restart dispatch'
          );
        }
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    }
  } finally {
    process.resourcesPath = originalResourcesPath;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
