function createDownloadedUpdateController({
  updater,
  dialog,
  enabled = true,
  platformName = 'Desktop',
  confirmBeforeDownload = false,
  canNotify = () => true,
  onProgress = () => {},
  beforeDownload = async () => {},
  beforeInstall = async () => {},
  installDetail = '重启将安装更新，并中断当前播放。选择“稍后”可继续使用，下次启动时会再次提醒。',
  log = console.log,
}) {
  // Downloads and restarts are controlled here rather than by the updater's
  // automatic policies, including consent before download when requested.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  let checking = null;
  let downloading = false;
  let prompting = false;
  let downloadFailureShown = false;
  let installApproved = false;
  let availableVersion = null;
  let manualRequested = false;
  let progressPhase = 'idle';
  const reportProgress = (phase, details = {}) => {
    progressPhase = phase;
    try {
      onProgress({ phase, ...details });
    } catch (error) {
      log(error);
    }
  };

  const reportDownloadFailure = async error => {
    reportProgress('error', { message: error.message });
    log(`${platformName} update failed: ${error.message}`);
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
    log(`${platformName} updater: ${error.message}`);
    if (downloading || prompting) {
      reportDownloadFailure(error).catch(log);
    }
  };
  const onAvailable = info => {
    availableVersion = info.version;
    if (!manualRequested && !canNotify()) return;
    if (downloading || prompting) return;
    reportProgress('available', { version: info.version });
    downloading = true;
    downloadFailureShown = false;
    (async () => {
      try {
        if (confirmBeforeDownload) {
          const result = await dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `发现 YesPlayMusic v${info.version}`,
            detail:
              '选择“下载并安装”后才会下载安装包。下载完成将自动重启并安装，中断当前播放。选择“稍后”不会下载。',
            buttons: ['下载并安装', '稍后'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          });
          if (result.response !== 0) {
            reportProgress('idle');
            return;
          }
          installApproved = true;
        }
        await beforeDownload();
        reportProgress('downloading', { percent: 0 });
        log(`Downloading ${platformName} update ${info.version}`);
        // The release provider selects the installer and electron-updater
        // verifies SHA-256 from the GitHub Release asset digest.
        await updater.downloadUpdate();
      } catch (error) {
        installApproved = false;
        await reportDownloadFailure(error);
      } finally {
        downloading = false;
      }
    })().catch(log);
  };
  const onDownloaded = info => {
    if (prompting) return;
    if (confirmBeforeDownload && !installApproved) return;
    reportProgress('ready', { percent: 100, version: info.version });
    prompting = true;
    (async () => {
      try {
        if (confirmBeforeDownload) {
          installApproved = false;
          await beforeInstall();
          reportProgress('installing');
          await updater.quitAndInstall(false, true);
          return;
        }
        const result = await dialog.showMessageBox({
          type: 'info',
          title: '更新已下载',
          message: `YesPlayMusic v${info.version} 已下载完成`,
          detail: installDetail,
          buttons: ['重启并更新', '稍后'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (result.response === 0) {
          await beforeInstall();
          reportProgress('installing');
          await updater.quitAndInstall(false, true);
        } else {
          reportProgress('ready', { percent: 100, version: info.version });
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
  updater.on('download-progress', progress => {
    if (progressPhase !== 'downloading') return;
    const percent = Number.isFinite(progress.percent)
      ? progress.percent
      : progress.total > 0
        ? (progress.transferred / progress.total) * 100
        : 0;
    reportProgress('downloading', {
      percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  return {
    check({ manual = false } = {}) {
      if (!enabled) return Promise.resolve({ status: 'unavailable' });
      if (checking) {
        manualRequested ||= manual;
        return checking;
      }
      if (downloading || prompting) return Promise.resolve({ status: 'busy' });
      manualRequested = manual;
      availableVersion = null;
      reportProgress('checking');
      checking = Promise.resolve()
        .then(() => updater.checkForUpdates())
        .then(() => ({
          status: availableVersion ? 'available' : 'up-to-date',
          version: availableVersion,
        }))
        .catch(error => {
          // Offline startup and missing metadata must not prevent playback.
          log(`${platformName} update check skipped: ${error.message}`);
          reportProgress('error', { message: error.message });
          return { status: 'error', message: error.message };
        })
        .finally(() => {
          checking = null;
          if (progressPhase === 'checking') reportProgress('idle');
        });
      return checking;
    },
  };
}

module.exports = { createDownloadedUpdateController };
