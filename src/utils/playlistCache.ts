/**
 * 歌单详情的内存缓存，用于「先展示旧数据、后台再刷新」：
 * 点进歌单页时立刻用缓存渲染，避免等待接口期间整页空白。
 *
 * 只保留最近使用的少量歌单，并限制每个歌单缓存的歌曲数量，避免占用过多内存。
 */

export interface TrackId {
  id: number;
}

export interface PlaylistDetail {
  id: number | string;
  trackIds?: TrackId[];
  trackCount?: number;
  [key: string]: unknown;
}

export interface CachedPlaylist<T = unknown> {
  playlist: PlaylistDetail;
  tracks: T[];
}

export const MAX_CACHED_PLAYLISTS = 5;
export const MAX_CACHED_TRACKS = 200;

const cache = new Map<string, CachedPlaylist>();

function toKey(id: number | string): string {
  return String(id);
}

/** 两个歌单的歌曲 id 列表（顺序和内容）是否完全一致 */
export function sameTrackIds(
  a: PlaylistDetail | undefined,
  b: PlaylistDetail | undefined
): boolean {
  const left = a?.trackIds;
  const right = b?.trackIds;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((track, index) => track.id === right[index].id);
}

/** 读取缓存。返回的是副本，调用方可以放心修改 */
export function getCachedPlaylist<T = unknown>(
  id: number | string
): CachedPlaylist<T> | undefined {
  const key = toKey(id);
  const hit = cache.get(key);
  if (!hit) return undefined;
  // 命中后移到末尾（最近使用）
  cache.delete(key);
  cache.set(key, hit);
  return { playlist: { ...hit.playlist }, tracks: hit.tracks.slice() as T[] };
}

/**
 * 写入缓存。歌曲列表没有变化时，保留之前已经加载得更多的歌曲，
 * 避免一次只带前几首的刷新结果把它覆盖掉。
 */
export function cachePlaylist(
  id: number | string,
  playlist: PlaylistDetail,
  tracks: unknown[] = []
): void {
  const key = toKey(id);
  const previous = cache.get(key);
  const keepPrevious =
    previous !== undefined &&
    sameTrackIds(previous.playlist, playlist) &&
    previous.tracks.length > tracks.length;

  cache.delete(key);
  cache.set(key, {
    playlist: { ...playlist },
    tracks: (keepPrevious ? previous.tracks : tracks).slice(
      0,
      MAX_CACHED_TRACKS
    ),
  });

  while (cache.size > MAX_CACHED_PLAYLISTS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 歌单页继续加载更多歌曲后，同步更新缓存里的歌曲列表 */
export function cacheLoadedTracks(
  id: number | string,
  tracks: unknown[]
): void {
  const entry = cache.get(toKey(id));
  if (!entry) return;
  entry.tracks = tracks.slice(0, MAX_CACHED_TRACKS);
}
