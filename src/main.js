import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import store from './store';
import i18n from '@/locale';
import { installIcons } from '@/assets/icons';
import { installFilters } from '@/utils/filters';
import { installVirtualImage } from '@/directives/virtualImage';
import './registerServiceWorker';
import { dailyTask } from '@/utils/common';
import '@/assets/css/global.scss';
import NProgress from 'nprogress';
import '@/assets/css/nprogress.css';

window.resetApp = () => {
  localStorage.clear();
  indexedDB.deleteDatabase('yesplaymusic');
  document.cookie.split(';').forEach(function (c) {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
  });
  return '已重置应用，请刷新页面（按Ctrl/Command + R）';
};
console.log(
  '如出现问题，可尝试在本页输入 %cresetApp()%c 然后按回车重置应用。',
  'background: #eaeffd;color:#335eea;padding: 4px 6px;border-radius:3px;',
  'background:unset;color:unset;'
);

NProgress.configure({ showSpinner: false, trickleSpeed: 100 });
dailyTask();

const app = createApp(App);
app.use(i18n);
app.use(store);
app.use(router);
installIcons(app);
installFilters(app);
installVirtualImage(app);
app.config.globalProperties.$copyText = async text => {
  await navigator.clipboard.writeText(text);
};
app.mount('#app');
window.__YESPLAYMUSIC_STORE__ = store;
