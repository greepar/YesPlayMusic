const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(backend = 'wayland') {
  const hosts = [];
  class BaseWindow extends EventEmitter {
    constructor(options) {
      super();
      this.bounds = { width: options.width, height: options.height };
      this.contentView = {
        addChildView() {},
        removeChildView() {},
      };
      hosts.push(this);
    }
    getBounds() { return this.bounds; }
    getContentBounds() { return this.bounds; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return false; }
    setMenuBarVisibility() {}
    show() { this.emit('show'); }
    hide() { this.emit('hide'); }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  class WebContentsView {
    constructor() {
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        closes: 0,
        isDestroyed() { return this.closes > 0; },
        close() { this.closes += 1; },
        focusRequests: 0,
        focus() { this.focusRequests += 1; },
        loadURL(url) { this.url = url; },
      });
    }
    setBackgroundColor() {}
    setBounds(bounds) { this.bounds = bounds; }
  }
  class BrowserWindow {}
  const electron = {
    app: { commandLine: { getSwitchValue: () => backend } },
    BaseWindow,
    BrowserWindow,
    WebContentsView,
  };
  const context = {
    module: { exports: {} },
    process: { platform: 'linux' },
    require: name => name === 'electron' ? electron : require(name),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/electron/waylandWindow.js'), 'utf8'),
    context
  );
  return { ...context.module.exports, hosts, BrowserWindow };
}

test('only native Wayland uses the persistent web view', () => {
  const f = fixture('x11');
  assert.ok(f.createMainWindow({}) instanceof f.BrowserWindow);
});

test('tray hide/show retains the renderer and forwards close cancellation', () => {
  const f = fixture();
  const win = f.createMainWindow({ width: 800, height: 600 });
  const renderer = win.webContents;
  win.loadURL('http://localhost:27232/#/library');
  let ready = 0;
  win.once('ready-to-show', () => ready++);
  renderer.emit('did-finish-load');
  win.show();
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  win.on('close', e => e.preventDefault());
  f.hosts[0].emit('close', event);
  assert.equal(event.prevented, true);
  for (let i = 0; i < 3; i++) {
    const oldHost = f.hosts.at(-1);
    win.hide();
    win.show();
    assert.equal(oldHost.isDestroyed(), true);
    assert.equal(win.webContents, renderer);
    assert.equal(renderer.closes, 0);
    assert.equal(renderer.url, 'http://localhost:27232/#/library');
    assert.equal(win.getBounds().width, 800);
    assert.equal(renderer.listenerCount('did-finish-load'), 0);
  }
  assert.equal(ready, 1);
  win.destroy();
  assert.equal(renderer.closes, 1);
});

test('restores a compositor-minimized host even if Electron reports not minimized', () => {
  const f = fixture();
  const win = f.createMainWindow({ width: 800, height: 600 });
  win.show();
  const oldHost = f.hosts[0];
  // Wayland can minimize outside Electron without emitting a minimize event.
  assert.equal(win.isMinimized(), false);
  win.show();
  assert.equal(oldHost.isDestroyed(), true);
  assert.equal(f.hosts.length, 2);
  assert.equal(win.webContents.closes, 0);
});

test('native focus changes do not request activation while minimizing', () => {
  const f = fixture();
  const win = f.createMainWindow({ width: 800, height: 600 });
  win.show();
  let focusEvents = 0;
  let minimizeEvents = 0;
  win.on('focus', () => focusEvents++);
  win.on('minimize', () => minimizeEvents++);
  const host = f.hosts[0];
  host.emit('focus');
  host.emit('blur');
  host.emit('minimize');
  assert.equal(focusEvents, 1);
  assert.equal(minimizeEvents, 1);
  assert.equal(win.webContents.focusRequests, 0);
  assert.equal(f.hosts.length, 1);
});
