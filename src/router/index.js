import {
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';
import { isLooseLoggedIn, isAccountLoggedIn } from '@/utils/auth';
import NProgress from 'nprogress';

const loadExplore = () => import('@/views/explore.vue');
export const preloadExplore = loadExplore;
const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/home.vue'),
    meta: {
      keepAlive: true,
      savePosition: true,
    },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login.vue'),
  },
  {
    path: '/login/username',
    name: 'loginUsername',
    component: () => import('@/views/loginUsername.vue'),
  },
  {
    path: '/login/account',
    name: 'loginAccount',
    component: () => import('@/views/loginAccount.vue'),
  },
  {
    path: '/playlist/:id',
    name: 'playlist',
    component: () => import('@/views/playlist.vue'),
  },
  {
    path: '/album/:id',
    name: 'album',
    component: () => import('@/views/album.vue'),
  },
  {
    path: '/artist/:id',
    name: 'artist',
    component: () => import('@/views/artist.vue'),
    meta: {
      keepAlive: true,
      savePosition: true,
    },
  },
  {
    path: '/artist/:id/mv',
    name: 'artistMV',
    component: () => import('@/views/artistMV.vue'),
    meta: {
      keepAlive: true,
    },
  },
  {
    path: '/mv/:id',
    name: 'mv',
    component: () => import('@/views/mv.vue'),
  },
  {
    path: '/next',
    name: 'next',
    component: () => import('@/views/next.vue'),
    meta: {
      keepAlive: true,
      savePosition: true,
    },
  },
  {
    path: '/search/:keywords?',
    name: 'search',
    component: () => import('@/views/search.vue'),
    meta: {
      keepAlive: true,
    },
  },
  {
    path: '/search/:keywords/:type',
    name: 'searchType',
    component: () => import('@/views/searchType.vue'),
  },
  {
    path: '/new-album',
    name: 'newAlbum',
    component: () => import('@/views/newAlbum.vue'),
  },
  {
    path: '/explore',
    name: 'explore',
    component: loadExplore,
    meta: {
      keepAlive: true,
      savePosition: true,
    },
  },
  {
    path: '/library',
    name: 'library',
    component: () => import('@/views/library.vue'),
    meta: {
      requireLogin: true,
      keepAlive: true,
      savePosition: true,
    },
  },
  {
    path: '/library/liked-songs',
    name: 'likedSongs',
    component: () => import('@/views/playlist.vue'),
    meta: {
      requireLogin: true,
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/settings.vue'),
  },
  {
    path: '/daily/songs',
    name: 'dailySongs',
    component: () => import('@/views/dailyTracks.vue'),
    meta: {
      requireAccountLogin: true,
    },
  },
];

const router = createRouter({
  history: process.env.IS_ELECTRON
    ? createWebHashHistory()
    : createWebHistory(),
  routes,
});

// Only show the progress bar for navigations that actually take a while;
// instant page switches would otherwise just flash it.
const PROGRESS_DELAY = 300;
let progressTimer = null;
function finishProgress() {
  clearTimeout(progressTimer);
  progressTimer = null;
  NProgress.done();
}

router.beforeEach(to => {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => NProgress.start(), PROGRESS_DELAY);
  // 需要登录的逻辑
  if (to.meta.requireAccountLogin) {
    return isAccountLoggedIn() ? true : { path: '/login/account' };
  }
  if (to.meta.requireLogin && !isLooseLoggedIn()) {
    return process.env.IS_ELECTRON === true
      ? { path: '/login/account' }
      : { path: '/login' };
  }
});

router.afterEach(finishProgress);
router.onError(finishProgress);

export default router;
