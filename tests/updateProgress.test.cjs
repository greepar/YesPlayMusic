const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateProgress } = require('../src/electron/updateProgress');
const {
  createDownloadedUpdateController,
} = require('../src/electron/downloadedUpdate');
const {
  createLinuxAppImageUpdater,
} = require('../src/electron/linuxAppImageUpdate');
const {
  createWindowsInstallerUpdater,
} = require('../src/electron/windowsUpdate');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: native progress follows download, restores on new window and clears on terminal states`, () => {
    const calls = [];
    let window = {
      isDestroyed: () => false,
      setProgressBar(value) {
        calls.push(value);
      },
      webContents: { isDestroyed: () => false, send() {} },
    };
    const progress = createUpdateProgress({
      platform,
      getWindow: () => window,
    });
    progress.report({ phase: 'downloading', percent: 42 });
    assert.equal(calls.at(-1), 0.42);
    progress.report({ phase: 'downloading', percent: 150 });
    assert.equal(calls.at(-1), 1);
    assert.equal(progress.getState().percent, 100);
    window = null;
    progress.report({ phase: 'downloading', percent: 65 });
    window = {
      isDestroyed: () => false,
      setProgressBar(value) {
        calls.push(value);
      },
    };
    progress.restore();
    assert.equal(calls.at(-1), 0.65);
    progress.report({ phase: 'installing' });
    assert.equal(calls.at(-1), platform === 'win32' ? 2 : 1);
    for (const phase of ['ready', 'idle', 'error']) {
      progress.report({ phase });
      assert.equal(calls.at(-1), -1);
      assert.equal(progress.isActive(), false);
    }
  });
}

for (const platform of ['linux', 'win32']) {
  test(`${platform}: actual updater wrapper forwards byte progress and clears when download completes`, async () => {
    const updater = new EventEmitter();
    const states = [];
    updater.checkForUpdates = async () =>
      updater.emit('update-available', { version: '1.0.1' });
    updater.downloadUpdate = async () => {
      updater.emit('download-progress', {
        percent: 25,
        transferred: 25,
        total: 100,
      });
      updater.emit('update-downloaded', { version: '1.0.1' });
    };
    const options = {
      updater,
      onProgress: state => states.push(state),
      log() {},
      dialog: {
        async showMessageBox() {
          return { response: 1 };
        },
      },
    };
    const controller =
      platform === 'linux'
        ? createLinuxAppImageUpdater({
            ...options,
            appImage: '/test/Music.AppImage',
            checkWritable: async () => {},
          })
        : createWindowsInstallerUpdater(options);
    await controller.check();
    await tick();
    assert.ok(states.some(s => s.phase === 'downloading' && s.percent === 25));
    assert.equal(states.at(-1).phase, 'ready');
  });
}

test('declining consent never starts progress; failures clear download progress and ignore late events', async () => {
  const updater = new EventEmitter();
  const states = [];
  let answer = 1;
  updater.checkForUpdates = async () =>
    updater.emit('update-available', { version: '1.0.1' });
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', { percent: 35 });
    throw new Error('connection lost');
  };
  const controller = createDownloadedUpdateController({
    updater,
    confirmBeforeDownload: true,
    onProgress: s => states.push(s),
    log() {},
    dialog: {
      async showMessageBox() {
        return { response: answer };
      },
    },
  });
  await controller.check();
  await tick();
  assert.equal(states.at(-1).phase, 'idle');
  assert.equal(
    states.some(s => s.phase === 'downloading'),
    false
  );
  answer = 0;
  await controller.check();
  await tick();
  assert.equal(states.at(-1).phase, 'error');
  updater.emit('download-progress', { percent: 90 });
  assert.equal(states.at(-1).phase, 'error');
});

test('unsupported native integration cannot break update state reporting', () => {
  let received;
  const progress = createUpdateProgress({
    getWindow: () => ({
      isDestroyed: () => false,
      setProgressBar() {
        throw new Error('unsupported');
      },
      webContents: {
        isDestroyed: () => false,
        send(_channel, state) {
          received = state;
        },
      },
    }),
  });
  assert.doesNotThrow(() =>
    progress.report({ phase: 'downloading', percent: 50 })
  );
  assert.equal(progress.getState().percent, 50);
  assert.equal(received.percent, 50);
});
