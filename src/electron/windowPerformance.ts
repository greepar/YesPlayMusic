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

  if (suspended) {
    // 窗口最小化或隐藏时，主动清空渲染层与 GPU 缓存的图片、着色器纹理
    window.webContents.clearHistory?.();
    window.webContents.session?.clearImageCache?.();
    window.webContents.session?.clearHostResolverCache?.();
  }
}
