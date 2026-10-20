const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { macUpdateInfo } = require('../src/electron/githubRelease');
const {
  downloadMacArchive,
  verifyMacBundle,
  MacAppUpdater,
  assertMacAppWritable,
  cleanupMacUpdates,
} = require('../src/electron/macUpdate');
const {
  createDownloadedUpdateController,
} = require('../src/electron/downloadedUpdate');
const { MAC_INSTALL_SCRIPT } = require('../src/electron/macInstallScript');
function release() {
  return {
    tag_name: 'v1.0.1',
    assets: ['x64', 'arm64'].map(arch => ({
      name: `YesPlayMusic-mac-1.0.1-${arch}.zip`,
      state: 'uploaded',
      size: 100,
      digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: `https://github.com/greepar/YesPlayMusic/releases/download/v1.0.1/YesPlayMusic-mac-1.0.1-${arch}.zip`,
    })),
  };
}
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'ypm-mac-test-'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const {
  createUpdateCheckScheduler,
} = require('../src/electron/updateScheduler');

test('disabled automatic checks schedule no requests; toggling takes effect immediately', () => {
  let enabled = false;
  let checks = 0;
  let timerCallback;
  let timers = 0;
  let cancelled = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: () => enabled,
    check: () => {
      checks++;
    },
    setTimer(callback) {
      timers++;
      timerCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      cancelled++;
    },
  });
  scheduler.refresh();
  assert.equal(checks, 0);
  assert.equal(timers, 0);
  enabled = true;
  scheduler.refresh();
  assert.equal(checks, 1);
  timerCallback();
  assert.equal(checks, 2);
  enabled = false;
  scheduler.refresh();
  timerCallback(); // Even an already queued callback must respect the switch.
  assert.equal(checks, 2);
  assert.equal(cancelled, 1);
  scheduler.stop();
});

test('turning off auto checks suppresses pending notifications, but manual checks still prompt', async () => {
  const updater = new EventEmitter();
  let autoEnabled = true;
  let finish;
  let prompts = 0;
  updater.checkForUpdates = () =>
    new Promise(resolve => {
      finish = () => {
        updater.emit('update-available', { version: '1.0.1' });
        resolve();
      };
    });
  const controller = createDownloadedUpdateController({
    updater,
    confirmBeforeDownload: true,
    canNotify: () => autoEnabled,
    log() {},
    dialog: {
      async showMessageBox() {
        prompts++;
        return { response: 1 };
      },
    },
  });
  const automatic = controller.check();
  await tick();
  autoEnabled = false;
  finish();
  await automatic;
  assert.equal(prompts, 0);
  const manual = controller.check({ manual: true });
  await tick();
  finish();
  const result = await manual;
  await tick();
  assert.equal(prompts, 1);
  assert.equal(result.status, 'available');
  assert.equal(result.version, '1.0.1');
});

test('manual checks distinguish latest version from network failure without error popups', async () => {
  const updater = new EventEmitter();
  let dialogs = 0;
  const controller = createDownloadedUpdateController({
    updater,
    log() {},
    dialog: {
      async showMessageBox() {
        dialogs++;
      },
    },
  });
  updater.checkForUpdates = async () => null;
  assert.equal((await controller.check({ manual: true })).status, 'up-to-date');
  updater.checkForUpdates = async () => {
    throw new Error('offline');
  };
  const result = await controller.check({ manual: true });
  assert.equal(result.status, 'error');
  assert.equal(result.message, 'offline');
  assert.equal(dialogs, 0);
});

test('mac asks before downloading; later and unapproved events never download or install', async () => {
  const updater = new EventEmitter();
  let answer;
  let downloads = 0;
  let installs = 0;
  const prompts = [];
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit('update-downloaded', { version: '1.0.1' });
  };
  updater.quitAndInstall = async () => {
    installs++;
  };
  createDownloadedUpdateController({
    updater,
    confirmBeforeDownload: true,
    log() {},
    dialog: {
      showMessageBox(options) {
        prompts.push(options);
        return new Promise(resolve => {
          answer = resolve;
        });
      },
    },
  });
  updater.emit('update-downloaded', { version: '1.0.1' });
  assert.equal(installs, 0);
  updater.emit('update-available', { version: '1.0.1' });
  updater.emit('update-available', { version: '1.0.1' });
  await tick();
  assert.equal(prompts.length, 1);
  assert.equal(downloads, 0);
  answer({ response: 1 });
  await tick();
  assert.equal(downloads, 0);
  assert.equal(installs, 0);
  updater.emit('update-available', { version: '1.0.1' });
  answer({ response: 0 });
  await tick();
  assert.equal(downloads, 1);
  assert.equal(installs, 1);
  assert.equal(prompts.length, 2); // One consent dialog, no second restart prompt.
});

