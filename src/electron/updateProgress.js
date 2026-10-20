function createUpdateProgress({
  getWindow,
  platform = process.platform,
  log = () => {},
}) {
  let state = { phase: 'idle', percent: 0 };
  const isActive = () =>
    ['checking', 'downloading', 'installing'].includes(state.phase);
  const restore = () => {
    try {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      let progress = -1;
      if (state.phase === 'downloading') progress = state.percent / 100;
      if (state.phase === 'checking' && platform === 'win32') progress = 2;
      if (state.phase === 'installing') progress = platform === 'win32' ? 2 : 1;
      try {
        win.setProgressBar(progress);
      } catch (error) {
        log(`System update progress unavailable: ${error.message}`);
      }
      if (!win.webContents?.isDestroyed())
        win.webContents?.send('updates:progress', state);
    } catch (error) {
      // Unsupported desktop integration must never prevent an update.
      log(`Update progress display unavailable: ${error.message}`);
    }
  };
  return {
    isActive,
    restore,
    getState: () => ({ ...state }),
    report(next) {
      state = {
        ...next,
        percent: Number.isFinite(next.percent)
          ? Math.max(0, Math.min(100, next.percent))
          : 0,
      };
      restore();
    },
  };
}

module.exports = { createUpdateProgress };
