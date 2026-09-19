import store from '@/store';
import { setRenderingSuspended } from '@/utils/renderLifecycle';

const player = store.state.player;

export function ipcRenderer(vueInstance) {
  const self = vueInstance;
  // 添加专有的类名
  document.body.setAttribute('data-electron', 'yes');
  document.body.setAttribute(
    'data-electron-os',
    window.require('os').platform()
  );
  // ipc message channel
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;
  window.uiActivityLock = {
    acquire: () => ipcRenderer.send('ui:activity-lock', 'acquire'),
    release: () => ipcRenderer.send('ui:activity-lock', 'release'),
  };

  // listens to the main process 'changeRouteTo' event and changes the route from
  // inside this Vue instance, according to what path the main process requires.
  // responds to Menu click() events at the main process and changes the route accordingly.

  ipcRenderer.on('changeRouteTo', (event, path) => {
    self.$router.push(path);
    if (store.state.showLyrics) {
      store.commit('toggleLyrics');
    }
  });

  ipcRenderer.on('search', () => {
    // 触发数据响应
    self.$refs.navbar.$refs.searchInput.focus();
    self.$refs.navbar.inputFocus = true;
  });

  ipcRenderer.on('play', () => {
    player.playOrPause();
  });

  ipcRenderer.on('next', () => {
    if (player.isPersonalFM) {
      player.playNextFMTrack();
    } else {
      player.playNextTrack();
    }
  });

  ipcRenderer.on('previous', () => {
    player.playPrevTrack();
  });

  ipcRenderer.on('increaseVolume', () => {
    if (player.volume + 0.1 >= 1) {
      return (player.volume = 1);
    }
    player.volume += 0.1;
  });

  ipcRenderer.on('decreaseVolume', () => {
    if (player.volume - 0.1 <= 0) {
      return (player.volume = 0);
    }
    player.volume -= 0.1;
  });

  ipcRenderer.on('like', () => {
    store.dispatch('likeATrack', player.currentTrack.id);
  });

  ipcRenderer.on('repeat', () => {
    player.switchRepeatMode();
  });

  ipcRenderer.on('shuffle', () => {
    player.switchShuffle();
  });

  ipcRenderer.on('routerGo', (event, where) => {
    self.$refs.navbar.go(where);
  });

  ipcRenderer.on('nextUp', () => {
    self.$refs.player.goToNextTracksPage();
  });

  ipcRenderer.on('rememberCloseAppOption', (event, value) => {
    store.commit('updateSettings', {
      key: 'closeAppOption',
      value,
    });
  });

  ipcRenderer.on('setPosition', (event, position) => {
    player.seek(position);
  });

  ipcRenderer.on('rendering-suspended', (event, suspended) => {
    setRenderingSuspended(suspended);
  });

  ipcRenderer.on('ui:restore-state', (event, state) => {
    if (state.showLyrics !== store.state.showLyrics)
      store.commit('toggleLyrics');
    self.$nextTick(() => {
      requestAnimationFrame(() => {
        const main = document.querySelector('main');
        if (main) main.scrollTop = state.scrollTop || 0;
      });
    });
  });

  ipcRenderer.on('audio-renderer-failed', () => {
    store.dispatch('showToast', '音频进程异常退出，自动恢复失败');
  });
}
