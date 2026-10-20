const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { windowsPortableUpdateInfo } = require('../src/electron/githubRelease');
const {
  WindowsPortableUpdater,
  createWindowsPortableUpdater,
  assertPortableWindowsWritable,
  cleanupWindowsPortableUpdates,
} = require('../src/electron/windowsPortableUpdate');
const {
  WINDOWS_PORTABLE_INSTALL_SCRIPT,
} = require('../src/electron/windowsPortableInstallScript');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function withDir(action) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ypm-portable-test-'));
  try {
    await action(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
function release(bytes) {
  return {
    tag_name: 'v1.0.1',
    assets: [
      'YesPlayMusic.Setup.1.0.1-arm64.exe',
      'YesPlayMusic.1.0.1-x64.exe',
      'YesPlayMusic.1.0.1-arm64.exe',
      'YesPlayMusic.Setup.1.0.1-x64.exe',
    ].map(name => ({
      name,
      state: 'uploaded',
      size: bytes.length,
      digest: `sha256:${digest(bytes)}`,
      browser_download_url: `https://github.com/greepar/YesPlayMusic/releases/download/v1.0.1/${name}`,
    })),
  };
}
async function fixture(dir, arch = 'arm64') {
  const target = path.join(dir, "Music & '测试' [portable].exe");
  const cacheDir = path.join(dir, 'cache');
  const old = Buffer.from('old portable version');
  const next = Buffer.from('new verified portable version');
  await fs.writeFile(target, old);
  let quit;
  const done = new Promise(resolve => {
    quit = resolve;
  });
  const calls = { quits: 0, downloads: 0, launches: [] };
  const options = {
    executable: target,
    cacheDir,
    arch,
    app: {
      getVersion: () => '1.0.0',
      quit() {
        calls.quits++;
        quit();
      },
    },
    async fetchRelease(url) {
      if (url.endsWith('/latest'))
        return new Response(JSON.stringify(release(next)));
      calls.downloads++;
      return new Response(next);
    },
    launchHelper(command, args, opts) {
      calls.launches.push({ command, args, opts });
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  };
  return { options, calls, target, cacheDir, old, next, done };
}

test('single-file selection isolates architecture and never chooses the Setup installer', () => {
  const r = release(Buffer.from('payload'));
  for (const arch of ['x64', 'arm64']) {
    const info = windowsPortableUpdateInfo(r, arch);
    assert.ok(info.files[0].url.endsWith(`YesPlayMusic.1.0.1-${arch}.exe`));
    assert.equal(info.files[0].isAdminRightsRequired, undefined);
  }
  r.assets = r.assets.filter(
    a => !a.name.endsWith('YesPlayMusic.1.0.1-arm64.exe')
  );
  assert.throws(() => windowsPortableUpdateInfo(r, 'arm64'), /尚未提供/);
  assert.throws(() => windowsPortableUpdateInfo(r, 'ia32'), /不支持/);
  const legacy = {
    ...r.assets[0],
    name: 'YesPlayMusic.1.0.1.exe',
    browser_download_url:
      'https://github.com/greepar/YesPlayMusic/releases/download/v1.0.1/YesPlayMusic.1.0.1.exe',
  };
  assert.ok(
    windowsPortableUpdateInfo({ tag_name: 'v1.0.1', assets: [legacy] }, 'x64')
  );
  assert.throws(
    () =>
      windowsPortableUpdateInfo(
        { tag_name: 'v1.0.1', assets: [legacy] },
        'arm64'
      ),
    /尚未提供/
  );
});

for (const arch of ['x64', 'arm64']) {
  test(`${arch} portable downloads with progress and replaces the original outer EXE path`, async () =>
    withDir(async dir => {
      const f = await fixture(dir, arch);
      const updater = new WindowsPortableUpdater(f.options);
      const progress = [];
      updater.on('download-progress', p => progress.push(p));
      await updater.checkForUpdates();
      await updater.downloadUpdate();
      assert.equal(progress.at(-1).percent, 100);
      await updater.quitAndInstall();
      assert.equal(f.calls.quits, 1);
      assert.deepEqual(await fs.readFile(f.target), f.old);
      const launch = f.calls.launches[0];
      assert.ok(launch.command.endsWith('powershell.exe'));
      assert.equal(
        launch.args[launch.args.indexOf('-Target') + 1],
        await fs.realpath(f.target)
      );
      assert.equal(launch.opts.windowsHide, true);
      const staged = launch.args[launch.args.indexOf('-Staged') + 1];
      assert.deepEqual(await fs.readFile(staged), f.next);
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(path.dirname(staged), 'pending-update.json')
        )
      );
      assert.equal(receipt.arch, arch);
      assert.equal(receipt.kind, 'windows-portable');
      await fs.writeFile(updater.archive, 'tampered');
      await assert.rejects(updater.quitAndInstall(), /校验失败/);
      assert.equal(f.calls.quits, 1);
    }));
}

test('portable consent gates all download traffic and installs only after approval', async () =>
  withDir(async dir => {
    const f = await fixture(dir);
    let response = 1;
    const states = [];
    const controller = createWindowsPortableUpdater({
      ...f.options,
      onProgress: state => states.push(state),
      log() {},
      dialog: {
        async showMessageBox() {
          return { response };
        },
      },
    });
    await controller.check();
    await tick();
    assert.equal(f.calls.downloads, 0);
    assert.equal(f.calls.quits, 0);
    response = 0;
    await controller.check();
    let timeout;
    try {
      await Promise.race([
        f.done,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Error('Install timed out')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(f.calls.downloads, 1);
    assert.equal(f.calls.quits, 1);
    assert.ok(states.some(s => s.phase === 'downloading' && s.percent === 100));
    assert.ok(states.some(s => s.phase === 'installing'));
  }));

test('portable write permission and helper launch failures keep the running app intact', async () =>
  withDir(async dir => {
    const f = await fixture(dir);
    const updater = new WindowsPortableUpdater({
      ...f.options,
      checkWritable: async () => {
        throw Error('read-only');
      },
    });
    await updater.checkForUpdates();
    await assert.rejects(updater.downloadUpdate(), /read-only/);
    assert.equal(f.calls.downloads, 0);
    const failedHelper = new WindowsPortableUpdater({
      ...f.options,
      launchHelper() {
        const child = new EventEmitter();
        setImmediate(() => child.emit('error', Error('spawn failed')));
        return child;
      },
    });
    await failedHelper.checkForUpdates();
    await failedHelper.downloadUpdate();
    await assert.rejects(failedHelper.quitAndInstall(), /spawn failed/);
    assert.equal(f.calls.quits, 0);
    assert.deepEqual(await fs.readFile(f.target), f.old);
    assert.equal(
      (await fs.readdir(dir)).some(name =>
        name.startsWith('.yesplaymusic-update-')
      ),
      false
    );
    await assert.rejects(
      assertPortableWindowsWritable('relative.exe'),
      /无法定位/
    );
  }));

test('new portable startup cleans only its own confirmed update and preserves the live EXE', async () =>
  withDir(async dir => {
    const f = await fixture(dir);
    const updater = new WindowsPortableUpdater(f.options);
    await updater.checkForUpdates();
    await updater.downloadUpdate();
    await updater.quitAndInstall();
    const args = f.calls.launches[0].args;
    const staged = args[args.indexOf('-Staged') + 1];
    const backup = args[args.indexOf('-Backup') + 1];
    await fs.rename(f.target, backup);
    await fs.rename(staged, f.target);
    const options = {
      executable: f.target,
      cacheDir: f.cacheDir,
      version: '1.0.1',
    };
    await cleanupWindowsPortableUpdates(options);
    assert.ok(await fs.stat(backup)); // Launch not confirmed yet.
    await fs.writeFile(path.join(path.dirname(backup), 'launch-succeeded'), '');
    await cleanupWindowsPortableUpdates({ ...options, version: '1.0.0' });
    assert.ok(await fs.stat(backup)); // Wrong running version must not remove it.
    const other = path.join(dir, '.yesplaymusic-update-other-app');
    await fs.mkdir(other);
    await fs.writeFile(
      path.join(other, 'pending-update.json'),
      JSON.stringify({
        format: 1,
        kind: 'windows-portable',
        target: path.join(dir, 'Other.exe'),
        version: '1.0.1',
      })
    );
    await cleanupWindowsPortableUpdates(options);
    await assert.rejects(fs.stat(backup), { code: 'ENOENT' });
    await assert.rejects(fs.stat(updater.archive), { code: 'ENOENT' });
    assert.ok(await fs.stat(other));
    assert.deepEqual(await fs.readFile(f.target), f.next);
  }));

test(
  'native Windows helper replaces, verifies and rolls back portable EXEs with special-character paths',
  { skip: process.platform !== 'win32' && !process.env.YPM_POWERSHELL_PATH },
  async () =>
    withDir(async dir => {
      const modes = ['success', 'launch-failure', 'corrupt'];
      if (process.platform === 'win32') modes.push('locked');
      for (const mode of modes) {
        const root = path.join(dir, mode);
        await fs.mkdir(root);
        const target = path.join(root, "Music & '测试' [portable].exe");
        const staged = path.join(root, 'Next.exe');
        const backup = path.join(root, 'Previous.exe');
        const next = Buffer.from('verified update');
        await fs.writeFile(target, 'old');
        await fs.writeFile(staged, next);
        const script = path.join(root, 'install.ps1');
        const mocks = `
function Start-Process {
  param($FilePath, $WorkingDirectory, $ErrorAction)
  $script:launchCount++
  if ($env:YPM_TEST_FAIL_LAUNCH -eq '1' -and $script:launchCount -eq 1) { throw 'Simulated launch failure' }
}
function Show-UpdateFailure {}
`;
        let helper = WINDOWS_PORTABLE_INSTALL_SCRIPT.replace(
          '$oldMoved = $false',
          mocks + '\n$oldMoved = $false'
        );
        if (mode === 'locked') {
          // Hold a real Windows file handle without FILE_SHARE_DELETE. A CLR
          // timer releases it, independently of the PowerShell retry loop.
          const lock = `
Add-Type -TypeDefinition @'
public static class YpmPortableLock {
  static System.IO.FileStream file;
  static System.Threading.Timer timer;
  public static void Hold(string path) {
    file = System.IO.File.Open(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.Read);
    timer = new System.Threading.Timer(state => file.Dispose(), null, 1500, System.Threading.Timeout.Infinite);
  }
}
'@
[YpmPortableLock]::Hold($Target)
`;
          helper = helper.replace(
            '  Move-WithRetry $Target $Backup',
            lock + '\n  Move-WithRetry $Target $Backup'
          );
        }
        await fs.writeFile(script, '\uFEFF' + helper);
        const code = await new Promise((resolve, reject) => {
          const child = spawn(
            process.env.YPM_POWERSHELL_PATH || 'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              script,
              '-ParentPid',
              '2147483647',
              '-Target',
              target,
              '-Staged',
              staged,
              '-Backup',
              backup,
              '-Digest',
              mode === 'corrupt' ? '0'.repeat(64) : digest(next),
              '-Log',
              path.join(root, 'install.log'),
            ],
            {
              windowsHide: true,
              env: {
                ...process.env,
                YPM_TEST_FAIL_LAUNCH: mode === 'launch-failure' ? '1' : '0',
              },
            }
          );
          child.on('error', reject);
          child.on('exit', resolve);
        });
        const success = mode === 'success' || mode === 'locked';
        assert.equal(code, success ? 0 : 1);
        assert.deepEqual(
          await fs.readFile(target),
          success ? next : Buffer.from('old')
        );
        if (success) {
          assert.equal(await fs.readFile(backup, 'utf8'), 'old');
          assert.ok(await fs.stat(path.join(root, 'launch-succeeded')));
        }
        if (mode === 'locked')
          assert.match(
            await fs.readFile(path.join(root, 'install.log'), 'utf8'),
            /Waiting for portable launcher file lock/
          );
      }
    })
);
