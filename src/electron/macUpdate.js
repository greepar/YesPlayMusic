const fs = require('node:fs/promises');
const { createReadStream, createWriteStream, constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
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

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadMacArchive(fetchRelease, asset, destination) {
  try {
    if (
      (await fs.stat(destination)).size === asset.size &&
      (await hashFile(destination)) === asset.sha2
    )
      return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.${crypto.randomUUID()}.download`;
  try {
    const response = await fetchRelease(asset.url, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body)
      throw new Error(`更新下载失败（HTTP ${response.status}）`);
    let received = 0;
    const hash = crypto.createHash('sha256');
    const verify = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > asset.size)
          return callback(new Error('更新文件大小超出 Release 附件记录。'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      verify,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    );
    if (received !== asset.size || hash.digest('hex') !== asset.sha2)
      throw new Error('更新安装包 SHA-256 或大小校验失败。');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
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
    '-verify_arch',
    architecture,
    path.join(candidate, 'Contents/MacOS', executable),
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
    await downloadMacArchive(this.fetchRelease, asset, this.archive);
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
    installDetail:
      '重启将替换 YesPlayMusic 应用并中断播放。旧版会保留备份；选择“稍后”可继续使用。',
  });
}
module.exports = {
  assertMacAppWritable,
  downloadMacArchive,
  verifyMacBundle,
  stageMacBundle,
  MacAppUpdater,
  createMacAppUpdater,
};
