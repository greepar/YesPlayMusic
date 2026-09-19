export default store => {
  let saveTimer = null;
  const persistedMutations = new Set([
    'changeLang',
    'changeMusicQuality',
    'changeLyricFontSize',
    'changeOutputDevice',
    'updateSettings',
    'updateData',
    'togglePlaylistCategory',
    'updateShortcut',
    'restoreDefaultShortcuts',
  ]);
  const save = () => {
    saveTimer = null;
    localStorage.setItem('settings', JSON.stringify(store.state.settings));
    localStorage.setItem('data', JSON.stringify(store.state.data));
  };

  store.subscribe(mutation => {
    if (!persistedMutations.has(mutation.type)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  });

  // Do not lose the last pending update when the tab/window closes.
  window.addEventListener('pagehide', () => {
    if (saveTimer !== null) save();
  });
};
