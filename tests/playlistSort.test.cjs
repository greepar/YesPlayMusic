const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { parse } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
function loadScript(file, imports = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const script = file.endsWith('.vue')
    ? parse(source).descriptor.script.content
    : source;
  const code = transformSync(script, { format: 'cjs' }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: name => imports[name] || {},
    Intl,
    Map,
    Promise,
    console,
  });
  return module.exports;
}
const { sortPlaylistTracks } = loadScript('src/utils/playlistSort.js');
const ids = tracks => Array.from(tracks, track => track.id);
const songs = [
  { id: 1, name: 'Track 10', al: { name: 'B' }, dt: 2000 },
  { id: 2, name: 'track 2', al: { name: 'A' }, dt: 1000 },
  { id: 3, name: 'TRACK 2', al: { name: 'A' }, dt: 1000 },
];

test('natural title order, stable ties in both directions, and unchanged source', () => {
  assert.deepEqual(ids(sortPlaylistTracks(songs, 'title', 'asc')), [2, 3, 1]);
  assert.deepEqual(ids(sortPlaylistTracks(songs, 'title', 'desc')), [1, 2, 3]);
  assert.deepEqual(ids(songs), [1, 2, 3]);
  assert.equal(sortPlaylistTracks(songs, '', 'asc'), songs);
});

test('album and duration comparisons handle alternate and missing fields', () => {
  const list = [
    ...songs,
    { id: 4, album: { name: 'C' }, duration: 3000 },
    { id: 5 },
  ];
  assert.deepEqual(
    ids(sortPlaylistTracks(list, 'album', 'asc')),
    [5, 2, 3, 1, 4]
  );
  assert.deepEqual(
    ids(sortPlaylistTracks(list, 'duration', 'desc')),
    [4, 1, 2, 3, 5]
  );
});

function playlistFixture({ total = 1205, fail = false } = {}) {
  const requests = [];
  const played = [];
  const toasts = [];
  const all = Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    name: `Track ${total - i}`,
    al: { name: `Album ${i % 3}` },
    ar: [{ name: 'Artist' }],
    dt: i * 1000,
  }));
  const component = loadScript('src/views/playlist.vue', {
    vue: { markRaw: x => x },
    vuex: {
      mapState: () => ({}),
      mapActions: () => ({}),
      mapMutations: () => ({}),
    },
    '@/utils/playlistSort': { sortPlaylistTracks },
    '@/utils/playlistCache': { cacheLoadedTracks() {} },
    '@/api/track': {
      async getTrackDetail(text) {
        requests.push(text);
        await Promise.resolve();
        if (fail) throw Error('network');
        // API response order need not match the requested order.
        return {
          songs: text
            .split(',')
            .map(Number)
            .reverse()
            .map(id => all[id - 1]),
        };
      },
    },
  }).default;
  const ctx = {
    ...component.data(),
    playlist: { id: 99, trackIds: all.map(({ id }) => ({ id })) },
    tracks: all.slice(0, 2),
    lastLoadedTrackIndex: 1,
    $i18n: { locale: 'en' },
    $t: x => x,
    showToast: text => toasts.push(text),
    $store: {
      state: { player: { replacePlaylist: (...args) => played.push(args) } },
    },
  };
  for (const [key, method] of Object.entries(component.methods))
    ctx[key] = method.bind(ctx);
  for (const key of ['sortedTracks', 'filteredTracks', 'playbackTrackIds']) {
    Object.defineProperty(ctx, key, {
      get: () => component.computed[key].call(ctx),
    });
  }
  return { ctx, requests, played, toasts, all };
}

test('sorting loads every page, deduplicates concurrent requests and preserves canonical order', async () => {
  const { ctx, requests, all } = playlistFixture();
  const initialPage = ctx.loadMore(100);
  await ctx.changeSort({ key: 'title', direction: 'asc' });
  await initialPage;
  assert.equal(ctx.tracks.length, all.length);
  assert.deepEqual(ids(ctx.tracks), ids(all));
  assert.equal(new Set(requests.flatMap(text => text.split(','))).size, 1203);
  assert.equal(requests.flatMap(text => text.split(',')).length, 1203);
  assert.equal(ctx.hasMore, false);
  assert.equal(ctx.sortLoading, false);
  assert.equal(ctx.sortedTracks[0].name, 'Track 1');
  assert.equal(ctx.sortLoadPromise, null);
  await ctx.changeSort({ key: '', direction: 'asc' });
  assert.deepEqual(ids(ctx.sortedTracks), ids(all));
});

test('search filters the sorted view; playing all uses the full sorted queue', async () => {
  const { ctx, played } = playlistFixture({ total: 15 });
  await ctx.changeSort({ key: 'title', direction: 'asc' });
  ctx.searchKeyWords = 'Track 1';
  assert.deepEqual(
    Array.from(ctx.filteredTracks, t => t.name),
    [
      'Track 1',
      'Track 10',
      'Track 11',
      'Track 12',
      'Track 13',
      'Track 14',
      'Track 15',
    ]
  );
  await ctx.playPlaylistByID();
  assert.deepEqual(Array.from(played[0][0]), ids(ctx.sortedTracks));
  assert.equal(played[0][0].length, 15);
  assert.deepEqual(played[0].slice(1), [99, 'playlist', 'first']);
});

test('failed loading restores default sorting and clears busy state for retry', async () => {
  const { ctx, toasts } = playlistFixture({ fail: true });
  await ctx.changeSort({ key: 'duration', direction: 'desc' });
  assert.equal(ctx.sortKey, '');
  assert.equal(ctx.sortLoading, false);
  assert.equal(ctx.loadingMore, false);
  assert.equal(ctx.sortLoadPromise, null);
  assert.equal(ctx.loadMorePromise, null);
  assert.equal(toasts.length, 1);
});

test('header cycles and double-click playback use the parent ordered queue', () => {
  const list = loadScript('src/components/TrackList.vue', {
    vuex: {
      mapState: () => ({}),
      mapActions: () => ({}),
      mapMutations: () => ({}),
    },
  }).default;
  const ctx = {
    sortKey: '',
    sortDirection: 'asc',
    $emit(_, state) {
      this.sortKey = state.key;
      this.sortDirection = state.direction;
    },
  };
  list.methods.toggleSort.call(ctx, 'title');
  assert.equal(ctx.sortDirection, 'asc');
  list.methods.toggleSort.call(ctx, 'title');
  assert.equal(ctx.sortDirection, 'desc');
  list.methods.toggleSort.call(ctx, 'title');
  assert.equal(ctx.sortKey, '');
  const played = [];
  list.methods.playThisListDefault.call(
    {
      type: 'playlist',
      id: 99,
      playlistTrackIds: [3, 1, 2],
      player: { replacePlaylist: (...args) => played.push(args) },
    },
    1
  );
  assert.deepEqual(played[0], [[3, 1, 2], 99, 'playlist', 1]);
});
