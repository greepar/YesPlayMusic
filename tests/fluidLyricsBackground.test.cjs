const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { parse } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');

function fixture() {
  const images = [],
    buffers = [],
    frames = new Map();
  let now = 0,
    nextFrame = 1;
  function canvas() {
    const surface = { color: 0, draws: [], width: 100, height: 100 };
    const context = {
      globalAlpha: 1,
      clearRect() {
        surface.color = 0;
      },
      drawImage(source, ...args) {
        surface.draws.push([source, ...args]);
        surface.color =
          surface.color * (1 - this.globalAlpha) +
          source.color * this.globalAlpha;
      },
    };
    surface.getContext = () => context;
    return surface;
  }
  const runtime = {
    document: {
      visibilityState: 'visible',
      createElement() {
        const c = canvas();
        buffers.push(c);
        return c;
      },
    },
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame(fn) {
      const id = nextFrame++;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    performance: { now: () => now },
    Image: class {
      constructor() {
        this.naturalWidth = 1000;
        this.naturalHeight = 800;
        this.color = 100;
        images.push(this);
      }
    },
    Math,
  };
  function load(file, imports = {}) {
    let source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    if (file.endsWith('.vue')) source = parse(source).descriptor.script.content;
    const module = { exports: {} };
    vm.runInNewContext(transformSync(source, { format: 'cjs' }).code, {
      ...runtime,
      module,
      exports: module.exports,
      require: name => imports[name],
    });
    return module.exports;
  }
  const helper = load('src/utils/fluidCoverTransition.js');
  const component = load('src/components/FluidLyricsBackground.vue', {
    '@/utils/fluidCoverTransition': helper,
  }).default;
  const ctx = {
    ...component.data(),
    imageUrl: 'cover-a',
    active: true,
    playing: true,
  };
  for (const [name, fn] of Object.entries(component.methods))
    ctx[name] = fn.bind(ctx);
  component.created.call(ctx);
  for (let i = 0; i < 4; i++) ctx.setCanvas(canvas(), i);
  ctx.coverTransition = helper.createFluidCoverTransition(ctx.canvases, 1200);
  return {
    ctx,
    component,
    images,
    buffers,
    frames,
    tick(time) {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(fn => fn(time));
    },
  };
}

test('draws four cover quadrants into 100px buffers', () => {
  const { ctx, images, buffers } = fixture();
  ctx.loadCover();
  images[0].onload();
  assert.equal(ctx.ready, true);
  assert.equal(ctx.loadedUrl, 'cover-a');
  const quadrants = buffers
    .flatMap(c => c.draws)
    .filter(args => args[0] === images[0]);
  assert.equal(quadrants.length, 4);
  for (let q = 0; q < 4; q++) {
    assert.deepEqual(quadrants[q].slice(1), [
      (q % 2) * 500,
      Math.floor(q / 2) * 400,
      500,
      400,
      0,
      0,
      100,
      100,
    ]);
  }
});

test('cover transition blends without a brightness dip and settles exactly', () => {
  const { ctx, images, tick, frames } = fixture();
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'cover-b';
  ctx.loadCover();
  images[1].color = 200;
  images[1].onload();
  assert.equal(ctx.canvases[0].color, 100);
  tick(600);
  assert.equal(ctx.canvases[0].color, 150);
  tick(1200);
  assert.equal(ctx.canvases[0].color, 200);
  assert.equal(frames.size, 0);
});

test('rapid next song starts from the current mixed colors, not a reused old buffer', () => {
  const { ctx, images, tick, frames } = fixture();
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'cover-b';
  ctx.loadCover();
  images[1].color = 200;
  images[1].onload();
  tick(600);
  assert.equal(ctx.canvases[0].color, 150);
  ctx.imageUrl = 'cover-c';
  ctx.loadCover();
  images[2].color = 20;
  images[2].onload();
  assert.equal(ctx.canvases[0].color, 150);
  assert.equal(frames.size, 1);
  tick(1200);
  assert.equal(ctx.canvases[0].color, 85);
  tick(1800);
  assert.equal(ctx.canvases[0].color, 20);
});

test('equal brightness cover colors stay equally bright throughout the fade', () => {
  const { ctx, images, tick } = fixture();
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'same-brightness';
  ctx.loadCover();
  images[1].onload();
  for (const time of [100, 300, 600, 900, 1200]) {
    tick(time);
    assert.equal(ctx.canvases[0].color, 100);
  }
});

test('obsolete responses cannot overwrite the latest song', () => {
  const { ctx, images } = fixture();
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'slow';
  ctx.loadCover();
  const obsolete = images[1].onload;
  ctx.imageUrl = 'latest';
  ctx.loadCover();
  images[2].onload();
  obsolete();
  assert.equal(ctx.loadedUrl, 'latest');
  assert.equal(images[1].src, '');
});

test('hidden pages stop fade work and do not fetch; reopening catches up', () => {
  const { ctx, component, images, tick, frames } = fixture();
  ctx.active = false;
  ctx.loadCover();
  assert.equal(images.length, 0);
  ctx.active = true;
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'next';
  ctx.loadCover();
  images[1].color = 200;
  images[1].onload();
  tick(200);
  assert.equal(frames.size, 1);
  ctx.active = false;
  component.watch.active.call(ctx);
  assert.equal(frames.size, 0);
  assert.equal(ctx.canvases[0].color, 200);
  ctx.imageUrl = 'hidden';
  ctx.loadCover();
  assert.equal(images.length, 2);
  ctx.active = true;
  ctx.loadCover();
  images[2].onload();
  assert.equal(ctx.loadedUrl, 'hidden');
});

test('paused, hidden and reduced-motion states stop fluid motion', () => {
  const { ctx, component } = fixture();
  const running = () => component.computed.running.call(ctx);
  assert.equal(running(), true);
  for (const [key, value] of [
    ['playing', false],
    ['active', false],
    ['pageVisible', false],
    ['reducedMotion', true],
  ]) {
    const previous = ctx[key];
    ctx[key] = value;
    assert.equal(running(), false);
    ctx[key] = previous;
  }
});

test('failed or temporarily missing covers retain colors; reduced motion cancels frames', () => {
  const { ctx, images, frames } = fixture();
  ctx.loadCover();
  images[0].onload();
  ctx.imageUrl = 'broken';
  ctx.loadCover();
  images[1].onerror();
  assert.equal(ctx.loadedUrl, 'cover-a');
  assert.equal(ctx.ready, true);
  ctx.imageUrl = 'new';
  ctx.loadCover();
  images[2].onload();
  assert.equal(frames.size, 1);
  ctx.handleMotionChange({ matches: true });
  assert.equal(frames.size, 0);
  ctx.imageUrl = '';
  ctx.loadCover();
  assert.equal(ctx.ready, true);
  assert.equal(ctx.loadedUrl, 'new');
  assert.equal(frames.size, 0);
});
