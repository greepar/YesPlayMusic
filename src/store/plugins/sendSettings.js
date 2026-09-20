export function getSendSettingsPlugin() {
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;
  return store => {
    store.subscribe((mutation, state) => {
      // console.log(mutation);
      if (mutation.type !== 'updateSettings') return;
      // Vue 3 stores state in Proxies, which Electron cannot structured-clone.
      ipcRenderer.send('settings', JSON.parse(JSON.stringify(state.settings)));
    });
  };
}
