const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('esbuild');
function fixture({
  unavailable = false,
  brokenShader = false,
  supportsFloat = true,
} = {}) {
  const calls = [],
    images = [],
    frames = new Map(),
    events = new Map();
  let next = 1,
    observer,
    failed = 0,
    ready = 0;
  const gl = new Proxy(
    { NO_ERROR: 0 },
    {
      get(target, name) {
        if (name in target) return target[name];
        if (/^[A-Z_0-9]+$/.test(name)) return (target[name] = next++);
        return (...args) => {
          calls.push([name, ...args]);
          if (name.startsWith('create')) return { id: next++ };
          if (name === 'getShaderParameter') return !brokenShader;
          if (name === 'getProgramParameter') return true;
          if (name === 'getError') return 0;
          if (name === 'getExtension') return supportsFloat ? {} : null;
          if (name === 'getUniformLocation') return args[1];
          if (name === 'getShaderInfoLog') return 'unavailable shader';
        };
      },
    }
  );
  const canvas = {
    clientWidth: 1440,
    clientHeight: 804,
    getContext: () => (unavailable ? null : gl),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
  };
  const module = { exports: {} };
  const code = transformSync(
    fs.readFileSync(
      path.join(__dirname, '../src/utils/fluidGpuRenderer.js'),
      'utf8'
    ),
    { format: 'cjs' }
  ).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Image: class {
      constructor() {
        images.push(this);
      }
    },
    ResizeObserver: class {
      constructor(fn) {
        this.resize = fn;
        observer = this;
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
    requestAnimationFrame(fn) {
      const id = next++;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  const renderer = module.exports.createFluidGpuRenderer(
    canvas,
    [{}, {}, {}, {}],
    {
      seed: 42,
      onReady: () => ready++,
      onFailure: () => failed++,
    }
  );
  return {
    renderer,
    gl,
    canvas,
    images,
    frames,
    events,
    calls,
    observer: () => observer,
    failed: () => failed,
    ready: () => ready,
    tick(time) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(fn => fn(time));
    },
    count(name) {
      return calls.filter(c => c[0] === name).length;
    },
  };
}

test('unavailable GPU or shader compilation falls back without scheduling work', () => {
  const unavailable = fixture({ unavailable: true });
  assert.equal(unavailable.renderer, null);
  assert.equal(unavailable.frames.size, 0);
  const broken = fixture({ brokenShader: true });
  assert.equal(broken.renderer, null);
  assert(broken.count('deleteShader') > 0);
  assert(broken.count('deleteProgram') > 0);
});

test('renders the four-pass effect; uploads cover textures only when colors change', () => {
  const f = fixture();
  assert.equal(f.canvas.width, 1440);
  assert.equal(f.canvas.height, 804);
  assert.equal(f.images.length, 1);
  f.images[0].onload();
  f.renderer.setRunning(true);
  f.tick(0);
  assert.equal(f.ready(), 1);
  assert.equal(f.count('drawArrays'), 4);
  const uploads = f.count('texImage2D'),
    uniforms = f.count('getUniformLocation');
  f.tick(16);
  assert.equal(f.count('texImage2D'), uploads);
  assert.equal(f.count('getUniformLocation'), uniforms);
  f.renderer.invalidate();
  f.tick(32);
  assert.equal(f.count('texImage2D'), uploads + 4);
  assert.equal(f.ready(), 1);
});

test('pausing settles one frame and then schedules no idle rendering', () => {
  const f = fixture();
  f.images[0].onload();
  f.renderer.setRunning(true);
  f.tick(0);
  assert.equal(f.frames.size, 1);
  f.renderer.setRunning(false);
  f.tick(16);
  assert.equal(f.frames.size, 0);
  f.renderer.invalidate();
  f.tick(32);
  assert.equal(f.frames.size, 0);
});

test('resize rebakes noise once; obsolete resize responses cannot replace the latest texture', () => {
  const f = fixture();
  f.canvas.clientWidth = 1920;
  f.observer().resize();
  assert.equal(f.images.length, 2);
  assert.equal(f.canvas.width, 1920);
  const before = f.count('texImage2D');
  f.images[0].onload();
  assert.equal(f.count('texImage2D'), before);
  f.images[1].onload();
  assert.equal(f.count('texImage2D'), before + 1);
});

test('context loss cancels frames, frees resources and selects fallback once', () => {
  const f = fixture();
  f.images[0].onload();
  f.renderer.setRunning(true);
  f.tick(0);
  let prevented = false;
  f.events.get('webglcontextlost')({
    preventDefault() {
      prevented = true;
    },
  });
  assert(prevented);
  assert.equal(f.failed(), 1);
  assert.equal(f.frames.size, 0);
  assert.equal(f.events.size, 0);
  assert(f.observer().disconnected);
  assert(f.count('deleteTexture') > 0);
  const deletes = f.count('deleteTexture');
  f.renderer.dispose();
  assert.equal(f.count('deleteTexture'), deletes);
});

test('keeps intermediate colors in half float when available and dithers at screen resolution', () => {
  const f = fixture();
  const allocation = f.calls.find(
    call => call[0] === 'texImage2D' && call.length === 10
  );
  assert.equal(allocation[3], f.gl.RGBA16F);
  assert.equal(allocation[4], 360);
  assert.equal(allocation[5], 201);
  assert.equal(allocation[8], f.gl.HALF_FLOAT);
  f.images[0].onload();
  f.tick(0);
  assert.deepEqual(
    f.calls
      .filter(c => c[0] === 'viewport')
      .at(-1)
      .slice(1),
    [0, 0, 1440, 804]
  );
  const fallback = fixture({ supportsFloat: false });
  assert.equal(fallback.renderer, null);
  assert.equal(fallback.frames.size, 0);
});
