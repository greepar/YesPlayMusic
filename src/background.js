'use strict';
import {
  app,
  protocol,
  BrowserWindow,
  shell,
  dialog,
  globalShortcut,
  nativeTheme,
  screen,
  powerMonitor,
} from 'electron';
import {
  isWindows,
  isMac,
  isLinux,
  isDevelopment,
  isCreateTray,
  isCreateMpris,
} from '@/utils/platform';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
import { startNeteaseMusicApi } from './electron/services';
import { getLatestPlayerSnapshot, initIpcMain } from './electron/ipcMain.js';
import { openExternalLinksInBrowser } from './electron/windowOpen';
import { setWindowRenderingSuspended } from './electron/windowPerformance';
import { createMenu } from './electron/menu';
import { createTray } from '@/electron/tray';
import { createTouchBar } from './electron/touchBar';
import { createDockMenu } from './electron/dockMenu';
import { registerGlobalShortcut } from './electron/globalShortcut';
import { autoUpdater } from 'electron-updater';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';
import { EventEmitter } from 'events';
import express from 'express';
import expressProxy from 'express-http-proxy';
import Store from 'electron-store';
import { createMpris, createDbus } from '@/electron/mpris';
import { spawn } from 'child_process';
const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[background.js]')} ${text}`);
};

class RebuildableWindow {
  constructor(owner) {
    this.owner = owner;
  }
  get webContents() {
    return this.owner.window?.webContents || { id: -1, send() {} };
  }
  show() {
    this.owner.restoreWindow();
  }
  hide() {
    this.owner.window?.hide();
  }
  minimize() {
    this.owner.window?.minimize();
  }
  maximize() {
    this.owner.window?.maximize();
  }
  unmaximize() {
    this.owner.window?.unmaximize();
  }
  restore() {
    this.owner.window?.restore();
  }
  focus() {
    this.owner.window?.focus();
  }
  isVisible() {
    return this.owner.window?.isVisible() || false;
  }
  isMinimized() {
    return this.owner.window?.isMinimized() || false;
  }
  isMaximized() {
    return this.owner.window?.isMaximized() || false;
  }
}

class RebuildableAudioWindow {
  constructor(owner) {
    this.owner = owner;
  }
  get webContents() {
    return this.owner.audioWindow?.webContents || { id: -1, send() {} };
  }
  isDestroyed() {
    return !this.owner.audioWindow || this.owner.audioWindow.isDestroyed();
  }
}

const closeOnLinux = (e, win, store) => {
  let closeOpt = store.get('settings.closeAppOption');
  if (closeOpt !== 'exit') {
    e.preventDefault();
  }

  if (closeOpt === 'ask') {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Information',
        cancelId: 2,
        defaultId: 0,
        message: '确定要关闭吗？',
        buttons: ['最小化到托盘', '直接退出'],
        checkboxLabel: '记住我的选择',
      })
      .then(result => {
        if (result.checkboxChecked && result.response !== 2) {
          win.webContents.send(
            'rememberCloseAppOption',
            result.response === 0 ? 'minimizeToTray' : 'exit'
          );
        }

        if (result.response === 0) {
          win.hide(); //调用 最小化实例方法
        } else if (result.response === 1) {
          win = null;
          app.exit(); //exit()直接关闭客户端，不会执行quit();
        }
      })
      .catch(err => {
        log(err);
      });
  } else if (closeOpt === 'exit') {
    win = null;
    app.quit();
  } else {
    win.hide();
  }
};

class Background {
  constructor() {
    this.window = null;
    this.windowFacade = new RebuildableWindow(this);
    this.audioWindow = null;
    this.audioFacade = new RebuildableAudioWindow(this);
    this.uiReleaseTimer = null;
    this.uiActivityLocks = 0;
    this.destroyingUi = false;
    this.audioRestarted = false;
    this.isQuitting = false;
    this.ypmTrayImpl = null;
    this.store = new Store({
      windowWidth: {
        width: { type: 'number', default: 1440 },
        height: { type: 'number', default: 840 },
      },
    });
    this.neteaseMusicAPI = null;
    this.expressApp = null;
    this.willQuitApp = false;

    this.init();
  }

  init() {
    log('initializing');

    // Make sure the app is singleton.
    if (!app.requestSingleInstanceLock()) return app.quit();

    // start netease music api
    this.neteaseMusicAPI = startNeteaseMusicApi();

    // create Express app
    this.createExpressApp();

    // Scheme must be registered before the app is ready
    protocol.registerSchemesAsPrivileged([
      { scheme: 'app', privileges: { secure: true, standard: true } },
    ]);
    // Playback is initiated through IPC, so the hidden audio renderer never
    // receives a direct pointer gesture of its own.
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
    app.commandLine.appendSwitch('js-flags', '--expose-gc');
    // 界面和隐藏的音频页面同源（都是 localhost:27232），合并到同一个渲染进程里，
    // 省下一个独立的渲染进程（实测冷启动约 -190MB，进程数与没有音频后台时一致）。
    // 代价：这个渲染进程崩溃时界面和音频会一起停止（音频页面会被自动重建一次）。
    app.commandLine.appendSwitch('process-per-site');

    // handle app events
    this.handleAppEvents();

    // disable chromium mpris
    if (isCreateMpris) {
      app.commandLine.appendSwitch(
        'disable-features',
        'HardwareMediaKeyHandling,MediaSessionService'
      );
    }
  }

  async initDevtools() {
    // Install Vue Devtools extension
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString());
    }

    // Exit cleanly on request from parent process in development mode.
    if (isWindows) {
      process.on('message', data => {
        if (data === 'graceful-exit') {
          app.quit();
        }
      });
    } else {
      process.on('SIGTERM', () => {
        app.quit();
      });
    }
  }

  createExpressApp() {
    log('creating express app');

    const expressApp = express();
    expressApp.use('/', express.static(__dirname + '/'));
    expressApp.use('/api', expressProxy('http://127.0.0.1:10754'));
    expressApp.use('/player', (req, res) => {
      const result = getLatestPlayerSnapshot();
      res.send({
        currentTrack: result?.currentTrack || null,
        progress: result?.progress || 0,
      });
    });
    this.expressApp = expressApp.listen(27232, '127.0.0.1');
  }

  createWindow() {
    log('creating app window');

    const appearance = this.store.get('settings.appearance');
    const showLibraryDefault = this.store.get('settings.showLibraryDefault');
    const restoredRoute = this.store.get('uiState.route');

    const options = {
      width: this.store.get('window.width') || 1440,
      height: this.store.get('window.height') || 840,
      minWidth: 1080,
      minHeight: 720,
      titleBarStyle: 'hiddenInset',
      // 让红绿灯与 64px 高的导航栏垂直居中对齐（仅 macOS 生效）
      trafficLightPosition: { x: 20, y: 25 },
      frame: !(
        isWindows ||
        (isLinux && this.store.get('settings.linuxEnableCustomTitlebar'))
      ),
      title: 'YesPlayMusic',
      show: false,
      webPreferences: {
        webSecurity: false,
        nodeIntegration: true,
        enableRemoteModule: true,
        contextIsolation: false,
      },
      backgroundColor:
        ((appearance === undefined || appearance === 'auto') &&
          nativeTheme.shouldUseDarkColors) ||
        appearance === 'dark'
          ? '#222'
          : '#fff',
    };

    if (this.store.get('window.x') && this.store.get('window.y')) {
      let x = this.store.get('window.x');
      let y = this.store.get('window.y');

      let displays = screen.getAllDisplays();
      let isResetWindiw = false;
      if (displays.length === 1) {
        let { bounds } = displays[0];
        if (
          x < bounds.x ||
          x > bounds.x + bounds.width - 50 ||
          y < bounds.y ||
          y > bounds.y + bounds.height - 50
        ) {
          isResetWindiw = true;
        }
      } else {
        isResetWindiw = true;
        for (let i = 0; i < displays.length; i++) {
          let { bounds } = displays[i];
          if (
            x > bounds.x &&
            x < bounds.x + bounds.width &&
            y > bounds.y &&
            y < bounds.y - bounds.height
          ) {
            // 检测到APP窗口当前处于一个可用的屏幕里，break
            isResetWindiw = false;
            break;
          }
        }
      }

      if (!isResetWindiw) {
        options.x = x;
        options.y = y;
      }
    }

    this.window = new BrowserWindow(options);

    // hide menu bar on Microsoft Windows and Linux
    this.window.setMenuBarVisibility(false);

    if (process.env.WEBPACK_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      this.window.loadURL(
        restoredRoute
          ? `${process.env.WEBPACK_DEV_SERVER_URL}/${restoredRoute}`
          : showLibraryDefault
          ? `${process.env.WEBPACK_DEV_SERVER_URL}/#/library`
          : process.env.WEBPACK_DEV_SERVER_URL
      );
      if (!process.env.IS_TEST) this.window.webContents.openDevTools();
    } else {
      createProtocol('app');
      this.window.loadURL(
        restoredRoute
          ? `http://localhost:27232/${restoredRoute}`
          : showLibraryDefault
          ? 'http://localhost:27232/#/library'
          : 'http://localhost:27232'
      );
    }
    this.handleWindowEvents();
  }

  cancelUiRelease() {
    clearTimeout(this.uiReleaseTimer);
    this.uiReleaseTimer = null;
  }

  scheduleUiRelease() {
    this.cancelUiRelease();
    if (this.store.get('settings.disableUiAutoRelease') === true) return;
    const explicitlyEnabled =
      this.store.get('settings.enableUiAutoReleaseOnUntestedPlatforms') ===
      true;
    if ((!isMac || process.arch !== 'arm64') && !explicitlyEnabled) return;
    this.uiReleaseTimer = setTimeout(() => this.releaseUiWindow(), 30000);
  }

  async releaseUiWindow() {
    this.uiReleaseTimer = null;
    const win = this.window;
    if (!win || win.isDestroyed() || win.isVisible()) return;
    if (this.uiActivityLocks > 0) return this.scheduleUiRelease();
    try {
      const state = await win.webContents.executeJavaScript(`({
        route: location.hash || '#/',
        scrollTop: document.querySelector('main')?.scrollTop || 0,
        showLyrics: !!window.__YESPLAYMUSIC_STORE__?.state?.showLyrics
      })`);
      this.store.set('uiState', state);
      this.destroyingUi = true;
      win.destroy();
      this.window = null;
      this.destroyingUi = false;
      log('released hidden UI renderer');
    } catch (error) {
      log(`failed to snapshot UI renderer: ${error.message}`);
      setWindowRenderingSuspended(win, true);
    }
  }

  restoreWindow() {
    this.cancelUiRelease();
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
      return;
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  createAudioWindow() {
    if (this.audioWindow && !this.audioWindow.isDestroyed()) return;
    this.audioWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        webSecurity: false,
        nodeIntegration: true,
        enableRemoteModule: false,
        contextIsolation: false,
        backgroundThrottling: false,
        images: false,
        spellcheck: false,
        enableWebSQL: false,
        navigateOnDragDrop: false,
      },
    });
    const audioUrl = process.env.WEBPACK_DEV_SERVER_URL
      ? `${process.env.WEBPACK_DEV_SERVER_URL}/audio.html?audioHost=1`
      : 'http://localhost:27232/audio.html?audioHost=1';
    this.audioWindow.loadURL(audioUrl);
    this.audioWindow.on('close', event => {
      if (!this.isQuitting) event.preventDefault();
    });
    this.audioWindow.webContents.on(
      'render-process-gone',
      (_event, details) => {
        log(`audio renderer exited: ${details.reason}`);
        const crashedWindow = this.audioWindow;
        this.audioWindow = null;
        crashedWindow?.removeAllListeners('close');
        crashedWindow?.destroy();
        if (!this.isQuitting && !this.audioRestarted) {
          this.audioRestarted = true;
          this.createAudioWindow();
        } else if (!this.isQuitting) {
          this.windowFacade.webContents.send(
            'audio-renderer-failed',
            details.reason
          );
        }
      }
    );
  }

  checkForUpdates() {
    if (isDevelopment) return;
    log('checkForUpdates');
    autoUpdater.checkForUpdatesAndNotify().catch(error => {
      // Unpacked development builds do not contain app-update.yml.
      log(`update check skipped: ${error.message}`);
    });

    const showNewVersionMessage = info => {
      dialog
        .showMessageBox({
          title: '发现新版本 v' + info.version,
          message: '发现新版本 v' + info.version,
          detail: '是否前往 GitHub 下载新版本安装包？',
          buttons: ['下载', '取消'],
          type: 'question',
          noLink: true,
        })
        .then(result => {
          if (result.response === 0) {
            shell.openExternal(
              'https://github.com/greepar/YesPlayMusic/releases'
            );
          }
        });
    };

    autoUpdater.on('update-available', info => {
      showNewVersionMessage(info);
    });
  }

  handleWindowEvents() {
    const win = this.window;
    win.once('ready-to-show', () => {
      log('window ready-to-show event');
      win.show();
      this.store.set('window', win.getBounds());
      const state = this.store.get('uiState');
      if (state) win.webContents.send('ui:restore-state', state);
    });

    win.on('close', e => {
      log('window close event');
      if (this.destroyingUi) return;

      if (isLinux) {
        closeOnLinux(e, win, this.store);
      } else if (isMac) {
        if (this.willQuitApp) {
          this.window = null;
          app.quit();
        } else {
          e.preventDefault();
          win.hide();
        }
      } else {
        let closeOpt = this.store.get('settings.closeAppOption');
        if (this.willQuitApp && (closeOpt === 'exit' || closeOpt === 'ask')) {
          this.window = null;
          app.quit();
        } else {
          e.preventDefault();
          win.hide();
        }
      }
    });

    win.on('resized', () => {
      this.store.set('window', win.getBounds());
    });

    win.on('moved', () => {
      this.store.set('window', win.getBounds());
    });

    win.on('maximize', () => {
      win.webContents.send('isMaximized', true);
    });

    win.on('unmaximize', () => {
      win.webContents.send('isMaximized', false);
    });

    win.on('minimize', () => {
      setWindowRenderingSuspended(win, true);
      this.scheduleUiRelease();
    });

    win.on('hide', () => {
      setWindowRenderingSuspended(win, true);
      this.scheduleUiRelease();
    });

    win.on('restore', () => {
      this.cancelUiRelease();
      setWindowRenderingSuspended(win, false);
    });

    win.on('show', () => {
      this.cancelUiRelease();
      setWindowRenderingSuspended(win, false);
    });

    win.webContents.on('did-finish-load', () => {
      setWindowRenderingSuspended(win, !win.isVisible() || win.isMinimized());
    });

    openExternalLinksInBrowser(win, log);
  }

  handleAppEvents() {
    app.on('ready', async () => {
      // This method will be called when Electron has finished
      // initialization and is ready to create browser windows.
      // Some APIs can only be used after this event occurs.
      log('app ready event');

      // for development
      if (isDevelopment) {
        this.initDevtools();
      }

      // The hidden renderer owns Howler and remains alive when the UI is hidden.
      this.createAudioWindow();
      // create window
      this.createWindow();

      // create tray
      if (isCreateTray) {
        this.trayEventEmitter = new EventEmitter();
        this.ypmTrayImpl = createTray(
          this.windowFacade,
          this.trayEventEmitter,
          this.store,
          this.audioFacade
        );
      }

      // init ipcMain
      initIpcMain(
        this.windowFacade,
        this.store,
        this.trayEventEmitter,
        this.audioFacade,
        {
          acquire: () => {
            this.uiActivityLocks += 1;
          },
          release: () => {
            this.uiActivityLocks = Math.max(0, this.uiActivityLocks - 1);
            if (
              this.uiActivityLocks === 0 &&
              this.window &&
              !this.window.isVisible()
            )
              this.scheduleUiRelease();
          },
        }
      );

      // set proxy
      const proxyRules = this.store.get('proxy');
      if (proxyRules) {
        this.window.webContents.session.setProxy({ proxyRules }, result => {
          log('finished setProxy', result);
        });
      }

      // check for updates
      this.checkForUpdates();

      // create menu
      createMenu(this.windowFacade, this.store, this.audioFacade);

      // create dock menu for macOS
      const createdDockMenu = createDockMenu(this.windowFacade);
      if (createDockMenu && app.dock) app.dock.setMenu(createdDockMenu);

      // create touch bar
      const createdTouchBar = createTouchBar(this.window);
      if (createdTouchBar) this.window.setTouchBar(createdTouchBar);

      // register global shortcuts
      if (this.store.get('settings.enableGlobalShortcut') !== false) {
        registerGlobalShortcut(this.windowFacade, this.store, this.audioFacade);
      }

      // try to start osdlyrics process on start
      if (this.store.get('settings.enableOsdlyricsSupport')) {
        try {
          await createDbus(this.audioFacade);
          log('try to start osdlyrics process');
          const osdlyricsProcess = spawn('osdlyrics');

          osdlyricsProcess.on('error', err => {
            log(`failed to start osdlyrics: ${err.message}`);
          });

          osdlyricsProcess.on('exit', (code, signal) => {
            log(`osdlyrics process exited with code ${code}, signal ${signal}`);
          });
        } catch (error) {
          log(`failed to initialize desktop lyrics: ${error.message}`);
        }
      }

      // create mpris
      if (isCreateMpris) {
        createMpris(this.audioFacade);
      }

      powerMonitor.on('suspend', () => {
        this.audioFacade.webContents.send('player:request-snapshot');
      });
      powerMonitor.on('resume', () => {
        this.audioFacade.webContents.send('system-resume');
      });
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      log('app activate event');
      this.restoreWindow();
    });

    app.on('window-all-closed', () => {
      if (!isMac) {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      this.willQuitApp = true;
      this.isQuitting = true;
      this.audioWindow?.destroy();
    });

    app.on('quit', () => {
      this.expressApp.close();
    });

    app.on('will-quit', () => {
      // unregister all global shortcuts
      globalShortcut.unregisterAll();
    });

    if (!isMac) {
      app.on('second-instance', () => {
        this.restoreWindow();
      });
    }
  }
}

new Background();
