// macOS CI: exercise Apple's actual ZIP, Mach-O and code-signing tools.
const electronApp = process.versions.electron ? require('electron').app : null;
const fs = (electronApp ? require('original-fs') : require('node:fs')).promises;
const { createPackage } = require('@electron/asar');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { MAC_INSTALL_SCRIPT } = require('../src/electron/macInstallScript');
const {
  stageMacBundle,
  verifyMacBundle,
  cleanupMacUpdates,
} = require('../src/electron/macUpdate');
(async () => {
  if (electronApp) await electronApp.whenReady();
  assert.equal(process.platform, 'darwin');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ypm-native-mac-'));
  try {
    await fs.writeFile(
      path.join(dir, 'main.c'),
      'int main(void) { return 0; }\n'
    );
    const old = path.join(dir, 'old', 'YesPlayMusic.app');
    const next = path.join(dir, 'next', 'YesPlayMusic.app');
    const payload = path.join(dir, 'payload');
    await fs.mkdir(payload);
    await fs.writeFile(
      path.join(payload, 'index.js'),
      'module.exports = {};\n'
    );
    for (const [app, version] of [
      [old, '1.0.0'],
      [next, '1.0.1'],
    ]) {
      await fs.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
      await fs.mkdir(path.join(app, 'Contents/Resources'));
      await createPackage(
        payload,
        path.join(app, 'Contents/Resources/app.asar')
      );
      await fs.writeFile(
        path.join(app, 'Contents/Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.electron.yesplaymusic</string><key>CFBundleExecutable</key><string>YesPlayMusic</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
      );
      await run('/usr/bin/cc', [
        path.join(dir, 'main.c'),
        '-o',
        path.join(app, 'Contents/MacOS/YesPlayMusic'),
      ]);
      await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    }
    const archive = path.join(dir, 'update.zip');
    await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', next, archive]);
    const options = {
      currentApp: old,
      cacheDir: dir,
      version: '1.0.1',
      arch: process.arch,
    };
    const staged = await stageMacBundle(archive, options);
    await verifyMacBundle(staged, options);
    assert.equal(
      (await fs.readdir(dir)).some(name => name.startsWith('extract-')),
      false
    );
    assert.ok((await fs.stat(old)).isDirectory());
    await fs.appendFile(
      path.join(next, 'Contents/MacOS/YesPlayMusic'),
      'tampered'
    );
    await assert.rejects(verifyMacBundle(next, options));
    console.log(
      'PASS: native ditto ZIP extraction, ad-hoc codesign verification, Mach-O architecture and staging'
    );
    console.log(
      'PASS: modified signed executable rejected; original app retained'
    );
    // Exercise two replacements after the initial ad-hoc signature. The launch
    // probe executes the real Mach-O fixture; Gatekeeper/LaunchServices UI is
    // deliberately outside this isolated native test.
    const helper = path.join(dir, 'install.sh');
    const launchProbe = path.join(dir, 'launch.sh');
    await fs.writeFile(helper, MAC_INSTALL_SCRIPT);
    await fs.writeFile(
      launchProbe,
      '#!/bin/sh\nexec "$1/Contents/MacOS/YesPlayMusic"\n',
      { mode: 0o700 }
    );
    await fs.copyFile(
      path.join(old, 'Contents/MacOS/YesPlayMusic'),
      path.join(next, 'Contents/MacOS/YesPlayMusic')
    );
    for (const version of ['1.0.1', '1.0.2']) {
      await run('/usr/libexec/PlistBuddy', [
        '-c',
        `Set :CFBundleShortVersionString ${version}`,
        path.join(next, 'Contents/Info.plist'),
      ]);
      await run('/usr/bin/codesign', [
        '--force',
        '--deep',
        '--sign',
        '-',
        next,
      ]);
      await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', next, archive]);
      const replacement = await stageMacBundle(archive, {
        ...options,
        version,
      });
      const backup = path.join(path.dirname(replacement), 'Previous.app');
      const previous = await fs.readFile(path.join(old, 'Contents/Info.plist'));
      await run('/bin/sh', [
        helper,
        '2147483647',
        old,
        replacement,
        backup,
        path.join(dir, 'install.log'),
        launchProbe,
      ]);
      await verifyMacBundle(old, { ...options, version });
      assert.deepEqual(
        await fs.readFile(path.join(backup, 'Contents/Info.plist')),
        previous
      );
      const scriptName = 'install-00000000-0000-4000-8000-000000000000.sh';
      const cachedArchive = path.join(
        dir,
        `YesPlayMusic-${version}-${process.arch}.zip`
      );
      await fs.copyFile(archive, cachedArchive);
      await fs.writeFile(path.join(dir, scriptName), 'fixture');
      await fs.writeFile(
        path.join(path.dirname(backup), 'pending-update.json'),
        JSON.stringify({
          format: 1,
          target: await fs.realpath(old),
          version,
          arch: process.arch,
          script: scriptName,
        })
      );
      await cleanupMacUpdates({ currentApp: old, cacheDir: dir, version });
      await assert.rejects(fs.stat(backup), { code: 'ENOENT' });
      await assert.rejects(fs.stat(cachedArchive), { code: 'ENOENT' });
      await verifyMacBundle(old, { ...options, version });
    }
    console.log(
      'PASS: consecutive ad-hoc updates, native replacement, launch, backup and startup cleanup (including app.asar)'
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (electronApp) electronApp.exit(process.exitCode || 0);
  });
