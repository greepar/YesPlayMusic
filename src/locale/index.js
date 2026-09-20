import { createI18n } from 'vue-i18n';
import store from '@/store';

import en from './lang/en.js';
import zhCN from './lang/zh-CN.js';
import zhTW from './lang/zh-TW.js';
import tr from './lang/tr.js';

const i18n = createI18n({
  legacy: true,
  locale: store.state.settings.lang,
  messages: {
    en,
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    tr,
  },
  missingWarn: false,
  fallbackWarn: false,
});

// Keep the small imperative API used by existing utility modules while the
// templates use vue-i18n's Vue 3 plugin normally.
Object.defineProperty(i18n, 'locale', {
  get: () => i18n.global.locale,
  set: value => {
    i18n.global.locale = value;
  },
});
i18n.t = (...args) => i18n.global.t(...args);

export default i18n;
