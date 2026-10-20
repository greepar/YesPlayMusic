// Bundle operations must treat app.asar as a physical file. Electron's patched
// fs traverses it as a virtual directory and recursive removal fails ENOTEMPTY.
const nativeFs = process.versions.electron
  ? require('original-fs')
  : require('node:fs');
const fs = nativeFs.promises;
const { constants } = nativeFs;
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const {
  latestRelease,
  isNewerVersion,
  macUpdateInfo,
} = require('./githubRelease');
const { createDownloadedUpdateController } = require('./downloadedUpdate');
const { MAC_INSTALL_SCRIPT } = require('./macInstallScript');
const {
  hashFile,
  downloadVerifiedFile: downloadMacArchive,
} = require('./verifiedDownload');

async function assertMacAppWritable(currentApp) {
  if (!path.isAbsolute(currentApp) || !currentApp.endsWith('.app')) {
    throw new Error('无法确定当前 macOS 应用位置。');
  }
  const real = await fs.realpath(currentApp);
  if (real.startsWith('/Volumes/') || real.includes('/AppTranslocation/')) {
    throw new Error(
      '请先将 YesPlayMusic 拖入“应用程序”或 ~/Applications，再打开以自动更新。'
    );
  }
  await fs.access(real, constants.R_OK | constants.W_OK | constants.X_OK);
  await fs.access(path.dirname(real), constants.W_OK | constants.X_OK);
  return real;
}

async function readPlist(appPath, key, execute = run) {
  const { stdout } = await execute('/usr/libexec/PlistBuddy', [
    '-c',
    `Print :${key}`,
    path.join(appPath, 'Contents/Info.plist'),
  ]);
  return stdout.trim();
}

async function verifyMacBundle(
  candidate,
  { currentApp, version, arch, execute = run }
) {
  // Validate the downloaded bundle and preserve the existing application's
  // bundle ID and signing identity. Never strip quarantine or re-sign it.
  await execute('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    candidate,
  ]);
  const currentId = await readPlist(currentApp, 'CFBundleIdentifier', execute);
  const candidateId = await readPlist(candidate, 'CFBundleIdentifier', execute);
  const candidateVersion = await readPlist(
    candidate,
    'CFBundleShortVersionString',
    execute
  );
  if (!currentId || currentId !== candidateId || candidateVersion !== version)
    throw new Error('下载应用的标识或版本与当前应用/Release 不匹配。');
  const executable = await readPlist(candidate, 'CFBundleExecutable', execute);
  if (!executable || path.basename(executable) !== executable)
    throw new Error('更新应用的可执行文件名称无效。');
  const architecture = arch === 'x64' ? 'x86_64' : arch;
  await execute('/usr/bin/lipo', [
    path.join(candidate, 'Contents/MacOS', executable),
    '-verify_arch',
    architecture,
  ]);
  const identity = async appPath => {
    const { stderr } = await execute('/usr/bin/codesign', [
      '-dv',
      '--verbose=4',
      appPath,
    ]);
    return {
      team: stderr.match(/^TeamIdentifier=(.+)$/m)?.[1],
      adhoc: /^Signature=adhoc$/m.test(stderr),
      cdhash: stderr.match(/^CDHash=(.+)$/m)?.[1],
    };
  };
  const old = await identity(currentApp);
  const next = await identity(candidate);
  if (old.team && old.team !== 'not set') {
    if (next.team !== old.team || next.adhoc)
      throw new Error('更新应用的签名团队发生变化，已拒绝替换。');
  } else if (!old.adhoc || !next.cdhash) {
    throw new Error('无法验证当前应用及更新应用的代码签名。');
  }
}

