const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function verifyWindowsArtifacts(output, version) {
  for (const [arch, folder, machine] of [
    ['x64', 'win-unpacked', 0x8664],
    ['arm64', 'win-arm64-unpacked', 0xaa64],
  ]) {
    const executable = path.join(output, folder, 'YesPlayMusic.exe');
    const pe = await fs.readFile(executable);
    assert.ok(pe.length >= 64 && pe.readUInt16LE(0) === 0x5a4d, `Invalid EXE: ${executable}`);
    const offset = pe.readUInt32LE(0x3c);
    assert.ok(offset + 6 <= pe.length && pe.readUInt32LE(offset) === 0x4550, `Invalid PE: ${executable}`);
    assert.equal(pe.readUInt16LE(offset + 4), machine, `Wrong ${arch} Electron payload`);
    for (const name of [`YesPlayMusic.Setup.${version}-${arch}.exe`, `YesPlayMusic.${version}-${arch}.exe`])
      assert.ok((await fs.stat(path.join(output, name))).size > 0, `Missing Windows artifact: ${name}`);
  }
  assert.deepEqual(
    await fs.readFile(path.join(output, `YesPlayMusic.Setup.${version}.exe`)),
    await fs.readFile(path.join(output, `YesPlayMusic.Setup.${version}-x64.exe`)),
    'Legacy x64 updater asset differs from x64 installer'
  );
}

if (require.main === module) {
  verifyWindowsArtifacts(process.argv[2] || 'dist_electron', require('../package.json').version)
    .then(() => console.log('PASS: Windows x64/ARM64 payload architectures, installer/portable assets and legacy x64 alias'))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyWindowsArtifacts };
