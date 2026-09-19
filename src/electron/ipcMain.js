import { app, dialog, globalShortcut, ipcMain } from 'electron';
import { registerGlobalShortcut } from '@/electron/globalShortcut';
import cloneDeep from 'lodash/cloneDeep';
import shortcuts from '@/utils/shortcuts';
import { createMenu } from './menu';
import { isCreateTray, isMac } from '@/utils/platform';
import { isPlayerCommand } from '@/player/protocol';

let latestPlayerSnapshot = null;
export const getLatestPlayerSnapshot = () => latestPlayerSnapshot;

const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[ipcMain.js]')} ${text}`);
};

const exitAsk = (e, win) => {
  e.preventDefault(); //阻止默认行为
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Information',
      cancelId: 2,
      defaultId: 0,
      message: '确定要关闭吗？',
      buttons: ['最小化', '直接退出'],
    })
    .then(result => {
      if (result.response == 0) {
        e.preventDefault(); //阻止默认行为
        win.minimize(); //调用 最小化实例方法
      } else if (result.response == 1) {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      }
    })
    .catch(err => {
      log(err);
    });
};

const exitAskWithoutMac = (e, win) => {
  e.preventDefault(); //阻止默认行为
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
        e.preventDefault(); //阻止默认行为
        win.hide(); //调用 最小化实例方法
      } else if (result.response === 1) {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      }
    })
    .catch(err => {
      log(err);
    });
};

const client = require('discord-rich-presence')('818936529484906596');

export function initIpcMain(
  win,
  store,
  trayEventEmitter,
  audioWindow,
  uiLocks
) {
  const pendingPlayerCommands = new Map();
  const completedPlayerCommands = new Map();
  const isUiSender = event => event.sender.id === win?.webContents.id;
  const isAudioSender = event =>
    event.sender.id === audioWindow?.webContents.id;

  ipcMain.on('ui:activity-lock', (event, action) => {
    if (!isUiSender(event)) return;
    if (action === 'acquire') uiLocks?.acquire();
    if (action === 'release') uiLocks?.release();
  });

  ipcMain.on('player:host-ready', (event, sessionId) => {
    if (!isAudioSender(event) || typeof sessionId !== 'string') return;
    win?.webContents.send('player:host-ready', sessionId);
    if (latestPlayerSnapshot) {
      event.sender.send('player:restore', latestPlayerSnapshot);
    }
  });
  ipcMain.on('player:snapshot', (event, snapshot) => {
    if (
      !isAudioSender(event) ||
      !snapshot ||
      typeof snapshot.version !== 'number'
    )
      return;
    if (
      latestPlayerSnapshot &&
      latestPlayerSnapshot.sessionId === snapshot.sessionId &&
      latestPlayerSnapshot.version >= snapshot.version
    )
      return;
    latestPlayerSnapshot = snapshot;
    win?.webContents.send('player:snapshot', snapshot);
  });
  ipcMain.on('player:result', (event, result) => {
    if (!isAudioSender(event) || !result?.requestId) return;
    const resolve = pendingPlayerCommands.get(result.requestId);
    if (resolve) {
      pendingPlayerCommands.delete(result.requestId);
      completedPlayerCommands.set(result.requestId, result);
      if (completedPlayerCommands.size > 100)
        completedPlayerCommands.delete(
          completedPlayerCommands.keys().next().value
        );
      resolve(result);
    }
  });
  ipcMain.on('player:subscribe', event => {
    if (!isUiSender(event)) return;
    if (latestPlayerSnapshot)
      event.sender.send('player:snapshot', latestPlayerSnapshot);
    audioWindow?.webContents.send('player:request-snapshot');
  });
  ipcMain.handle('player:command', (event, command) => {
    if (!isUiSender(event) || !isPlayerCommand(command)) {
      return {
        requestId: command?.requestId || '',
        sessionId: '',
        ok: false,
        version: latestPlayerSnapshot?.version || 0,
        error: 'Invalid player command',
      };
    }
    if (completedPlayerCommands.has(command.requestId))
      return completedPlayerCommands.get(command.requestId);
    if (!audioWindow || audioWindow.isDestroyed()) {
      return {
        requestId: command.requestId,
        sessionId: '',
        ok: false,
        version: latestPlayerSnapshot?.version || 0,
        error: 'Audio renderer is unavailable',
      };
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pendingPlayerCommands.delete(command.requestId);
        resolve({
          requestId: command.requestId,
          sessionId: latestPlayerSnapshot?.sessionId || '',
          ok: false,
          version: latestPlayerSnapshot?.version || 0,
          error: 'Player command timed out',
        });
      }, 10000);
      pendingPlayerCommands.set(command.requestId, result => {
        clearTimeout(timer);
        resolve(result);
      });
      audioWindow.webContents.send('player:command', command);
    });
  });
  ipcMain.on('close', e => {
    if (isMac) {
      win.hide();
      exitAsk(e, win);
    } else {
      let closeOpt = store.get('settings.closeAppOption');
      if (closeOpt === 'exit') {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      } else if (closeOpt === 'minimizeToTray') {
        e.preventDefault();
        win.hide();
      } else {
        exitAskWithoutMac(e, win);
      }
    }
  });

  ipcMain.on('minimize', () => {
    win.minimize();
  });

  ipcMain.on('maximizeOrUnmaximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on('settings', (event, options) => {
    store.set('settings', options);
    audioWindow?.webContents.send('settings-sync', options);
    if (options.enableGlobalShortcut) {
      registerGlobalShortcut(win, store, audioWindow);
    } else {
      log('unregister global shortcut');
      globalShortcut.unregisterAll();
    }
  });

  ipcMain.on('playDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      endTimestamp: Date.now() + track.dt,
      largeImageKey: track.al.picUrl,
      largeImageText: 'Listening ' + track.name,
      smallImageKey: 'play',
      smallImageText: 'Playing',
      instance: true,
    });
  });

  ipcMain.on('pauseDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      largeImageKey: track.al.picUrl,
      largeImageText: 'YesPlayMusic',
      smallImageKey: 'pause',
      smallImageText: 'Pause',
      instance: true,
    });
  });

  ipcMain.on('setProxy', (event, config) => {
    const proxyRules = `${config.protocol}://${config.server}:${config.port}`;
    store.set('proxy', proxyRules);
    win.webContents.session.setProxy(
      {
        proxyRules,
      },
      () => {
        log('finished setProxy');
      }
    );
  });

  ipcMain.on('removeProxy', (event, arg) => {
    log('removeProxy');
    win.webContents.session.setProxy({});
    store.set('proxy', '');
  });

  ipcMain.on('switchGlobalShortcutStatusTemporary', (e, status) => {
    log('switchGlobalShortcutStatusTemporary');
    if (status === 'disable') {
      globalShortcut.unregisterAll();
    } else {
      registerGlobalShortcut(win, store, audioWindow);
    }
  });

  ipcMain.on('updateShortcut', (e, { id, type, shortcut }) => {
    log('updateShortcut');
    let shortcuts = store.get('settings.shortcuts');
    let newShortcut = shortcuts.find(s => s.id === id);
    newShortcut[type] = shortcut;
    store.set('settings.shortcuts', shortcuts);

    createMenu(win, store);
    globalShortcut.unregisterAll();
    registerGlobalShortcut(win, store, audioWindow);
  });

  ipcMain.on('restoreDefaultShortcuts', () => {
    log('restoreDefaultShortcuts');
    store.set('settings.shortcuts', cloneDeep(shortcuts));

    createMenu(win, store);
    globalShortcut.unregisterAll();
    registerGlobalShortcut(win, store, audioWindow);
  });

  if (isCreateTray) {
    ipcMain.on('updateTrayTooltip', (_, title) => {
      trayEventEmitter.emit('updateTooltip', title);
    });
    ipcMain.on('updateTrayPlayState', (_, isPlaying) => {
      trayEventEmitter.emit('updatePlayState', isPlaying);
    });
    ipcMain.on('updateTrayLikeState', (_, isLiked) => {
      trayEventEmitter.emit('updateLikeState', isLiked);
    });
    ipcMain.on('updateTrayIcon', () => {
      trayEventEmitter.emit('updateIcon');
    });
  }
}
