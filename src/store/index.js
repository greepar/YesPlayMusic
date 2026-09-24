import { createStore } from 'vuex';
import state from './state';
import mutations from './mutations';
import actions from './actions';
import { changeAppearance, changeThemeColor } from '@/utils/theme';
import Player from '@/utils/Player';
import RemotePlayer from '@/player/RemotePlayer';
// vuex 自定义插件
import saveToLocalStorage from './plugins/localStorage';
import { getSendSettingsPlugin } from './plugins/sendSettings';

let plugins = [saveToLocalStorage];
if (process.env.IS_ELECTRON === true) {
  let sendSettings = getSendSettingsPlugin();
  plugins.push(sendSettings);
}
const options = {
  state,
  mutations,
  actions,
  plugins,
};

const store = createStore(options);
if (typeof window !== 'undefined') {
  window.__store__ = store;
}

if ([undefined, null].includes(store.state.settings.lang)) {
  const defaultLang = 'en';
  const langMapper = new Map()
    .set('zh', 'zh-CN')
    .set('zh-TW', 'zh-TW')
    .set('en', 'en')
    .set('tr', 'tr');
  store.state.settings.lang =
    langMapper.get(
      langMapper.has(navigator.language)
        ? navigator.language
        : navigator.language.slice(0, 2)
    ) || defaultLang;
  localStorage.setItem('settings', JSON.stringify(store.state.settings));
}

changeAppearance(store.state.settings.appearance);
changeThemeColor(store.state.settings.themeColor);

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => {
    if (store.state.settings.appearance === 'auto') {
      changeAppearance(store.state.settings.appearance);
      changeThemeColor(store.state.settings.themeColor);
    }
  });

const isAudioHost =
  process.env.IS_ELECTRON === true &&
  new URLSearchParams(window.location.search).has('audioHost');
let player =
  process.env.IS_ELECTRON === true && !isAudioHost
    ? new RemotePlayer()
    : new Player();
let savePlayerTimer = null;
let sendPlayerTimer = null;
const savePlayer = target => {
  savePlayerTimer = null;
  target.saveSelfToLocalStorage();
};
if (!(player instanceof RemotePlayer))
  player = new Proxy(player, {
    set(target, prop, val) {
      // console.log({ prop, val });
      target[prop] = val;
      if (prop === '_howler') return true;
      clearTimeout(savePlayerTimer);
      savePlayerTimer = setTimeout(() => savePlayer(target), 250);
      clearTimeout(sendPlayerTimer);
      sendPlayerTimer = setTimeout(() => {
        target.sendSelfToIpcMain();
      }, 50);
      return true;
    },
  });
store.state.player = player;

window.addEventListener('pagehide', () => {
  if (!(player instanceof RemotePlayer) && savePlayerTimer !== null)
    savePlayer(player);
});

export default store;