test('startup cleanup only removes the successfully launched transaction for this app and version', async () =>
  withDir(async dir => {
    const target = path.join(dir, 'Music.app');
    const cacheDir = path.join(dir, 'cache');
    await fs.mkdir(target);
    await fs.mkdir(cacheDir);
    const currentApp = await fs.realpath(target);
    const script = `install-${crypto.randomUUID()}.sh`;
    const archive = path.join(cacheDir, 'YesPlayMusic-1.0.1-arm64.zip');
    await fs.writeFile(archive, 'archive');
    await fs.writeFile(path.join(cacheDir, script), 'script');
    const unrelated = path.join(cacheDir, 'YesPlayMusic-1.0.2-arm64.zip');
    await fs.writeFile(unrelated, 'newer download');
    for (const [name, changes, launched] of [
      ['matching', {}, true],
      ['not-launched', {}, false],
      ['other-app', { target: path.join(dir, 'Other.app') }, true],
      ['other-version', { version: '1.0.2' }, true],
    ]) {
      const stage = path.join(dir, `.yesplaymusic-update-${name}`);
      await fs.mkdir(path.join(stage, 'Previous.app'), { recursive: true });
      await fs.writeFile(
        path.join(stage, 'pending-update.json'),
        JSON.stringify({
          format: 1,
          target: currentApp,
          version: '1.0.1',
          arch: 'arm64',
          script,
          ...changes,
        })
      );
      if (launched)
        await fs.writeFile(path.join(stage, 'launch-succeeded'), '');
    }
    await cleanupMacUpdates({ currentApp, cacheDir, version: '1.0.0' });
    assert.ok(await fs.stat(archive));
    await cleanupMacUpdates({ currentApp, cacheDir, version: '1.0.1' });
    for (const name of ['matching'])
      await assert.rejects(
        fs.stat(path.join(dir, `.yesplaymusic-update-${name}`)),
        { code: 'ENOENT' }
      );
    for (const name of ['not-launched', 'other-app', 'other-version'])
      assert.ok(
        await fs.stat(
          path.join(dir, `.yesplaymusic-update-${name}/Previous.app`)
        )
      );
    await assert.rejects(fs.stat(archive), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(cacheDir, script)), {
      code: 'ENOENT',
    });
    assert.ok(await fs.stat(unrelated));
    assert.ok(await fs.stat(target));
  }));
