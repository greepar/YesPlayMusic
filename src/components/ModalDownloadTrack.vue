<template>
  <Modal
    class="download-track-modal"
    :show="show"
    :close="close"
    :show-footer="true"
    :title="$t('download.title')"
    width="32vw"
    min-width="360px"
  >
    <template #default>
      <div v-if="track" class="track-header">
        <img v-if="coverUrl" :src="coverUrl" class="cover" loading="lazy" />
        <div class="info">
          <div class="title">{{ track.name }}</div>
          <div class="artist">{{ artistName }}</div>
        </div>
      </div>

      <div class="quality-title">{{ $t('download.selectQuality') }}</div>

      <div class="quality-list">
        <div
          v-for="opt in qualityOptions"
          :key="opt.value"
          class="quality-card"
          :class="{ active: String(selectedQuality) === String(opt.value) }"
          @click="selectedQuality = opt.value"
        >
          <div class="radio-indicator">
            <div
              v-show="String(selectedQuality) === String(opt.value)"
              class="dot"
            ></div>
          </div>
          <div class="meta">
            <div class="name">{{ opt.name }}</div>
            <div class="desc">{{ opt.desc }}</div>
          </div>
        </div>
      </div>

      <div class="remember-row" @click="rememberChoice = !rememberChoice">
        <div class="checkbox-custom" :class="{ checked: rememberChoice }">
          <svg
            v-show="rememberChoice"
            class="check-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <label>
          {{ $t('download.rememberChoice') }}
        </label>
      </div>
    </template>
    <template #footer>
      <button class="footer-btn cancel-btn" @click="close">{{
        $t('download.cancel')
      }}</button>
      <button class="footer-btn primary confirm-btn" @click="confirmDownload">{{
        $t('download.confirm')
      }}</button>
    </template>
  </Modal>
</template>

<script>
import { mapMutations, mapState } from 'vuex';
import Modal from '@/components/Modal.vue';
import { downloadTrack } from '@/utils/download';

export default {
  name: 'ModalDownloadTrack',
  components: {
    Modal,
  },
  data() {
    return {
      selectedQuality: 320000,
      rememberChoice: false,
    };
  },
  computed: {
    ...mapState(['modals', 'settings']),
    show: {
      get() {
        return this.modals.downloadTrackModal?.show || false;
      },
      set(value) {
        this.updateModal({
          modalName: 'downloadTrackModal',
          key: 'show',
          value,
        });
        if (value) {
          this.$store.commit('enableScrolling', false);
        } else {
          this.$store.commit('enableScrolling', true);
        }
      },
    },
    track() {
      return this.modals.downloadTrackModal?.selectedTrack || null;
    },
    coverUrl() {
      const url =
        this.track?.al?.picUrl ||
        this.track?.album?.picUrl ||
        '';
      return url ? `${url}?param=224y224` : '';
    },
    artistName() {
      const list = this.track?.ar || this.track?.artists || [];
      return list.map(a => a.name).join(', ') || '';
    },
    qualityOptions() {
      return [
        {
          value: 128000,
          name: this.$t('settings.musicQuality.low') + ' (128Kbps)',
          desc: this.$t('download.quality128Desc'),
        },
        {
          value: 192000,
          name: this.$t('settings.musicQuality.medium') + ' (192Kbps)',
          desc: this.$t('download.quality192Desc'),
        },
        {
          value: 320000,
          name: this.$t('settings.musicQuality.high') + ' (320Kbps)',
          desc: this.$t('download.quality320Desc'),
        },
        {
          value: 'flac',
          name: this.$t('settings.musicQuality.lossless') + ' (FLAC)',
          desc: this.$t('download.qualityFlacDesc'),
        },
        {
          value: 999000,
          name: 'Hi-Res',
          desc: this.$t('download.qualityHiresDesc'),
        },
      ];
    },
  },
  watch: {
    show(val) {
      if (val) {
        this.selectedQuality = this.settings.downloadQuality ?? 320000;
        this.rememberChoice = false;
      }
    },
  },
  methods: {
    ...mapMutations(['updateModal', 'updateSettings']),
    close() {
      this.show = false;
    },
    confirmDownload() {
      const track = this.track;
      const quality = this.selectedQuality;
      if (this.rememberChoice) {
        this.updateSettings({
          key: 'downloadQuality',
          value: quality,
        });
        this.updateSettings({
          key: 'askBeforeDownload',
          value: false,
        });
      }
      this.close();
      if (track) {
        downloadTrack(track, quality);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.track-header {
  display: flex;
  align-items: center;
  margin-bottom: 18px;
  background: var(--color-secondary-bg);
  padding: 12px 14px;
  border-radius: 12px;

  .cover {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    object-fit: cover;
    margin-right: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    flex-shrink: 0;
  }

  .info {
    overflow: hidden;

    .title {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artist {
      font-size: 13px;
      opacity: 0.68;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}

.quality-title {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.78;
  margin-bottom: 10px;
}

.quality-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quality-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--color-secondary-bg);
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-secondary-bg-for-transparent);
  }

  &.active {
    border-color: var(--color-primary);
    background: var(--color-primary-bg-for-transparent);

    .radio-indicator {
      border-color: var(--color-primary);

      .dot {
        background: var(--color-primary);
      }
    }

    .meta {
      .name {
        color: var(--color-primary);
        font-weight: 600;
      }

      .desc {
        color: var(--color-text);
        opacity: 0.78;
      }
    }
  }

  .radio-indicator {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid rgba(128, 128, 128, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    flex-shrink: 0;
    transition: 0.2s;

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: transparent;
    }
  }

  .meta {
    display: flex;
    flex-direction: column;

    .name {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text);
      transition: color 0.2s ease;
    }

    .desc {
      font-size: 12px;
      opacity: 0.55;
      margin-top: 2px;
      transition: opacity 0.2s ease;
    }
  }
}

.remember-row {
  display: flex;
  align-items: center;
  margin-top: 18px;
  margin-bottom: 4px;
  cursor: pointer;
  user-select: none;

  .checkbox-custom {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1.5px solid rgba(128, 128, 128, 0.5);
    margin-right: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;

    &.checked {
      background: var(--color-primary);
      border-color: var(--color-primary);

      .check-icon {
        color: #ffffff;
      }
    }

    .check-icon {
      width: 12px;
      height: 12px;
    }
  }

  label {
    font-size: 13px;
    opacity: 0.85;
    cursor: pointer;
    color: var(--color-text);
  }
}

.footer-btn {
  border: none;
  outline: none;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 22px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;

  &.cancel-btn {
    color: var(--color-text);
    background: var(--color-secondary-bg);
    opacity: 0.85;

    &:hover {
      opacity: 1;
      background: var(--color-secondary-bg-for-transparent);
      transform: scale(1.03);
    }

    &:active {
      transform: scale(0.96);
    }
  }

  &.confirm-btn {
    color: #ffffff !important;
    background: var(--color-primary-gradient) !important;
    box-shadow: 0 4px 14px rgba(51, 94, 234, 0.4);
    margin-left: 12px;

    &:hover {
      box-shadow: 0 6px 20px rgba(51, 94, 234, 0.55);
      transform: scale(1.03);
    }

    &:active {
      transform: scale(0.96);
    }
  }
}
</style>
