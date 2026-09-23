import { reactive, readonly } from 'vue';
import store from '@/store';
import locale from '@/locale';
import { getTrackDownloadURL } from '@/api/track';
import { isElectron, getIpcRenderer } from '@/utils/platform';

const STORAGE_KEY = 'yesplaymusic_download_history';

function loadSavedDownloads() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveDownloadsToStorage(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
}

const state = reactive({
  // 正在下载的任务映射，key 为 track.id
  downloadingMap: {},
  // 已完成的下载记录列表，元素格式为统一的 track 结构
  downloadedList: loadSavedDownloads(),
});

// Reload records when opening the tab (another renderer may have changed them).
// Preserve tasks that are completing while the refresh runs.
export function refreshDownloadHistory() {
  const saved = loadSavedDownloads();
  if (!Array.isArray(saved)) return;
  const activeIds = new Set(Object.keys(state.downloadingMap).map(Number));
  const active = state.downloadedList.filter(t => activeIds.has(Number(t.id)));
  const current = new Map(state.downloadedList.map(t => [Number(t.id), t]));
  state.downloadedList = [
    ...active,
    ...saved.filter(t => !activeIds.has(Number(t.id))).map(t => {
      const latest = current.get(Number(t.id));
      return latest && latest.downloadTime > t.downloadTime ? latest : t;
    }),
  ];
}

// 如果在 Electron 环境中，挂载下载进度监听
const initialIpc = getIpcRenderer();
if (initialIpc) {
  try {
    initialIpc.on('download-progress', (event, data) => {
      const task = state.downloadingMap[data.id];
      if (task) {
        task.progress = data.progress || 0;
        task.downloadedBytes = data.downloadedBytes || 0;
        task.totalBytes = data.totalBytes || 0;
      }
    });
  } catch (_) {}
}

/**
 * 检查歌曲是否已在下载队列或已下载
 * @param {number|string} trackId
 */
export function isTrackDownloadedOrDownloading(trackId) {
  const idNum = Number(trackId);
  if (state.downloadingMap[idNum]) return 'downloading';
  const found = state.downloadedList.find(t => Number(t.id) === idNum);
  if (found) return 'downloaded';
  return false;
}

/**
 * 获取已下载的完整歌曲对象
 * @param {number|string} trackId
 */
export function getDownloadedTrack(trackId) {
  const idNum = Number(trackId);
  return state.downloadedList.find(t => Number(t.id) === idNum) || null;
}

/**
 * 获取歌曲对应的本地文件路径
 * @param {number|string} trackId
 */
export function getLocalTrackPath(trackId) {
  const idNum = Number(trackId);
  const found = state.downloadedList.find(t => Number(t.id) === idNum);
  return found?.localFilePath || null;
}

export async function getExistingLocalTrackPath(trackId) {
  const filePath = getLocalTrackPath(trackId);
  if (!isElectron || !filePath) return null;
  const ipc = getIpcRenderer();
  if (!ipc) return null;
  try {
    return (await ipc.invoke('local-file-exists', filePath)) ? filePath : null;
  } catch (_) {
    return null;
  }
}

/**
 * 发起下载
 * @param {Object} track
 * @param {string|number} [quality]
 * @param {boolean} [force] 是否跳过“已下载”防重检查（用于手动重新下载）
 */
