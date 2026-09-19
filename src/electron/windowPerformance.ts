import type { BrowserWindow } from 'electron';

export function setWindowRenderingSuspended(
  window: BrowserWindow,
  suspended: boolean
): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;

  // Chromium already throttles hidden pages; the renderer message additionally
  // releases decoded artwork and pauses application-owned visual timers.
  window.webContents.setBackgroundThrottling(true);
  window.webContents.send('rendering-suspended', suspended);
}
