const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

async function assertAppImageWritable(appImage) {
  if (!appImage || !path.isAbsolute(appImage)) {
    throw new Error('请使用 AppImage 安装包运行 YesPlayMusic。');
  }
  try {
    // AppImageUpdater removes the old file and moves the download into its
    // directory, so checking the file alone is insufficient.
    await fs.access(appImage, constants.R_OK | constants.W_OK);
    await fs.access(path.dirname(appImage), constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      '无法写入 AppImage 或所在目录。请将安装包放到当前用户可写的目录，' +
        '例如 ~/.local/share/yesplaymusic/YesPlayMusic.AppImage，再重新打开。'
    );
  }
}

function createLinuxAppImageUpdater({
  updater,
  dialog,
  appImage = process.env.APPIMAGE,
  log = console.log,
  checkWritable = assertAppImageWritable,
}) {
  // Download automatically after checking permissions, but never interrupt
  // playback by installing on quit or restarting without the user's choice.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  let checking = null;
  let downloading = false;
  let prompting = false;
  let downloadFailureShown = false;

  const reportDownloadFailure = async error => {
    log(`Linux update failed: ${error.message}`);
    if (downloadFailureShown) return;
    downloadFailureShown = true;
    await dialog.showMessageBox({
      type: 'error',
      title: '更新未完成',
      message: '无法下载或安装更新，当前版本仍可继续使用。',
      detail: error.message,
      buttons: ['知道了'],
      noLink: true,
    });
  };

  const onError = error => {
    log(`Linux updater: ${error.message}`);
    if (downloading || prompting) {
      reportDownloadFailure(error).catch(log);
    }
  };
  const onAvailable = info => {
    if (downloading || prompting) return;
    downloading = true;
    downloadFailureShown = false;
    (async () => {
      try {
        await checkWritable(appImage);
        log(`Downloading Linux update ${info.version}`);
        // electron-updater chooses the architecture-specific AppImage and
        // verifies SHA-256 from the GitHub Release asset digest.
        await updater.downloadUpdate();
      } catch (error) {
        await reportDownloadFailure(error);
      } finally {
        downloading = false;
      }
    })().catch(log);
  };
  const onDownloaded = info => {
    if (prompting) return;
    prompting = true;
    (async () => {
      try {
        const result = await dialog.showMessageBox({
          type: 'info',
          title: '更新已下载',
          message: `YesPlayMusic v${info.version} 已下载完成`,
          detail:
            '重启将安装更新，并中断当前播放。选择“稍后”可继续使用，下次启动时会再次提醒。',
          buttons: ['重启并更新', '稍后'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (result.response === 0) {
          await checkWritable(appImage);
          updater.quitAndInstall(false, true);
        }
      } catch (error) {
        await reportDownloadFailure(error);
      } finally {
        prompting = false;
      }
    })().catch(log);
  };

  // Subscribe before checking: a cached update may finish immediately.
  updater.on('error', onError);
  updater.on('update-available', onAvailable);
  updater.on('update-downloaded', onDownloaded);

  return {
    check() {
      if (!appImage) return Promise.resolve(null);
      if (checking) return checking;
      if (downloading || prompting) return Promise.resolve(null);
      checking = Promise.resolve()
        .then(() => updater.checkForUpdates())
        .catch(error => {
          // Offline startup and missing metadata must not prevent playback.
          log(`Linux update check skipped: ${error.message}`);
          return null;
        })
        .finally(() => {
          checking = null;
        });
      return checking;
    },
  };
}

module.exports = { assertAppImageWritable, createLinuxAppImageUpdater };
