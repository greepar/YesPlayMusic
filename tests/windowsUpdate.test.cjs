const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { windowsUpdateInfo } = require('../src/electron/githubRelease');
const {
  isPortableWindows,
  createWindowsInstallerUpdater,
} = require('../src/electron/windowsUpdate');
const tick = () => new Promise(resolve => setImmediate(resolve));
function release() {
  return {
    tag_name: 'v0.6.19',
    assets: ['YesPlayMusic.0.6.19.exe', 'YesPlayMusic.Setup.0.6.19.exe'].map(
      name => ({
        name,
        size: 123,
        state: 'uploaded',
        digest: 'sha256:' + 'a'.repeat(64),
        browser_download_url: `https://github.com/greepar/YesPlayMusic/releases/download/v0.6.19/${name}`,
      })
    ),
  };
}
function fixture(response = 1, env = {}) {
  const updater = new EventEmitter();
  const calls = { checks: 0, downloads: 0, installs: [], dialogs: [] };
  updater.checkForUpdates = async () => {
    calls.checks++;
  };
  updater.downloadUpdate = async () => {
    calls.downloads++;
    updater.emit('update-downloaded', { version: '0.6.19' });
  };
  updater.quitAndInstall = (...args) => calls.installs.push(args);
  const controller = createWindowsInstallerUpdater({
    updater,
    env,
    log() {},
    dialog: {
      async showMessageBox(options) {
        calls.dialogs.push(options);
        return { response };
      },
    },
  });
  return { updater, calls, controller };
}
test('Windows selects Setup.exe even when portable asset appears first', () => {
  const info = windowsUpdateInfo(release(), 'x64');
  assert.equal(info.files.length, 1);
  assert.match(info.files[0].url, /YesPlayMusic.Setup.0.6.19.exe$/);
  assert.equal(info.files[0].isAdminRightsRequired, true);
  assert.equal(info.files[0].sha2, 'a'.repeat(64));
  const onlyPortable = release();
  onlyPortable.assets.pop();
  assert.throws(() => windowsUpdateInfo(onlyPortable, 'x64'), /尚未提供/);
  assert.throws(() => windowsUpdateInfo(release(), 'arm64'), /不支持/);
});
test('missing digest and unexpected asset host are rejected', () => {
  for (const change of [
    a => {
      a.digest = null;
    },
    a => {
      a.browser_download_url = 'https://example.com/installer.exe';
    },
  ]) {
    const r = release();
    change(r.assets[1]);
    assert.throws(() => windowsUpdateInfo(r, 'x64'));
  }
});
test('downloaded installer requires explicit restart and never installs on quit', async () => {
  const { updater, calls } = fixture();
  updater.emit('update-available', { version: '0.6.19' });
  await tick();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.dialogs.length, 1);
  assert.match(calls.dialogs[0].detail, /管理员/);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableDifferentialDownload, true);
  assert.equal(updater.disableWebInstaller, true);
  assert.deepEqual(calls.installs, []);
});
test('restart selection uses NSIS installation with relaunch', async () => {
  const { updater, calls } = fixture(0);
  updater.emit('update-available', { version: '0.6.19' });
  await tick();
  assert.deepEqual(calls.installs, [[false, true]]);
});
test('portable executable is not converted into an installed application', async () => {
  for (const env of [
    { PORTABLE_EXECUTABLE_FILE: 'C:\\Music.exe' },
    { PORTABLE_EXECUTABLE_DIR: 'C:\\Apps' },
  ]) {
    assert.equal(isPortableWindows(env), true);
    const { controller, calls } = fixture(0, env);
    await controller.check();
    assert.equal(calls.checks, 0);
    assert.equal(calls.downloads, 0);
  }
  assert.equal(isPortableWindows({}), false);
});
