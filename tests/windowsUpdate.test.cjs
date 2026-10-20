const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
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
  assert.throws(() => windowsUpdateInfo(release(), 'ia32'), /不支持/);
  assert.throws(() => windowsUpdateInfo(release(), 'arm64'), /尚未提供/);
});

test('Windows x64 and ARM64 select only their own installer; x64 retains legacy compatibility', () => {
  const r = release();
  for (const arch of ['arm64', 'x64']) {
    const name = `YesPlayMusic.Setup.0.6.19-${arch}.exe`;
    r.assets.push({
      ...r.assets[1],
      name,
      browser_download_url: `https://github.com/greepar/YesPlayMusic/releases/download/v0.6.19/${name}`,
    });
  }
  for (const arch of ['x64', 'arm64'])
    assert.ok(windowsUpdateInfo(r, arch).files[0].url.endsWith(`-${arch}.exe`));
  r.assets = r.assets.filter(a => !a.name.endsWith('-arm64.exe'));
  assert.throws(() => windowsUpdateInfo(r, 'arm64'), /尚未提供/);
});

test('Windows build produces separate x64 and ARM64 outputs and retains the legacy x64 update asset', async () => {
  // CI runs unit tests before dependencies are installed. Webpack is only used
  // by lazy configuration callbacks, so evaluating this config needs no bundle.
  const projectRequire = createRequire(
    path.join(__dirname, '../vue.config.js')
  );
  const context = {
    module: { exports: {} },
    process,
    __dirname: path.join(__dirname, '..'),
    require: name => (name === 'webpack' ? {} : projectRequire(name)),
  };
  vm.runInNewContext(
    await fs.readFile(path.join(__dirname, '../vue.config.js'), 'utf8'),
    context
  );
  const config =
    context.module.exports.pluginOptions.electronBuilder.builderOptions;
  for (const target of config.win.target)
    assert.equal(target.arch.join(','), 'x64,arm64');
  assert.equal(config.nsis.buildUniversalInstaller, false);
  assert.equal(config.portable.buildUniversalInstaller, false);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ypm-win-artifacts-'));
  try {
    const artifacts = [];
    for (const arch of ['x64', 'arm64']) {
      const name = `YesPlayMusic.Setup.1.0.1-${arch}.exe`;
      const file = path.join(dir, name);
      artifacts.push(file);
      await fs.writeFile(file, arch);
    }
    const aliases = await require('../build/windows-update-alias.cjs')({
      artifactPaths: artifacts,
    });
    assert.deepEqual(aliases, [path.join(dir, 'YesPlayMusic.Setup.1.0.1.exe')]);
    assert.equal(await fs.readFile(aliases[0], 'utf8'), 'x64');
    assert.equal(await fs.readFile(artifacts[1], 'utf8'), 'arm64');
    for (const [arch, folder, machine] of [
      ['x64', 'win-unpacked', 0x8664],
      ['arm64', 'win-arm64-unpacked', 0xaa64],
    ]) {
      const pe = Buffer.alloc(128);
      pe.writeUInt16LE(0x5a4d, 0);
      pe.writeUInt32LE(64, 0x3c);
      pe.writeUInt32LE(0x4550, 64);
      pe.writeUInt16LE(machine, 68);
      await fs.mkdir(path.join(dir, folder));
      await fs.writeFile(path.join(dir, folder, 'YesPlayMusic.exe'), pe);
      await fs.writeFile(
        path.join(dir, `YesPlayMusic.1.0.1-${arch}.exe`),
        arch
      );
    }
    const {
      verifyWindowsArtifacts,
    } = require('../build/verify-windows-artifacts.cjs');
    await verifyWindowsArtifacts(dir, '1.0.1');
    const wrong = await fs.readFile(
      path.join(dir, 'win-arm64-unpacked/YesPlayMusic.exe')
    );
    wrong.writeUInt16LE(0x8664, 68);
    await fs.writeFile(
      path.join(dir, 'win-arm64-unpacked/YesPlayMusic.exe'),
      wrong
    );
    await assert.rejects(verifyWindowsArtifacts(dir, '1.0.1'), /Wrong arm64/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
