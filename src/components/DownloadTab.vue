<template>
  <div class="download-tab-container">
    <!-- 1. 正在下载任务列表（位于最顶端，展示动态进度条与百分比） -->
    <div v-if="downloadingList.length > 0" class="downloading-section">
      <div class="section-title">
        <span class="dot-pulse"></span>
        {{ $t('download.downloadingSection') }} ({{ downloadingList.length }})
      </div>
      <div class="downloading-list">
        <div
          v-for="task in downloadingList"
          :key="task.id"
          class="downloading-card"
        >
          <img
            v-if="task.coverUrl"
            :src="`${task.coverUrl}?param=128y128`"
            class="cover"
            loading="lazy"
          />
          <div class="main-info">
            <div class="title-row">
              <span class="track-name">{{ task.name }}</span>
              <span class="artist-name">{{ task.artist }}</span>
              <span class="quality-tag">{{ formatQuality(task.quality) }}</span>
            </div>
            <div class="progress-bar-container">
              <div
                class="progress-bar"
                :class="{ completed: task.status === 'completed' }"
                :style="{ width: `${task.progress || 0}%` }"
              ></div>
            </div>
            <div class="meta-row">
              <span class="bytes-info">
                {{
                  task.status === 'completed'
                    ? '下载完成，元数据标签已内嵌'
                    : `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`
                }}
              </span>
              <span class="percent-info">{{ task.progress || 0 }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. 工具栏：打开下载目录 / 全部播放 / 清空 -->
    <div class="toolbar">
      <div class="left">
        <button
          v-if="downloadedTracks.length > 0"
          class="play-all-btn"
          @click="playAll"
        >
          <svg-icon icon-class="play" />
          {{ $t('contextMenu.play') }} 全部 ({{ downloadedTracks.length }})
        </button>
      </div>
      <div class="right">
        <button
          class="secondary-btn"
          @click="openDownloadFolder"
        >
          {{ $t('download.openFolder') }}
        </button>
        <button
          v-if="downloadedTracks.length > 0"
          class="secondary-btn danger"
          @click="clearHistory"
        >
          {{ $t('download.clearHistory') }}
        </button>
      </div>
    </div>

    <!-- 3. 已完成下载歌曲列表（与云盘相同的单列大行列表模式） -->
    <div v-if="downloadedTracks.length > 0" class="completed-section">
      <TrackList
        :id="-9"
        :tracks="downloadedTracks"
        :column-number="1"
        type="downloads"
        dbclick-track-func="playDownloads"
      />
    </div>

    <!-- 4. 空状态提示 -->
    <div
      v-else-if="downloadingList.length === 0"
      class="empty-state"
    >
      <div class="empty-icon">
        <svg-icon icon-class="arrow-down" />
      </div>
      <div class="empty-text">{{ $t('download.noDownloads') }}</div>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import TrackList from '@/components/TrackList.vue';
import {
  downloadState,
  clearAllDownloadHistory,
  refreshDownloadHistory,
} from '@/utils/download';
import { isElectron, getIpcRenderer } from '@/utils/platform';

export default {
  name: 'DownloadTab',
  components: {
    TrackList,
  },
  data() {
    return { missingFiles: new Set(), refreshVersion: 0 };
  },
  mounted() {
    this.refreshDownloads();
  },
  activated() {
    this.refreshDownloads();
  },
  beforeUnmount() {
    this.refreshVersion++;
  },
  watch: {
    'downloadedTracks.length'() {
      // Newly completed tasks can arrive after the initial file scan.
      this.refreshDownloads();
    },
  },
  computed: {
    ...mapState(['settings']),
    isElectron() {
      return isElectron;
    },
    downloadingList() {
      return Object.values(downloadState.downloadingMap);
    },
    downloadedTracks() {
      return (downloadState.downloadedList || []).filter(
        track => !this.missingFiles.has(track.localFilePath)
      );
    },
  },
  methods: {
    async refreshDownloads() {
      refreshDownloadHistory();
      const version = ++this.refreshVersion;
      const ipc = getIpcRenderer();
      if (!isElectron || !ipc) return;
      const paths = (downloadState.downloadedList || [])
        .map(track => track.localFilePath)
        .filter(Boolean);
      const results = await Promise.all(
        paths.map(async filePath => {
          try {
            return (await ipc.invoke('local-file-exists', filePath))
              ? null
              : filePath;
          } catch (_) {
            return null;
          }
        })
      );
      if (version === this.refreshVersion) {
        this.missingFiles = new Set(results.filter(Boolean));
      }
    },
    formatQuality(q) {
      if (q === 'flac') return 'FLAC';
      if (q === 999000 || q === '999000') return 'Hi-Res';
      if (q === 320000 || q === '320000') return '320K';
      if (q === 192000 || q === '192000') return '192K';
      if (q === 128000 || q === '128000') return '128K';
      return `${q}`;
    },
    formatBytes(bytes) {
      if (!bytes || bytes <= 0) return '0 MB';
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    },
    playAll() {
      if (this.downloadedTracks.length === 0) return;
      const ids = this.downloadedTracks.map(t => t.id);
      this.$store.state.player.replacePlaylist(
        ids,
        'local-downloads',
        'downloads',
        ids[0]
      );
    },
    openDownloadFolder() {
      const ipc = getIpcRenderer();
      if (!ipc) return;
      ipc.invoke(
        'open-download-dir',
        this.settings.downloadPath || ''
      );
    },
    clearHistory() {
      if (confirm('确定要清空已下载列表记录吗？（不会删除磁盘文件）')) {
        clearAllDownloadHistory();
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.download-tab-container {
  margin-top: 16px;
}

.downloading-section {
  margin-bottom: 24px;

  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    color: var(--color-text);

    .dot-pulse {
      width: 8px;
      height: 8px;
      background: var(--color-primary);
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 1.6s infinite ease-in-out;
    }
  }
}

@keyframes pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
  100% {
    transform: scale(0.9);
    opacity: 0.6;
  }
}

.downloading-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.downloading-card {
  display: flex;
  align-items: center;
  background: var(--color-secondary-bg);
  padding: 12px 16px;
  border-radius: 12px;
  transition: all 0.2s ease;

  .cover {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    object-fit: cover;
    margin-right: 16px;
    flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  }

  .main-info {
    flex: 1;
    overflow: hidden;

    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;

      .track-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text) !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .artist-name {
        font-size: 13px;
        color: var(--color-text) !important;
        opacity: 0.78;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .quality-tag {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-primary);
        background: var(--color-primary-bg-for-transparent);
        padding: 3px 8px;
        border-radius: 6px;
        margin-left: auto;
        flex-shrink: 0;
      }
    }

    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: var(--color-secondary-bg-for-transparent);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;

      .progress-bar {
        height: 100%;
        background: var(--color-primary-gradient);
        border-radius: 4px;
        transition: width 0.3s ease, background 0.3s ease;
        &.completed {
          background: #34c759;
        }
      }
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--color-text) !important;
      opacity: 0.75;
    }
  }
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  .play-all-btn {
    display: flex;
    align-items: center;
    background: var(--color-primary-bg);
    color: var(--color-primary);
    font-size: 14px;
    font-weight: 600;
    padding: 8px 18px;
    border-radius: 20px;
    transition: all 0.2s ease;

    .svg-icon {
      width: 14px;
      height: 14px;
      margin-right: 6px;
      fill: currentColor;
    }

    &:hover {
      transform: scale(1.04);
      background: var(--color-primary);
      color: #ffffff;
    }

    &:active {
      transform: scale(0.96);
    }
  }

  .right {
    display: flex;
    gap: 10px;
  }

  .secondary-btn {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    background: var(--color-secondary-bg);
    padding: 6px 14px;
    border-radius: 8px;
    transition: all 0.2s ease;

    &:hover {
      background: var(--color-secondary-bg-for-transparent);
      transform: scale(1.02);
    }

    &:active {
      transform: scale(0.96);
    }

    &.danger {
      opacity: 0.7;
      &:hover {
        opacity: 1;
        color: #e53935;
      }
    }
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  user-select: none;

  .empty-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--color-secondary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    color: var(--color-text);
    opacity: 0.6;
    transition: all 0.3s ease;

    .svg-icon {
      width: 28px;
      height: 28px;
      fill: currentColor;
    }
  }

  .empty-text {
    font-size: 15px;
    font-weight: 500;
    color: var(--color-text);
    opacity: 0.5;
    letter-spacing: 0.5px;
  }
}
</style>
