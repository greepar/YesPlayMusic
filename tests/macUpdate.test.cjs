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
} = require('../src/electron/macUpdate');
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
    let downloads = 0;
    const fetchRelease = async () => {
      downloads++;
      return new Response(bytes);
    };
    await downloadMacArchive(fetchRelease, asset, destination);
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
