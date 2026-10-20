// macOS CI: exercise Apple's actual ZIP, Mach-O and code-signing tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const {
  stageMacBundle,
  verifyMacBundle,
} = require('../src/electron/macUpdate');
(async () => {
  assert.equal(process.platform, 'darwin');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ypm-native-mac-'));
  try {
    await fs.writeFile(
      path.join(dir, 'main.c'),
      'int main(void) { return 0; }\n'
    );
    const old = path.join(dir, 'old', 'YesPlayMusic.app');
    const next = path.join(dir, 'next', 'YesPlayMusic.app');
    for (const [app, version] of [
      [old, '1.0.0'],
      [next, '1.0.1'],
    ]) {
      await fs.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
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
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
