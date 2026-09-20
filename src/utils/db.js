import axios from 'axios';
import Dexie from 'dexie';
import { warmCoverHttpCache } from '@/utils/imagePerformance';
// import pkg from "../../package.json";

const db = new Dexie('yesplaymusic');

function getSourceSize(source) {
  return source?.size ?? source?.byteLength ?? 0;
}

db.version(5)
  .stores({
    trackSources: '&id, createTime',
    trackSourceMetadata: '&id, createTime, size',
  })
  .upgrade(async tx => {
    const metadata = tx.table('trackSourceMetadata');
    await tx.table('trackSources').each(track =>
      metadata.put({
        id: track.id,
        createTime: track.createTime || new Date().getTime(),
        size: getSourceSize(track.source),
        name: track.name,
        artist: track.artist,
      })
    );
  });

db.version(4).stores({
  trackDetail: '&id, updateTime',
  lyric: '&id, updateTime',
  album: '&id, updateTime',
});

db.version(3)
  .stores({
    trackSources: '&id, createTime',
  })
  .upgrade(tx =>
    tx
      .table('trackSources')
      .toCollection()
      .modify(
        track => !track.createTime && (track.createTime = new Date().getTime())
      )
  );

db.version(1).stores({
  trackSources: '&id',
});

let tracksCacheBytes = 0;

function getCacheLimit() {
  try {
    return JSON.parse(localStorage.getItem('settings') || '{}').cacheLimit;
  } catch {
    return false;
  }
}

// 初始化现有缓存总大小，确保应用启动时能正确判断并清理超限缓存
async function initTracksCacheBytes() {
  if (!process.env.IS_ELECTRON) return;
  try {
    const sizes = await db.trackSourceMetadata.orderBy('size').keys();
    tracksCacheBytes = sizes.reduce((total, size) => total + size, 0);
    console.debug(
      '[debug][db.js] initTracksCacheBytes, total bytes:',
      tracksCacheBytes
    );
    await deleteExcessCache();
  } catch (err) {
    console.debug('[debug][db.js] initTracksCacheBytes failed', err);
  }
}

// 模块加载时触发初始化
const isAudioHost = new URLSearchParams(window.location.search).has(
  'audioHost'
);
const tracksCacheReady = isAudioHost
  ? initTracksCacheBytes()
  : Promise.resolve();

async function deleteExcessCache() {
  const cacheLimit = getCacheLimit();
  if (cacheLimit === false || cacheLimit === undefined) return;
  const limitBytes = cacheLimit * Math.pow(1024, 2);
  try {
    while (tracksCacheBytes >= limitBytes) {
      const delCache = await db.trackSourceMetadata
        .orderBy('createTime')
        .first();
      if (!delCache) break;
      await db.transaction(
        'rw',
        db.trackSources,
        db.trackSourceMetadata,
        async () => {
          await db.trackSources.delete(delCache.id);
          await db.trackSourceMetadata.delete(delCache.id);
        }
      );
      tracksCacheBytes -= delCache.size;
      console.debug(
        `[debug][db.js] deleteExcessCacheSuccess, track: ${delCache.name}, size: ${delCache.size}, cacheSize:${tracksCacheBytes}`
      );
    }
  } catch (error) {
    console.debug('[debug][db.js] deleteExcessCacheFailed', error);
  }
}

export function cacheTrackSource(trackInfo, url, bitRate, from = 'netease') {
  if (!process.env.IS_ELECTRON) return;
  const name = trackInfo.name;
  const artist =
    (trackInfo.ar && trackInfo.ar[0]?.name) ||
    (trackInfo.artists && trackInfo.artists[0]?.name) ||
    'Unknown';
  // One small HTTP-cache warmup replaces three Axios downloads. It avoids
  // retaining multiple encoded responses or decoded cover bitmaps.
  warmCoverHttpCache(trackInfo.al.picUrl);
  return axios
    .get(url, {
      // Keep encoded audio outside the renderer's JS heap. Chromium can persist
      // a Blob to IndexedDB without first creating a large ArrayBuffer.
      responseType: 'blob',
    })
    .then(async response => {
      await tracksCacheReady;
      const id = Number(trackInfo.id);
      const createTime = new Date().getTime();
      const size = getSourceSize(response.data);
      let previousSize = 0;
      await db.transaction(
        'rw',
        db.trackSources,
        db.trackSourceMetadata,
        async () => {
          const previous = await db.trackSourceMetadata.get(id);
          previousSize = previous?.size || 0;
          await db.trackSources.put({
            id,
            source: response.data,
            bitRate,
            from,
            name,
            artist,
            createTime,
          });
          await db.trackSourceMetadata.put({
            id,
            createTime,
            size,
            name,
            artist,
          });
        }
      );
      console.debug(`[debug][db.js] cached track 👉 ${name} by ${artist}`);
      tracksCacheBytes += size - previousSize;
      await deleteExcessCache();
      return { trackID: trackInfo.id, source: response.data, bitRate };
    });
}

export function getTrackSource(id) {
  return db.trackSources.get(Number(id)).then(track => {
    if (!track) return null;
    console.debug(
      `[debug][db.js] get track from cache 👉 ${track.name} by ${track.artist}`
    );
    return track;
  });
}

export function cacheTrackDetail(track, privileges) {
  db.trackDetail.put({
    id: track.id,
    detail: track,
    privileges: privileges,
    updateTime: new Date().getTime(),
  });
}

export function getTrackDetailFromCache(ids) {
  return db.trackDetail
    .filter(track => {
      return ids.includes(String(track.id));
    })
    .toArray()
    .then(tracks => {
      const result = { songs: [], privileges: [] };
      ids.map(id => {
        const one = tracks.find(t => String(t.id) === id);
        result.songs.push(one?.detail);
        result.privileges.push(one?.privileges);
      });
      if (result.songs.includes(undefined)) {
        return undefined;
      }
      return result;
    });
}

export function cacheLyric(id, lyrics) {
  db.lyric.put({
    id,
    lyrics,
    updateTime: new Date().getTime(),
  });
}

export function getLyricFromCache(id) {
  return db.lyric.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.lyrics;
  });
}

export function cacheAlbum(id, album) {
  db.album.put({
    id: Number(id),
    album,
    updateTime: new Date().getTime(),
  });
}

export function getAlbumFromCache(id) {
  return db.album.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.album;
  });
}

export async function countDBSize() {
  await tracksCacheReady;
  return Promise.all([
    db.trackSourceMetadata.orderBy('size').keys(),
    db.trackSourceMetadata.count(),
  ]).then(([trackSizes, length]) => {
    const res = {
      bytes: trackSizes.reduce((s1, s2) => s1 + s2, 0),
      length,
    };
    tracksCacheBytes = res.bytes;
    console.debug(`[debug][db.js] load tracksCacheBytes: ${tracksCacheBytes}`);
    return res;
  });
}

export function clearDB() {
  return db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()));
    tracksCacheBytes = 0;
  });
}
