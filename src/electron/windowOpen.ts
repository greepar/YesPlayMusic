import { shell } from 'electron';
import type { BrowserWindow } from 'electron';

const EXTERNAL_URL = /^https?:\/\//i;

/** 只允许把 http / https 地址交给系统浏览器，避免 file:// 等协议被拉起 */
export function isExternalUrl(url: string): boolean {
  return EXTERNAL_URL.test(url);
}

/**
 * Electron 22 起 `new-window` 事件已被移除。
 * target="_blank" / window.open 的外链一律交给系统浏览器打开，应用内不再新开窗口。
 */
export function openExternalLinksInBrowser(
  win: BrowserWindow,
  log?: (text: string) => void
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      log?.(`open url: ${url}`);
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}
