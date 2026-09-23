const platform = process.platform ||
  (typeof navigator !== 'undefined'
    ? /Windows/i.test(navigator.userAgent)
      ? 'win32'
      : /Macintosh|Mac OS X/i.test(navigator.userAgent)
      ? 'darwin'
      : /Linux/i.test(navigator.userAgent)
      ? 'linux'
      : ''
    : '');
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';
export const isDevelopment = process.env.NODE_ENV === 'development';

export const isElectron =
  Boolean(process.env.IS_ELECTRON) ||
  (typeof window !== 'undefined' &&
    (typeof window.require === 'function' ||
      (typeof navigator !== 'undefined' &&
        navigator.userAgent.toLowerCase().includes('electron'))));

export function getElectron() {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window['require'] === 'function'
    ) {
      return window['require']('electron');
    }
  } catch (_) {
    return null;
  }
  return null;
}

export function getIpcRenderer() {
  const electron = getElectron();
  return electron ? electron.ipcRenderer : null;
}

export const isCreateTray = isWindows || isLinux || isDevelopment;
export const isCreateMpris = isLinux;
