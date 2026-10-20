const { createDownloadedUpdateController } = require('./downloadedUpdate');

function isPortableWindows(env = process.env) {
  return Boolean(env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR);
}

function createWindowsInstallerUpdater({
  updater,
  env = process.env,
  ...options
}) {
  updater.disableDifferentialDownload = true;
  updater.disableWebInstaller = true;
  return createDownloadedUpdateController({
    ...options,
    updater,
    enabled: !isPortableWindows(env),
    platformName: 'Windows',
    installDetail:
      '重启将安装更新，并中断当前播放。Windows 可能请求管理员权限，请确认后继续。选择“稍后”不会安装或中断播放。',
  });
}

module.exports = { isPortableWindows, createWindowsInstallerUpdater };
