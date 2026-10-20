const { app, BaseWindow, BrowserWindow, WebContentsView } = require('electron');
const { EventEmitter } = require('events');

// A hidden Wayland surface can fail to map again in Chromium. Keep the web
// view alive and replace only its native host when the user brings it back.
class WaylandWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.hasBeenShown = false;
    this.replacing = false;
    this.menuBarVisible = false;
    this.view = new WebContentsView({ webPreferences: options.webPreferences });
    this.webContents = this.view.webContents;
    this.view.setBackgroundColor(options.backgroundColor || '#fff');
    this.attachHost(options);
    this.webContents.once('did-finish-load', () => this.emit('ready-to-show'));

    // Keep the existing window API used by menus, IPC, and window persistence.
    // Electron's built-in window classes cannot themselves be subclassed.
    return new Proxy(this, {
      get(target, key, receiver) {
        if (key in target) return Reflect.get(target, key, receiver);
        const value = target.host[key];
        return typeof value === 'function' ? value.bind(target.host) : value;
      },
    });
  }

  attachHost(options) {
    const host = new BaseWindow({ ...options, show: false });
    this.host = host;
    host.contentView.addChildView(this.view);
    host.setMenuBarVisibility(this.menuBarVisible);
    if (this.progressBar) host.setProgressBar(...this.progressBar);
    const resizeView = () => {
      const { width, height } = host.getContentBounds();
      if (width > 0 && height > 0)
        this.view.setBounds({ x: 0, y: 0, width, height });
    };
    resizeView();
    host.on('resize', resizeView);
    // Let the compositor manage activation. Focusing WebContents here can
    // request activation again while GNOME is minimizing the native window.
    for (const event of [
      'close',
      'show',
      'hide',
      'minimize',
      'restore',
      'focus',
      'blur',
      'resize',
      'resized',
      'move',
      'moved',
      'maximize',
      'unmaximize',
      'enter-full-screen',
      'leave-full-screen',
    ]) {
      host.on(event, (...args) => {
        if (this.replacing) return;
        this.emit(event, ...args);
      });
    }
    host.on('closed', () => {
      if (this.replacing) return;
      // BaseWindow does not own the lifetime of its WebContentsView.
      if (!this.webContents.isDestroyed()) this.webContents.close();
      this.emit('closed');
    });
  }

  remap() {
    const oldHost = this.host;
    const bounds = oldHost.getBounds();
    const maximized = oldHost.isMaximized();
    const fullscreen = oldHost.isFullScreen();
    this.replacing = true;
    try {
      oldHost.contentView.removeChildView(this.view);
      oldHost.destroy();
      this.attachHost({
        ...this.options,
        ...(bounds.width > 0 && bounds.height > 0
          ? { width: bounds.width, height: bounds.height }
          : {}),
      });
      if (fullscreen) this.host.setFullScreen(true);
      else if (maximized) this.host.maximize();
    } finally {
      this.replacing = false;
    }
  }

  loadURL(...args) {
    return this.webContents.loadURL(...args);
  }

  setMenuBarVisibility(visible) {
    this.menuBarVisible = visible;
    this.host.setMenuBarVisibility(visible);
  }

  setProgressBar(progress, options) {
    this.progressBar = [progress, options];
    this.host.setProgressBar(progress, options);
  }

  show() {
    // Wayland also does not reliably report compositor-side minimization.
    // Do not use isVisible()/isMinimized() to decide whether a remap is needed.
    if (this.hasBeenShown) this.remap();
    this.hasBeenShown = true;
    this.host.show();
  }

  restore() {
    this.show();
  }
}

function createMainWindow(options) {
  const backend = app.commandLine.getSwitchValue('ozone-platform');
  return process.platform === 'linux' && backend === 'wayland'
    ? new WaylandWindow(options)
    : new BrowserWindow(options);
}

module.exports = { createMainWindow };