async function withDir(action) {
  const dir = await temp();
  try {
    await action(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('mac selects architecture-specific ZIP and rejects DMG-only releases', () => {
  for (const arch of ['x64', 'arm64'])
    assert.ok(
      macUpdateInfo(release(), arch).files[0].url.endsWith(`-${arch}.zip`)
    );
  const r = release();
  r.assets = r.assets.map(a => ({
    ...a,
    name: a.name.replace('.zip', '.dmg'),
  }));
  assert.throws(() => macUpdateInfo(r, 'x64'), /尚未提供/);
  assert.throws(() => macUpdateInfo(release(), 'ia32'), /不支持/);
});
test('streamed download validates size and digest and rejects corrupted archives', async () =>
  withDir(async dir => {
    const bytes = Buffer.from('test archive');
    const asset = {
      url: 'https://example.test/app.zip',
      size: bytes.length,
      sha2: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    const destination = path.join(dir, 'update.zip');
    const progress = [];
    let downloads = 0;
    const fetchRelease = async () => {
      downloads++;
      return new Response(bytes);
    };
    await downloadMacArchive(fetchRelease, asset, destination, p =>
      progress.push(p)
    );
    assert.equal(progress.at(-1).percent, 100);
    assert.equal(progress.at(-1).transferred, bytes.length);
    await downloadMacArchive(fetchRelease, asset, destination);
    assert.equal(downloads, 1);
    assert.deepEqual(await fs.readFile(destination), bytes);
    await assert.rejects(
      downloadMacArchive(
        async () => new Response('bad archive!'),
        asset,
        path.join(dir, 'bad.zip')
      ),
      /大小|SHA-256/
    );
    assert.deepEqual((await fs.readdir(dir)).sort(), ['update.zip']);
  }));
function verifier({
  oldTeam = 'TEAM1',
  newTeam = 'TEAM1',
  bundleId = 'com.electron.yesplaymusic',
  version = '1.0.1',
  invalidSignature = false,
} = {}) {
  return async (command, args) => {
    if (command.endsWith('lipo')) {
      assert.ok(
        args[0].endsWith(path.join('Contents', 'MacOS', 'YesPlayMusic'))
      );
      assert.equal(args[1], '-verify_arch');
      assert.ok(['arm64', 'x86_64'].includes(args[2]));
    }
    if (command.endsWith('PlistBuddy')) {
      const key = args[1];
      return {
        stdout: key.includes('ShortVersion')
          ? version
          : key.includes('Executable')
            ? 'YesPlayMusic'
            : args[2] === path.join('/old.app', 'Contents/Info.plist')
              ? 'com.electron.yesplaymusic'
              : bundleId,
      };
    }
    if (
      command.endsWith('codesign') &&
      args[0] === '--verify' &&
      invalidSignature
    )
      throw new Error('invalid signature');
    if (command.endsWith('codesign') && args[0] === '-dv') {
      const team = args.at(-1) === '/old.app' ? oldTeam : newTeam;
      return {
        stderr: team
          ? `TeamIdentifier=${team}\nCDHash=abc\n`
          : 'TeamIdentifier=not set\nSignature=adhoc\nCDHash=def\n',
      };
    }
    return { stdout: '', stderr: '' };
  };
}
test('bundle verification rejects changed identity, version, team and invalid signatures', async () => {
  for (const options of [
    { bundleId: 'evil.app' },
    { version: '9.9.9' },
    { newTeam: 'TEAM2' },
    { invalidSignature: true },
    { newTeam: null },
  ]) {
    await assert.rejects(
      verifyMacBundle('/new.app', {
        currentApp: '/old.app',
        arch: 'arm64',
        version: '1.0.1',
        execute: verifier(options),
      })
    );
  }
  await verifyMacBundle('/new.app', {
    currentApp: '/old.app',
    arch: 'arm64',
    version: '1.0.1',
    execute: verifier(),
  });
  await verifyMacBundle('/new.app', {
    currentApp: '/old.app',
    arch: 'x64',
    version: '1.0.1',
    execute: verifier({ oldTeam: null, newTeam: null }),
  });
});
test('valid install stages before quitting; helper receives separate path arguments', async () =>
  withDir(async dir => {
    const zip = path.join(dir, 'update.zip');
    await fs.writeFile(zip, 'archive');
    let quits = 0;
    let launched;
    const updater = new MacAppUpdater({
      app: {
        quit() {
          quits++;
        },
      },
      currentApp: '/Applications/My Music.app',
      cacheDir: dir,
      arch: 'arm64',
      checkWritable: async p => p,
      stageBundle: async () => path.join(dir, 'staged.app'),
      launchHelper(command, args) {
        launched = { command, args };
        const child = new EventEmitter();
        child.unref = () => {};
        setImmediate(() => child.emit('spawn'));
        return child;
      },
    });
    updater.info = {
      version: '1.0.1',
      files: [
        {
          size: 7,
          sha2: crypto.createHash('sha256').update('archive').digest('hex'),
        },
      ],
    };
    updater.archive = zip;
    await updater.quitAndInstall();
    assert.equal(quits, 1);
    assert.equal(launched.command, '/bin/sh');
    assert.equal(launched.args[2], '/Applications/My Music.app');
    assert.equal(launched.args.at(-1), '/usr/bin/open');
    await fs.writeFile(zip, 'tampered');
    await assert.rejects(updater.quitAndInstall(), /校验失败/);
    assert.equal(quits, 1);
  }));
test('permission and staging failures never quit the application', async () => {
  let quits = 0;
  const updater = new MacAppUpdater({
    app: {
      quit() {
        quits++;
      },
    },
    currentApp: '/old.app',
    checkWritable: async () => {
      throw new Error('read-only');
    },
  });
  await assert.rejects(updater.quitAndInstall(), /read-only/);
  assert.equal(quits, 0);
});
test('mac app location must be an absolute bundle path', async () => {
  await assert.rejects(assertMacAppWritable('relative.app'), /位置/);
  await assert.rejects(assertMacAppWritable('/tmp/foo'), /位置/);
});
test(
  'replacement helper preserves backup and rolls back if launch fails',
  { skip: process.platform === 'win32' },
  async () =>
    withDir(async dir => {
      const script = path.join(dir, 'install.sh');
      await fs.writeFile(script, MAC_INSTALL_SCRIPT);
      async function exercise(fail) {
        const root = path.join(dir, fail ? 'rollback case' : 'success case');
        await fs.mkdir(root);
        const target = path.join(root, 'Music.app');
        const staged = path.join(root, 'New.app');
        const backup = path.join(root, 'Old.app');
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, 'version'), 'old');
        await fs.mkdir(staged);
        await fs.writeFile(path.join(staged, 'version'), 'new');
        const open = path.join(root, 'open.sh');
        await fs.writeFile(
          open,
          '#!/bin/sh\nexit ' + (fail ? '1' : '0') + '\n',
          { mode: 0o700 }
        );
        const code = await new Promise((resolve, reject) => {
          const child = spawn('/bin/sh', [
            script,
            '2147483647',
            target,
            staged,
            backup,
            path.join(root, 'log'),
            open,
          ]);
          child.on('error', reject);
          child.on('exit', resolve);
        });
        assert.equal(code, fail ? 1 : 0);
        assert.equal(
          await fs.readFile(path.join(target, 'version'), 'utf8'),
          fail ? 'old' : 'new'
        );
        if (!fail)
          assert.equal(
            await fs.readFile(path.join(backup, 'version'), 'utf8'),
            'old'
          );
      }
      await exercise(false);
      await exercise(true);
    })
);
