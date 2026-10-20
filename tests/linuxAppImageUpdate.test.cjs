const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  assertAppImageWritable,
  createLinuxAppImageUpdater,
} = require('../src/electron/linuxAppImageUpdate');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ response = 1, checkWritable = async () => {} } = {}) {
  const updater = new EventEmitter();
  const calls = { checks: 0, downloads: 0, installs: [], dialogs: [] };
  updater.checkForUpdates = async () => {
    calls.checks++;
    return { updateInfo: { version: '0.6.99' } };
  };
  updater.downloadUpdate = async () => {
    calls.downloads++;
  };
  updater.quitAndInstall = (...args) => calls.installs.push(args);
  const controller = createLinuxAppImageUpdater({
    updater,
    appImage: '/apps/YesPlayMusic.AppImage',
    checkWritable,
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

test('downloads available updates without enabling installation on quit', async () => {
  const { updater, calls, controller } = fixture();
  await controller.check();
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  assert.equal(calls.checks, 1);
  assert.equal(calls.downloads, 1);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.deepEqual(calls.installs, []);
});

test('later leaves the running app and downloaded update untouched', async () => {
  const { updater, calls } = fixture();
  updater.emit('update-downloaded', { version: '0.6.99' });
  await tick();
  assert.equal(calls.dialogs.length, 1);
  assert.equal(calls.dialogs[0].cancelId, 1);
  assert.deepEqual(calls.installs, []);
});

test('explicit restart rechecks permissions then installs and relaunches', async () => {
  let permissionsChecked = 0;
  const { updater, calls } = fixture({
    response: 0,
    checkWritable: async () => {
      permissionsChecked++;
    },
  });
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  updater.emit('update-downloaded', { version: '0.6.99' });
  await tick();
  assert.equal(permissionsChecked, 2);
  assert.deepEqual(calls.installs, [[false, true]]);
});

test('read-only installation reports an actionable error before downloading', async () => {
  const { updater, calls } = fixture({
    checkWritable: async () => {
      throw new Error('read-only directory');
    },
  });
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  assert.equal(calls.downloads, 0);
  assert.equal(calls.dialogs.length, 1);
  assert.match(calls.dialogs[0].detail, /read-only/);
  assert.deepEqual(calls.installs, []);
});

test('offline checks are quiet, concurrent checks share one request', async () => {
  const { updater, calls, controller } = fixture();
  updater.checkForUpdates = async () => {
    calls.checks++;
    throw new Error('offline');
  };
  await Promise.all([controller.check(), controller.check()]);
  assert.equal(calls.checks, 1);
  assert.deepEqual(calls.dialogs, []);
});

test('download errors emitted and rejected produce one dialog and allow retry', async () => {
  const { updater, calls } = fixture();
  updater.downloadUpdate = async () => {
    calls.downloads++;
    const error = new Error('checksum mismatch');
    updater.emit('error', error);
    throw error;
  };
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  assert.equal(calls.dialogs.length, 1);
  assert.deepEqual(calls.installs, []);
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  assert.equal(calls.downloads, 2);
  assert.equal(calls.dialogs.length, 2);
});

test('duplicate events cannot download twice or show multiple restart prompts', async () => {
  const { updater, calls } = fixture();
  updater.emit('update-available', { version: '0.6.99' });
  updater.emit('update-available', { version: '0.6.99' });
  await tick();
  updater.emit('update-downloaded', { version: '0.6.99' });
  updater.emit('update-downloaded', { version: '0.6.99' });
  await tick();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.dialogs.length, 1);
});

test('permissions revoked after download prevent installation', async () => {
  const { updater, calls } = fixture({
    response: 0,
    checkWritable: async () => {
      throw new Error('permission denied');
    },
  });
  updater.emit('update-downloaded', { version: '0.6.99' });
  await tick();
  assert.deepEqual(calls.installs, []);
  assert.equal(calls.dialogs.at(-1).type, 'error');
});

test(
  'file and parent directory must both be writable',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ypm-update-permissions-')
    );
    const file = path.join(dir, 'YesPlayMusic.AppImage');
    try {
      await fs.writeFile(file, 'test');
      await assertAppImageWritable(file);
      await fs.chmod(dir, 0o500);
      await assert.rejects(assertAppImageWritable(file), /无法写入/);
      await fs.chmod(dir, 0o700);
      await fs.chmod(file, 0o400);
      await assert.rejects(assertAppImageWritable(file), /无法写入/);
      await assert.rejects(
        assertAppImageWritable('relative.AppImage'),
        /AppImage/
      );
    } finally {
      await fs.chmod(dir, 0o700);
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);

const {
  releaseVersion,
  isNewerVersion,
  appImageUpdateInfo,
  latestRelease,
} = require('../src/electron/githubRelease');
function releaseFixture() {
  return {
    tag_name: 'v0.6.16',
    draft: false,
    prerelease: false,
    assets: ['x64', 'arm64'].map(arch => ({
      name: `YesPlayMusic-0.6.16-${arch}.AppImage`,
      state: 'uploaded',
      size: 100,
      digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: `https://github.com/greepar/YesPlayMusic/releases/download/v0.6.16/YesPlayMusic-0.6.16-${arch}.AppImage`,
    })),
  };
}
test('release tags use numeric version ordering and skip drafts and prereleases', () => {
  assert.equal(releaseVersion(releaseFixture()), '0.6.16');
  assert.equal(isNewerVersion('0.6.16', '0.6.9'), true);
  assert.equal(isNewerVersion('0.6.16', '0.6.16'), false);
  assert.equal(isNewerVersion('0.6.15', '0.6.16'), false);
  for (const invalid of [
    { draft: true },
    { prerelease: true },
    { tag_name: 'v0.6.16-beta.1' },
    { tag_name: 'main' },
  ]) {
    assert.throws(() => releaseVersion({ ...releaseFixture(), ...invalid }));
  }
});
test('AppImages are selected exactly by architecture and use the API asset digest', () => {
  for (const arch of ['x64', 'arm64']) {
    const info = appImageUpdateInfo(releaseFixture(), arch);
    assert.equal(info.version, '0.6.16');
    assert.equal(info.files.length, 1);
    assert.ok(info.files[0].url.endsWith(`-${arch}.AppImage`));
    assert.equal(info.files[0].sha2, 'a'.repeat(64));
  }
  const legacy = releaseFixture();
  legacy.assets[0].name = 'YesPlayMusic-0.6.16.AppImage';
  legacy.assets[0].browser_download_url =
    legacy.assets[0].browser_download_url.replace('-x64.AppImage', '.AppImage');
  assert.ok(
    appImageUpdateInfo(legacy, 'x64').files[0].url.endsWith('-0.6.16.AppImage')
  );
});
test('missing digest, wrong asset, unfinished upload, and unexpected download host are rejected', () => {
  for (const mutate of [
    r => {
      r.assets = r.assets.slice(1);
    },
    r => {
      r.assets[0].digest = null;
    },
    r => {
      r.assets[0].state = 'new';
    },
    r => {
      r.assets[0].browser_download_url = 'https://example.com/fake.AppImage';
    },
  ]) {
    const release = releaseFixture();
    mutate(release);
    assert.throws(() => appImageUpdateInfo(release, 'x64'));
  }
  assert.throws(() => appImageUpdateInfo(releaseFixture(), 'ia32'));
});
test('Windows and macOS release checks need no YAML manifest', async () => {
  const info = await latestRelease(async url => {
    assert.equal(
      url,
      'https://api.github.com/repos/greepar/YesPlayMusic/releases/latest'
    );
    return { ok: true, json: async () => releaseFixture() };
  });
  assert.equal(info.version, '0.6.16');
  await assert.rejects(
    latestRelease(async () => ({ ok: false, status: 403 })),
    /HTTP 403/
  );
});

test('electron-builder x86_64 asset name is accepted for Node x64', () => {
  const release = releaseFixture();
  release.assets[0].name = release.assets[0].name.replace('-x64.', '-x86_64.');
  release.assets[0].browser_download_url =
    release.assets[0].browser_download_url.replace('-x64.', '-x86_64.');
  assert.ok(
    appImageUpdateInfo(release, 'x64').files[0].url.endsWith('-x86_64.AppImage')
  );
});
