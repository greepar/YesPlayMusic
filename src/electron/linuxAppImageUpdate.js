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

const { createDownloadedUpdateController } = require('./downloadedUpdate');

function createLinuxAppImageUpdater({
  appImage = process.env.APPIMAGE,
  checkWritable = assertAppImageWritable,
  ...options
}) {
  return createDownloadedUpdateController({
    ...options,
    enabled: Boolean(appImage),
    platformName: 'Linux',
    beforeDownload: () => checkWritable(appImage),
    beforeInstall: () => checkWritable(appImage),
  });
}

module.exports = { assertAppImageWritable, createLinuxAppImageUpdater };