async function stageMacBundle(archive, options) {
  const { currentApp, cacheDir, execute = run } = options;
  const extraction = await fs.mkdtemp(path.join(cacheDir, 'extract-'));
  let stage;
  try {
    const listing = await execute('/usr/bin/unzip', ['-Z1', archive], {
      maxBuffer: 16 * 1024 * 1024,
    });
    if (
      listing.stdout
        .split('\n')
        .filter(Boolean)
        .some(name => name.startsWith('/') || name.split('/').includes('..'))
    )
      throw new Error('更新 ZIP 含有不安全的文件路径。');
    await execute('/usr/bin/ditto', ['-x', '-k', archive, extraction]);
    const candidate = path.join(extraction, 'YesPlayMusic.app');
    const stat = await fs.lstat(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('ZIP 中没有有效的 YesPlayMusic.app。');
    await verifyMacBundle(candidate, options);
    stage = await fs.mkdtemp(
      path.join(path.dirname(currentApp), '.yesplaymusic-update-')
    );
    const staged = path.join(stage, 'YesPlayMusic.app');
    await execute('/usr/bin/ditto', [candidate, staged]);
    await verifyMacBundle(staged, options);
    return staged;
  } catch (error) {
    if (stage) await fs.rm(stage, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(extraction, { recursive: true, force: true });
  }
}

async function cleanupMacUpdates({
  currentApp,
  cacheDir,
  version,
  log = () => {},
}) {
  const target = await fs.realpath(currentApp);
  const parent = path.dirname(target);
  for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.yesplaymusic-update-'))
      continue;
    const stage = path.join(parent, entry.name);
    try {
      const receipt = JSON.parse(
        await fs.readFile(path.join(stage, 'pending-update.json'), 'utf8')
      );
      if (
        receipt.format !== 1 ||
        receipt.target !== target ||
        receipt.version !== version ||
        !/^\d+\.\d+\.\d+$/.test(version) ||
        !['arm64', 'x64'].includes(receipt.arch) ||
        !/^install-[a-f0-9-]{36}\.sh$/.test(receipt.script)
      )
        continue;
      const launched = await fs.lstat(path.join(stage, 'launch-succeeded'));
      const backup = await fs.lstat(path.join(stage, 'Previous.app'));
      if (
        !launched.isFile() ||
        !backup.isDirectory() ||
        backup.isSymbolicLink()
      )
        continue;
      // Only this completed transaction is removed; never sweep other apps or
      // newer downloads in the shared updater cache.
      await fs.rm(
        path.join(cacheDir, `YesPlayMusic-${version}-${receipt.arch}.zip`),
        { force: true }
      );
      await fs.rm(path.join(cacheDir, receipt.script), { force: true });
      await fs.rm(stage, { recursive: true });
      log(`Removed previous macOS app and update cache for ${version}`);
    } catch (error) {
      if (error.code !== 'ENOENT')
        log(`macOS update cleanup deferred: ${error.message}`);
    }
  }
}

class MacAppUpdater extends EventEmitter {
  constructor({
    app,
    fetchRelease,
    currentApp,
    cacheDir,
    arch = process.arch,
    checkWritable = assertMacAppWritable,
    stageBundle = stageMacBundle,
    launchHelper = spawn,
  }) {
    super();
    Object.assign(this, {
      app,
      fetchRelease,
      currentApp,
      cacheDir,
      arch,
      checkWritable,
      stageBundle,
      launchHelper,
    });
  }
  async checkForUpdates() {
    const release = await latestRelease(this.fetchRelease);
    if (!isNewerVersion(release.version, this.app.getVersion())) return null;
    this.info = macUpdateInfo(release, this.arch);
    this.emit('update-available', this.info);
    return this.info;
  }
  async downloadUpdate() {
    await this.checkWritable(this.currentApp);
    await fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    const asset = this.info.files[0];
    this.archive = path.join(
      this.cacheDir,
      `YesPlayMusic-${this.info.version}-${this.arch}.zip`
    );
    await downloadMacArchive(this.fetchRelease, asset, this.archive, progress =>
      this.emit('download-progress', progress)
    );
    this.emit('update-downloaded', this.info);
    return [this.archive];
  }
  async quitAndInstall() {
    const currentApp = await this.checkWritable(this.currentApp);
    const asset = this.info.files[0];
    if (
      (await fs.stat(this.archive)).size !== asset.size ||
      (await hashFile(this.archive)) !== asset.sha2
    )
      throw new Error('缓存安装包校验失败，已取消更新。');
    const staged = await this.stageBundle(this.archive, {
      currentApp,
      cacheDir: this.cacheDir,
      version: this.info.version,
      arch: this.arch,
    });
    const backup = path.join(path.dirname(staged), 'Previous.app');
    const script = path.join(
      this.cacheDir,
      `install-${crypto.randomUUID()}.sh`
    );
    const log = path.join(this.cacheDir, 'last-install.log');
    await fs.writeFile(
      path.join(path.dirname(staged), 'pending-update.json'),
      JSON.stringify({
        format: 1,
        target: currentApp,
        version: this.info.version,
        arch: this.arch,
        script: path.basename(script),
      }),
      { mode: 0o600, flag: 'wx' }
    );
    await fs.writeFile(script, MAC_INSTALL_SCRIPT, { mode: 0o700, flag: 'wx' });
    await new Promise((resolve, reject) => {
      const child = this.launchHelper(
        '/bin/sh',
        [
          script,
          String(process.pid),
          currentApp,
          staged,
          backup,
          log,
          '/usr/bin/open',
        ],
        { detached: true, stdio: 'ignore' }
      );
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    // The helper waits for process exit before moving either app bundle.
    this.app.quit();
  }
}

function createMacAppUpdater(options) {
  const updater = new MacAppUpdater(options);
  return createDownloadedUpdateController({
    updater,
    dialog: options.dialog,
    log: options.log,
    platformName: 'macOS',
    confirmBeforeDownload: true,
    canNotify: options.canNotify,
    onProgress: options.onProgress,
  });
}
module.exports = {
  assertMacAppWritable,
  downloadMacArchive,
  verifyMacBundle,
  stageMacBundle,
  cleanupMacUpdates,
  MacAppUpdater,
  createMacAppUpdater,
};