export async function downloadTrack(track, quality, force = false) {
  if (!track || !track.id) return;

  const trackId = Number(track.id);
  const trackName = track.name || 'Unknown Track';

  // 1. 防重复下载检查
  if (state.downloadingMap[trackId]) {
    store.dispatch('showToast', locale.t('toast.downloading'));
    return;
  }
  if (!force) {
    if (isTrackDownloadedOrDownloading(trackId) === 'downloaded') {
      // A file may have been moved or removed since its path was saved.
      if (!isElectron || await getExistingLocalTrackPath(trackId)) {
        store.dispatch('showToast', locale.t('toast.alreadyDownloaded'));
        return;
      }
      if (state.downloadingMap[trackId]) return;
    }
  }

  const targetQuality =
    quality || store.state.settings?.downloadQuality || 320000;

  // 2. 插入正在下载任务队列（响应式显示在最顶端）
  const task = {
    id: trackId,
    track,
    name: trackName,
    artist: (track.ar || track.artists || []).map(a => a.name).join(', '),
    coverUrl: track.al?.picUrl || track.album?.picUrl || '',
    quality: targetQuality,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    startTime: Date.now(),
  };
  state.downloadingMap[trackId] = task;

  store.dispatch(
    'showToast',
    locale.t('toast.downloadStarted', { name: trackName })
  );

  try {
    // 获取下载真实直链
    const res = await getTrackDownloadURL(trackId, targetQuality);
    if (!res || !res.url) {
      delete state.downloadingMap[trackId];
      store.dispatch(
        'showToast',
        locale.t('toast.downloadFailed', {
          name: `${trackName} (无法获取下载地址)`,
        })
      );
      return;
    }

    const artistList = track.ar || track.artists || [];
    const artists = artistList
      .map(a => a.name)
      .filter(Boolean)
      .join(', ');
    const rawType = (res.type || 'mp3').replace(/[^a-zA-Z0-9]/g, '');
    const ext = rawType || 'mp3';
    const filename = artists
      ? `${artists} - ${trackName}.${ext}`
      : `${trackName}.${ext}`;

    const ipcRenderer = getIpcRenderer();
    if (isElectron && ipcRenderer) {
      const targetDir = store.state.settings?.downloadPath || '';
      const metadata = {
        title: trackName,
        artist: artists,
        album: track.al?.name || track.album?.name || '',
        coverUrl: task.coverUrl,
        year: track.publishTime
          ? new Date(track.publishTime).getFullYear()
          : undefined,
      };
      const result = await ipcRenderer.invoke('download-track', {
        id: trackId,
        url: res.url,
        filename,
        targetDir,
        metadata,
      });

      if (result && result.ok) {
        task.progress = 100;
        task.status = 'completed';

        // 构建标准歌曲对象并缓存到已完成列表
        const downloadedItem = {
          ...track,
          id: trackId,
          name: trackName,
          ar: track.ar || track.artists || [{ name: artists }],
          al: track.al ||
            track.album || { name: '', picUrl: task.coverUrl },
          dt: track.dt || track.duration || 0,
          localFilePath: result.filePath,
          localFilename: result.filename,
          localFileSize: result.size || 0,
          downloadQuality: targetQuality,
          downloadTime: Date.now(),
        };

        // 移除同 id 旧项后加到最顶端
        state.downloadedList = [
          downloadedItem,
          ...state.downloadedList.filter(t => Number(t.id) !== trackId),
        ];
        saveDownloadsToStorage(state.downloadedList);

        store.dispatch(
          'showToast',
          locale.t('toast.downloadCompleted', { name: result.filename })
        );

        // 延迟移除下载任务，给用户充足且平滑的完成态反馈
        setTimeout(() => {
          delete state.downloadingMap[trackId];
        }, 700);
      } else {
        delete state.downloadingMap[trackId];
        store.dispatch(
          'showToast',
          locale.t('toast.downloadFailed', {
            name: `${trackName} (${result?.error || '下载失败'})`,
          })
        );
      }
    } else {
      // Let the browser handle cross-origin URLs and the save dialog directly.
      // A browser cannot confirm that the user actually saved the file.
      delete state.downloadingMap[trackId];
      const a = document.createElement('a');
      a.href = res.url;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    delete state.downloadingMap[trackId];
    store.dispatch(
      'showToast',
      locale.t('toast.downloadFailed', {
        name: `${trackName} (${err.message || '未知错误'})`,
      })
    );
  }
}

/**
 * 从本地磁盘和历史列表中删除
 * @param {Object} item
 */
export async function removeDownloadedTrack(item) {
  if (!item || !item.id) return false;
  const idNum = Number(item.id);

  const ipc = getIpcRenderer();
  if (isElectron && ipc && item.localFilePath) {
    try {
      if (!(await ipc.invoke('delete-local-file', item.localFilePath))) return false;
    } catch (_) {
      return false;
    }
  }

  state.downloadedList = state.downloadedList.filter(
    t => Number(t.id) !== idNum
  );
  saveDownloadsToStorage(state.downloadedList);
  return true;
}

/**
 * 清空下载历史
 */
export function clearAllDownloadHistory() {
  state.downloadedList = [];
  saveDownloadsToStorage([]);
}

/**
 * 导出响应式下载管理器状态
 */
export const downloadState = readonly(state);
