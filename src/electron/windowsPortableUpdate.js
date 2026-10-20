const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const {
  latestRelease,
  isNewerVersion,
  windowsPortableUpdateInfo,
} = require('./githubRelease');
const { downloadVerifiedFile, hashFile } = require('./verifiedDownload');
const { createDownloadedUpdateController } = require('./downloadedUpdate');
const {
  WINDOWS_PORTABLE_INSTALL_SCRIPT,
} = require('./windowsPortableInstallScript');

async function assertPortableWindowsWritable(executable) {
  if (
    !executable ||
    !path.isAbsolute(executable) ||
    path.extname(executable).toLowerCase() !== '.exe'
  )
    throw new Error('无法定位单文件版 EXE，请从原始便携版程序重新启动。');
  const real = await fs.realpath(executable);
  try {
    if (!(await fs.stat(real)).isFile()) throw new Error('Not a file');
    await fs.access(real, constants.R_OK | constants.W_OK);
    await fs.access(path.dirname(real), constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      '无法写入单文件版 EXE 或所在目录。请移到当前用户可写的目录（例如桌面或下载目录）后重试。'
    );
  }
  return real;
}

class WindowsPortableUpdater extends EventEmitter {
  constructor({
    app,
    fetchRelease,
    cacheDir,
    executable = process.env.PORTABLE_EXECUTABLE_FILE,
    arch = process.arch,
    checkWritable = assertPortableWindowsWritable,
    launchHelper = spawn,
  }) {
    super();
    Object.assign(this, {
      app,
      fetchRelease,
      cacheDir,
      executable,
      arch,
      checkWritable,
      launchHelper,
    });
  }
  async checkForUpdates() {
    const release = await latestRelease(this.fetchRelease);
    if (!isNewerVersion(release.version, this.app.getVersion())) return null;
    this.info = windowsPortableUpdateInfo(release, this.arch);
    this.emit('update-available', this.info);
    return this.info;
  }
  async downloadUpdate() {
    await this.checkWritable(this.executable);
    await fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    this.archive = path.join(
      this.cacheDir,
      `YesPlayMusic-${this.info.version}-${this.arch}-portable.exe`
    );
    await downloadVerifiedFile(
      this.fetchRelease,
      this.info.files[0],
      this.archive,
      progress => this.emit('download-progress', progress)
    );
    this.emit('update-downloaded', this.info);
    return [this.archive];
  }
  async quitAndInstall() {
    const target = await this.checkWritable(this.executable);
    const asset = this.info.files[0];
    if (
      (await fs.stat(this.archive)).size !== asset.size ||
      (await hashFile(this.archive)) !== asset.sha2
    )
      throw new Error('缓存单文件版更新校验失败，已取消更新。');
    const stage = await fs.mkdtemp(
      path.join(path.dirname(target), '.yesplaymusic-update-')
    );
    const staged = path.join(stage, 'Next.exe');
    const backup = path.join(stage, 'Previous.exe');
    const script = path.join(
      this.cacheDir,
      `install-${crypto.randomUUID()}.ps1`
    );
    try {
      await fs.copyFile(this.archive, staged, constants.COPYFILE_EXCL);
      await fs.writeFile(
        path.join(stage, 'pending-update.json'),
        JSON.stringify({
          format: 1,
          kind: 'windows-portable',
          target,
          version: this.info.version,
          arch: this.arch,
          script: path.basename(script),
        }),
        { mode: 0o600, flag: 'wx' }
      );
      // Windows PowerShell 5.1 needs a BOM to decode Chinese error messages.
      await fs.writeFile(script, '\uFEFF' + WINDOWS_PORTABLE_INSTALL_SCRIPT, {
        mode: 0o700,
        flag: 'wx',
      });
      await new Promise((resolve, reject) => {
        const powershell = path.win32.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        );
        const child = this.launchHelper(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            '-ParentPid',
            String(process.pid),
            '-Target',
            target,
            '-Staged',
            staged,
            '-Backup',
            backup,
            '-Digest',
            asset.sha2,
            '-Log',
            path.join(this.cacheDir, 'last-install.log'),
          ],
          { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true });
      await fs.rm(script, { force: true });
      throw error;
    }
    this.app.quit();
  }
}

async function cleanupWindowsPortableUpdates({
  executable = process.env.PORTABLE_EXECUTABLE_FILE,
  cacheDir,
  version,
  log = () => {},
}) {
  if (!executable) return;
  const target = await fs.realpath(executable);
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
        receipt.kind !== 'windows-portable' ||
        receipt.target !== target ||
        receipt.version !== version ||
        !/^\d+\.\d+\.\d+$/.test(version) ||
        !['x64', 'arm64'].includes(receipt.arch) ||
        !/^install-[a-f0-9-]{36}\.ps1$/.test(receipt.script)
      )
        continue;
      if (!(await fs.lstat(path.join(stage, 'launch-succeeded'))).isFile())
        continue;
      const backup = await fs.lstat(path.join(stage, 'Previous.exe'));
      if (!backup.isFile() || backup.isSymbolicLink()) continue;
      await fs.rm(
        path.join(
          cacheDir,
          `YesPlayMusic-${version}-${receipt.arch}-portable.exe`
        ),
        { force: true }
      );
      await fs.rm(path.join(cacheDir, receipt.script), { force: true });
      await fs.rm(stage, { recursive: true });
      log(`Removed previous Windows portable EXE and cache for ${version}`);
    } catch (error) {
      if (error.code !== 'ENOENT')
        log(`Windows portable cleanup deferred: ${error.message}`);
    }
  }
}

function createWindowsPortableUpdater(options) {
  return createDownloadedUpdateController({
    updater: new WindowsPortableUpdater(options),
    dialog: options.dialog,
    log: options.log,
    platformName: 'Windows 单文件版',
    confirmBeforeDownload: true,
    canNotify: options.canNotify,
    onProgress: options.onProgress,
  });
}

module.exports = {
  assertPortableWindowsWritable,
  WindowsPortableUpdater,
  createWindowsPortableUpdater,
  cleanupWindowsPortableUpdates,
};
