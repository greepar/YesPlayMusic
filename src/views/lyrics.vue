<template>
  <transition name="slide-up">
    <div
      class="lyrics-page"
      :class="{ 'no-lyric': noLyric, 'is-mac': isMac }"
      :data-theme="theme"
    >
      <div
        v-if="
          (settings.lyricsBackground === 'blur') |
            (settings.lyricsBackground === 'dynamic')
        "
        class="lyrics-background"
        :class="{
          'dynamic-background': settings.lyricsBackground === 'dynamic',
        }"
      >
        <div
          class="top-right"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
        <div
          class="bottom-left"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
      </div>
      <div
        v-if="settings.lyricsBackground === true"
        class="gradient-background"
        :style="{ background }"
      ></div>

      <div class="left-side">
        <div>
          <div v-if="settings.showLyricsTime" class="date">
            {{ date }}
          </div>
          <div class="cover">
            <div class="cover-container">
              <img v-virtual-image="imageUrl" loading="lazy" />
              <div
                class="shadow"
                :style="{ backgroundImage: `url(${imageUrl})` }"
              ></div>
            </div>
          </div>
          <div class="controls">
            <div class="top-part">
              <div class="track-info">
                <div class="title" :title="currentTrack.name">
                  <router-link
                    v-if="hasList()"
                    :to="`${getListPath()}`"
                    @click="toggleLyrics"
                    >{{ currentTrack.name }}
                  </router-link>
                  <span v-else>
                    {{ currentTrack.name }}
                  </span>
                </div>
                <div class="subtitle">
                  <router-link
                    v-if="artist.id !== 0"
                    :to="`/artist/${artist.id}`"
                    @click="toggleLyrics"
                    >{{ artist.name }}
                  </router-link>
                  <span v-else>
                    {{ artist.name }}
                  </span>
                  <span v-if="album.id !== 0">
                    -
                    <router-link
                      :to="`/album/${album.id}`"
                      :title="album.name"
                      @click="toggleLyrics"
                      >{{ album.name }}
                    </router-link>
                  </span>
                </div>
              </div>
              <div class="top-right">
                <div class="volume-control">
                  <button-icon :title="$t('player.mute')" @click="mute">
                    <svg-icon v-show="volume > 0.5" icon-class="volume" />
                    <svg-icon v-show="volume === 0" icon-class="volume-mute" />
                    <svg-icon
                      v-show="volume <= 0.5 && volume !== 0"
                      icon-class="volume-half"
                    />
                  </button-icon>
                  <div class="volume-bar">
                    <vue-slider
                      v-model="volume"
                      :min="0"
                      :max="1"
                      :interval="0.01"
                      :drag-on-click="true"
                      :duration="0"
                      tooltip="none"
                      :dot-size="12"
                    ></vue-slider>
                  </div>
                </div>
                <div class="buttons">
                  <button-icon
                    :title="$t('player.like')"
                    @click="likeATrack(player.currentTrack.id)"
                  >
                    <svg-icon
                      :icon-class="
                        player.isCurrentTrackLiked ? 'heart-solid' : 'heart'
                      "
                    />
                  </button-icon>
                  <button-icon
                    :title="$t('contextMenu.addToPlaylist')"
                    @click="addToPlaylist"
                  >
                    <svg-icon icon-class="plus" />
                  </button-icon>
                  <!-- <button-icon @click="openMenu" title="Menu"
                    ><svg-icon icon-class="more"
                  /></button-icon> -->
                </div>
              </div>
            </div>
            <div class="progress-bar">
              <span>{{ formatTrackTime(player.progress) || '0:00' }}</span>
              <div class="slider">
                <vue-slider
                  v-model="player.progress"
                  :min="0"
                  :max="player.currentTrackDuration"
                  :interval="1"
                  :drag-on-click="true"
                  :duration="0"
                  :dot-size="12"
                  :height="2"
                  :tooltip-formatter="formatTrackTime"
                  :lazy="true"
                  :silent="true"
                ></vue-slider>
              </div>
              <span>{{ formatTrackTime(player.currentTrackDuration) }}</span>
            </div>
            <div class="media-controls">
              <button-icon
                v-show="!player.isPersonalFM"
                :title="
                  player.repeatMode === 'one'
                    ? $t('player.repeatTrack')
                    : $t('player.repeat')
                "
                :class="{ active: player.repeatMode !== 'off' }"
                @click="switchRepeatMode"
              >
                <svg-icon
                  v-show="player.repeatMode !== 'one'"
                  icon-class="repeat"
                />
                <svg-icon
                  v-show="player.repeatMode === 'one'"
                  icon-class="repeat-1"
                />
              </button-icon>
              <div class="middle">
                <button-icon
                  v-show="!player.isPersonalFM"
                  :title="$t('player.previous')"
                  @click="playPrevTrack"
                >
                  <svg-icon icon-class="previous" />
                </button-icon>
                <button-icon
                  v-show="player.isPersonalFM"
                  title="不喜欢"
                  @click="moveToFMTrash"
                >
                  <svg-icon icon-class="thumbs-down" />
                </button-icon>
                <button-icon
                  id="play"
                  :title="$t(player.playing ? 'player.pause' : 'player.play')"
                  @click="playOrPause"
                >
                  <svg-icon :icon-class="player.playing ? 'pause' : 'play'" />
                </button-icon>
                <button-icon :title="$t('player.next')" @click="playNextTrack">
                  <svg-icon icon-class="next" />
                </button-icon>
              </div>
              <button-icon
                v-show="!player.isPersonalFM"
                :title="$t('player.shuffle')"
                :class="{ active: player.shuffle }"
                @click="switchShuffle"
              >
                <svg-icon icon-class="shuffle" />
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'translation'
                "
                :title="$t('player.translationLyric')"
                @click="switchLyricType"
              >
                <span class="lyric-switch-icon">译</span>
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'romaPronunciation'
                "
                :title="$t('player.PronunciationLyric')"
                @click="switchLyricType"
              >
                <span class="lyric-switch-icon">音</span>
              </button-icon>
            </div>
          </div>
        </div>
      </div>
      <div class="right-side">
        <transition name="slide-fade">
          <div
            v-show="!noLyric"
            ref="lyricsContainer"
            class="lyrics-container"
            :style="lyricFontSize"
            @wheel.passive="pauseAutoScroll"
            @touchstart.passive="pauseAutoScroll"
            @pointerdown="pauseAutoScroll"
          >
            <div class="lyrics-spacer" aria-hidden="true"></div>
            <div
              v-for="(line, index) in lyricToShow"
              :id="`line${index}`"
              :key="index"
              class="line"
              :class="{
                highlight: highlightLyricIndex === index,
              }"
              @click="clickLyricLine(line.time)"
              @dblclick="clickLyricLine(line.time, true)"
            >
              <div class="content">
                <span
                  v-if="line.contents[0]"
                  @click.right="openLyricMenu($event, line, 0)"
                  >{{ line.contents[0] }}</span
                >
                <br />
                <span
                  v-if="
                    line.contents[1] &&
                    $store.state.settings.showLyricsTranslation
                  "
                  class="translation"
                  @click.right="openLyricMenu($event, line, 1)"
                  >{{ line.contents[1] }}</span
                >
              </div>
            </div>
            <div class="lyrics-spacer" aria-hidden="true"></div>
            <ContextMenu
              v-if="!noLyric"
              ref="lyricMenu"
              class="lyric-context-menu"
            >
              <div class="item" @click="copyLyric(false)">{{
                $t('contextMenu.copyLyric')
              }}</div>
              <div
                v-if="
                  rightClickLyric &&
                  rightClickLyric.contents[1] &&
                  $store.state.settings.showLyricsTranslation
                "
                class="item"
                @click="copyLyric(true)"
                >{{ $t('contextMenu.copyLyricWithTranslation') }}</div
              >
            </ContextMenu>
          </div>
        </transition>
      </div>
      <div class="close-button" @click="toggleLyrics">
        <button>
          <svg-icon icon-class="arrow-down" />
        </button>
      </div>
      <div class="close-button fullscreen-button" @click="fullscreen">
        <button>
          <svg-icon v-if="isFullscreen" icon-class="fullscreen-exit" />
          <svg-icon v-else icon-class="fullscreen" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script>
// The lyrics page of Apple Music is so gorgeous, so I copy the design.
// Some of the codes are from https://github.com/sl1673495/vue-netease-music

import { mapState, mapMutations, mapActions } from 'vuex';
import VueSlider from '@/components/AppSlider.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import { formatTrackTime } from '@/utils/common';
import { getLyric, getCloudLyric } from '@/api/track';
import { lyricParser, copyLyric, parseLyric } from '@/utils/lyrics';
import ButtonIcon from '@/components/ButtonIcon.vue';
import { Vibrant } from 'node-vibrant/browser';
import Color from 'color';
import { isAccountLoggedIn } from '@/utils/auth';
import { hasListSource, getListSourcePath } from '@/utils/playList';
import locale from '@/locale';
import {
  isRenderingSuspended,
  onRenderingStateChange,
} from '@/utils/renderLifecycle';

export default {
  name: 'Lyrics',
  components: {
    VueSlider,
    ButtonIcon,
    ContextMenu,
  },
  data() {
    return {
      lyricsInterval: null,
      lyric: [],
      tlyric: [],
      romalyric: [],
      lyricType: 'translation', // or 'romaPronunciation'
      highlightLyricIndex: -1,
      minimize: true,
      background: '',
      date: this.formatTime(new Date()),
      isFullscreen: !!document.fullscreenElement,
      rightClickLyric: null,
      colorRequestId: 0,
      lyricRequestId: 0,
      renderingSuspended: isRenderingSuspended(),
      stopRenderingStateListener: null,
      lyricScrollFrame: null,
      lyricScrollPausedUntil: 0,
      lyricScrollResumeTimer: null,
    };
  },
  computed: {
    ...mapState(['player', 'settings', 'showLyrics']),
    isMac() {
      return process.platform === 'darwin';
    },
    currentTrack() {
      return this.player.currentTrack;
    },
    volume: {
      get() {
        return this.player.volume;
      },
      set(value) {
        this.player.volume = value;
      },
    },
    imageUrl() {
      const picUrl = this.currentTrack?.al?.picUrl;
      return picUrl ? `${picUrl}?param=1024y1024` : '';
    },
    bgImageUrl() {
      const picUrl = this.currentTrack?.al?.picUrl;
      return picUrl ? `${picUrl}?param=512y512` : '';
    },
    isShowLyricTypeSwitch() {
      return this.romalyric.length > 0 && this.tlyric.length > 0;
    },
    lyricToShow() {
      return this.lyricType === 'translation'
        ? this.lyricWithTranslation
        : this.lyricWithRomaPronunciation;
    },
    lyricWithTranslation() {
      let ret = [];
      // 空内容的去除
      const lyricFiltered = this.lyric.filter(({ content }) =>
        Boolean(content)
      );
      // content统一转换数组形式
      if (lyricFiltered.length) {
        lyricFiltered.forEach(l => {
          const { rawTime, time, content } = l;
          const lyricItem = { time, content, contents: [content] };
          const sameTimeTLyric = this.tlyric.find(
            ({ rawTime: tLyricRawTime }) => tLyricRawTime === rawTime
          );
          if (sameTimeTLyric) {
            const { content: tLyricContent } = sameTimeTLyric;
            if (content) {
              lyricItem.contents.push(tLyricContent);
            }
          }
          ret.push(lyricItem);
        });
      } else {
        ret = lyricFiltered.map(({ time, content }) => ({
          time,
          content,
          contents: [content],
        }));
      }
      return ret;
    },
    lyricWithRomaPronunciation() {
      let ret = [];
      // 空内容的去除
      const lyricFiltered = this.lyric.filter(({ content }) =>
        Boolean(content)
      );
      // content统一转换数组形式
      if (lyricFiltered.length) {
        lyricFiltered.forEach(l => {
          const { rawTime, time, content } = l;
          const lyricItem = { time, content, contents: [content] };
          const sameTimeRomaLyric = this.romalyric.find(
            ({ rawTime: tLyricRawTime }) => tLyricRawTime === rawTime
          );
          if (sameTimeRomaLyric) {
            const { content: romaLyricContent } = sameTimeRomaLyric;
            if (content) {
              lyricItem.contents.push(romaLyricContent);
            }
          }
          ret.push(lyricItem);
        });
      } else {
        ret = lyricFiltered.map(({ time, content }) => ({
          time,
          content,
          contents: [content],
        }));
      }
      return ret;
    },
    lyricFontSize() {
      return {
        fontSize: `${this.$store.state.settings.lyricFontSize || 28}px`,
      };
    },
    noLyric() {
      return this.lyric.length == 0;
    },
    artist() {
      return this.currentTrack?.ar
        ? this.currentTrack.ar[0]
        : { id: 0, name: 'unknown' };
    },
    album() {
      return this.currentTrack?.al || { id: 0, name: 'unknown' };
    },
    theme() {
      return this.settings.lyricsBackground === true ? 'dark' : 'auto';
    },
  },
  watch: {
    // RemotePlayer replaces currentTrack on every host snapshot (play/pause,
    // volume, like...), so only react when the track actually changes.
    'currentTrack.id'() {
      this.cancelLyricScroll();
      this.highlightLyricIndex = -1;
      if (this.$refs.lyricsContainer) this.$refs.lyricsContainer.scrollTop = 0;
      this.getLyric();
      this.getCoverColor();
    },
    showLyrics(show) {
      if (show && !this.renderingSuspended) {
        this.setLyricsInterval();
        this.initDate();
        this.$store.commit('enableScrolling', false);
        this.$nextTick(() => this.scrollToCurrentLyric(false));
      } else {
        this.cancelLyricScroll();
        clearTimeout(this.lyricScrollResumeTimer);
        clearInterval(this.lyricsInterval);
        this.lyricsInterval = null;
        clearInterval(this.timer);
        this.timer = null;
        this.$store.commit('enableScrolling', true);
      }
    },
    lyricToShow() {
      this.cancelLyricScroll();
      this.highlightLyricIndex = -1;
      this.$nextTick(() => this.updateHighlightedLyric(false));
    },
  },
  created() {
    this.getLyric();
    this.getCoverColor();
    if (this.showLyrics && !this.renderingSuspended) {
      this.setLyricsInterval();
      this.initDate();
    }
    this.stopRenderingStateListener = onRenderingStateChange(
      this.handleRenderingStateChange
    );
    document.addEventListener('keydown', this.handleFullscreenKeydown);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
  },
  beforeUnmount: function () {
    this.colorRequestId += 1;
    this.stopRenderingStateListener?.();
    clearInterval(this.timer);
    clearInterval(this.lyricsInterval);
    this.cancelLyricScroll();
    clearTimeout(this.lyricScrollResumeTimer);
    document.removeEventListener('keydown', this.handleFullscreenKeydown);
    document.removeEventListener(
      'fullscreenchange',
      this.handleFullscreenChange
    );
  },
  methods: {
    ...mapMutations(['toggleLyrics', 'updateModal']),
    ...mapActions(['likeATrack']),
    handleRenderingStateChange(suspended) {
      this.renderingSuspended = suspended;
      clearInterval(this.timer);
      clearInterval(this.lyricsInterval);
      this.timer = null;
      this.lyricsInterval = null;
      this.cancelLyricScroll();
      clearTimeout(this.lyricScrollResumeTimer);
      if (!suspended && this.showLyrics) {
        this.setLyricsInterval();
        this.initDate();
      }
    },
    handleFullscreenKeydown(e) {
      if (e.key === 'F11') {
        e.preventDefault();
        this.fullscreen();
      }
    },
    handleFullscreenChange() {
      this.isFullscreen = !!document.fullscreenElement;
    },
    initDate() {
      var _this = this;
      clearInterval(this.timer);
      this.timer = setInterval(function () {
        _this.date = _this.formatTime(new Date());
      }, 1000);
    },
    formatTime(value) {
      let hour = value.getHours().toString();
      let minute = value.getMinutes().toString();
      let second = value.getSeconds().toString();
      return (
        hour.padStart(2, '0') +
        ':' +
        minute.padStart(2, '0') +
        ':' +
        second.padStart(2, '0')
      );
    },
    fullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
    addToPlaylist() {
      if (!isAccountLoggedIn()) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      this.$store.dispatch('fetchLikedPlaylist');
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'show',
        value: true,
      });
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'selectedTrackID',
        value: this.currentTrack?.id,
      });
    },
    playPrevTrack() {
      this.player.playPrevTrack();
    },
    playOrPause() {
      this.player.playOrPause();
    },
    playNextTrack() {
      if (this.player.isPersonalFM) {
        this.player.playNextFMTrack();
      } else {
        this.player.playNextTrack();
      }
    },
    getLyric() {
      if (!this.currentTrack.id) return;
      const requestId = ++this.lyricRequestId;
      const isStale = () => requestId !== this.lyricRequestId;
      const clearLyric = () => {
        this.lyric = [];
        this.tlyric = [];
        this.romalyric = [];
        return false;
      };
      if (
        this.currentTrack.pc !== null &&
        this.currentTrack.cd === null &&
        this.$store.state.data.user?.userId
      ) {
        //云盘未设置关联的歌曲获取其内置歌词
        return getCloudLyric(
          this.currentTrack.id,
          this.$store.state.data.user?.userId
        )
          .then(data => {
            if (isStale()) return false;
            this.tlyric = [];
            this.romalyric = [];
            this.lyric = data?.lrc?.length > 0 ? parseLyric(data.lrc) : [];
            this.lyricType = 'translation';
            return true;
          })
          .catch(() => (isStale() ? false : clearLyric()));
      }
      return getLyric(this.currentTrack.id)
        .then(data => {
          if (isStale()) return false;
          if (!data?.lrc?.lyric) return clearLyric();
          let { lyric, tlyric, romalyric } = lyricParser(data);
          lyric = lyric.filter(
            l => !/^作(词|曲)\s*(:|：)\s*无$/.exec(l.content)
          );
          let includeAM =
            lyric.length <= 10 &&
            lyric.map(l => l.content).includes('纯音乐，请欣赏');
          if (includeAM) {
            let reg = /^作(词|曲)\s*(:|：)\s*/;
            let author = this.currentTrack?.ar[0]?.name;
            lyric = lyric.filter(l => {
              let regExpArr = l.content.match(reg);
              return (
                !regExpArr || l.content.replace(regExpArr[0], '') !== author
              );
            });
          }
          if (lyric.length === 1 && includeAM) return clearLyric();
          this.lyric = lyric;
          this.tlyric = tlyric;
          this.romalyric = romalyric;
          if (tlyric.length * romalyric.length > 0) {
            this.lyricType = 'translation';
          } else {
            this.lyricType =
              lyric.length > 0 ? 'translation' : 'romaPronunciation';
          }
          return true;
        })
        .catch(() => (isStale() ? false : clearLyric()));
    },
    switchLyricType() {
      this.lyricType =
        this.lyricType === 'translation' ? 'romaPronunciation' : 'translation';
    },
    formatTrackTime(value) {
      return formatTrackTime(value);
    },
    clickLyricLine(value, startPlay = false) {
      // TODO: 双击选择还会选中文字，考虑搞个右键菜单复制歌词
      const shouldResumeAutoScroll =
        this.lyricScrollPausedUntil > performance.now();
      let jumpFlag = false;
      this.lyric.filter(function (item) {
        if (item.content == '纯音乐，请欣赏') {
          jumpFlag = true;
        }
      });
      if (window.getSelection().toString().length === 0 && !jumpFlag) {
        this.player.seek(value);
        if (shouldResumeAutoScroll) {
          clearTimeout(this.lyricScrollResumeTimer);
          this.lyricScrollPausedUntil = 0;
          this.updateHighlightedLyric();
        }
      }
      if (startPlay === true) {
        this.player.play();
      }
    },
    openLyricMenu(e, lyric, idx) {
      this.rightClickLyric = { ...lyric, idx };
      this.$refs.lyricMenu.openMenu(e);
      e.preventDefault();
    },
    copyLyric(withTranslation) {
      if (this.rightClickLyric) {
        const idx = this.rightClickLyric.idx;
        if (!withTranslation) {
          copyLyric(this.rightClickLyric.contents[idx]);
        } else {
          copyLyric(this.rightClickLyric.contents.join(' '));
        }
      }
    },
    setLyricsInterval() {
      clearInterval(this.lyricsInterval);
      this.updateHighlightedLyric(false);
      this.lyricsInterval = setInterval(
        () => this.updateHighlightedLyric(),
        50
      );
    },
    updateHighlightedLyric(animate = true) {
      const progress = this.player.seek(null, false) ?? 0;
      const oldHighlightLyricIndex = this.highlightLyricIndex;
      const lines = this.lyricToShow;
      let index = oldHighlightLyricIndex;

      if (lines.length === 0 || progress < lines[0].time) {
        index = -1;
      } else if (
        index < 0 ||
        index >= lines.length ||
        progress < lines[index].time
      ) {
        // Seek/backward jumps use binary search instead of scanning every line.
        let low = 0;
        let high = lines.length - 1;
        while (low <= high) {
          const middle = (low + high) >> 1;
          if (lines[middle].time <= progress) {
            index = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
      } else {
        // Normal playback only advances across newly reached lines.
        while (index + 1 < lines.length && lines[index + 1].time <= progress) {
          index += 1;
        }
      }

      this.highlightLyricIndex = index;
      if (oldHighlightLyricIndex !== index && index >= 0) {
        this.$nextTick(() => this.scrollToCurrentLyric(animate));
      }
    },
    cancelLyricScroll() {
      if (this.lyricScrollFrame !== null) {
        cancelAnimationFrame(this.lyricScrollFrame);
        this.lyricScrollFrame = null;
      }
    },
    pauseAutoScroll() {
      this.cancelLyricScroll();
      this.lyricScrollPausedUntil = performance.now() + 3000;
      clearTimeout(this.lyricScrollResumeTimer);
      this.lyricScrollResumeTimer = setTimeout(() => {
        this.lyricScrollResumeTimer = null;
        this.scrollToCurrentLyric();
      }, 3100);
    },
    scrollToCurrentLyric(animate = true) {
      const container = this.$refs.lyricsContainer;
      if (!container || !this.showLyrics || this.renderingSuspended) return;
      if (performance.now() < this.lyricScrollPausedUntil) return;
      if (this.highlightLyricIndex < 0) return;
      const line = container.querySelector(`#line${this.highlightLyricIndex}`);
      if (!line) return;

      this.cancelLyricScroll();
      const start = container.scrollTop;
      const target = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          start +
            line.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            line.offsetHeight / 2 -
            container.clientHeight / 2
        )
      );
      if (
        !animate ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        container.scrollTop = target;
        return;
      }
      const started = performance.now();
      const duration = 650;
      const step = now => {
        const t = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        container.scrollTop = start + (target - start) * eased;
        this.lyricScrollFrame = t < 1 ? requestAnimationFrame(step) : null;
      };
      this.lyricScrollFrame = requestAnimationFrame(step);
    },
    moveToFMTrash() {
      this.player.moveToFMTrash();
    },
    switchRepeatMode() {
      this.player.switchRepeatMode();
    },
    switchShuffle() {
      this.player.switchShuffle();
    },
    getCoverColor() {
      if (this.settings.lyricsBackground !== true) return;
      const requestId = ++this.colorRequestId;
      const picUrl = this.currentTrack.al?.picUrl;
      if (!picUrl) {
        this.background = '';
        return;
      }
      const cover = `${picUrl}?param=256y256`;
      Vibrant.from(cover, { colorCount: 1 })
        .getPalette()
        .then(palette => {
          if (requestId !== this.colorRequestId) return;
          const originColor = Color.rgb(palette.DarkMuted._rgb);
          const color = originColor.darken(0.1).rgb().string();
          const color2 = originColor.lighten(0.28).rotate(-30).rgb().string();
          this.background = `linear-gradient(to top left, ${color}, ${color2})`;
        })
        .catch(() => {
          if (requestId === this.colorRequestId) this.background = '';
        });
    },
    hasList() {
      return hasListSource();
    },
    getListPath() {
      return getListSourcePath();
    },
    mute() {
      this.player.mute();
    },
  },
};
</script>

<style lang="scss" scoped>
.lyrics-page {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  z-index: 200;
  background: var(--color-body-bg);
  display: flex;
  clip: rect(auto, auto, auto, auto);
}

.lyrics-background {
  --contrast-lyrics-background: 75%;
  --brightness-lyrics-background: 150%;
}

[data-theme='dark'] .lyrics-background {
  --contrast-lyrics-background: 125%;
  --brightness-lyrics-background: 50%;
}

.lyrics-background {
  filter: blur(50px) contrast(var(--contrast-lyrics-background))
    brightness(var(--brightness-lyrics-background));
  position: absolute;
  height: 100vh;
  width: 100vw;

  .top-right,
  .bottom-left {
    z-index: 0;
    width: 140vw;
    height: 140vw;
    opacity: 0.6;
    position: absolute;
    background-size: cover;
  }

  .top-right {
    right: 0;
    top: 0;
    mix-blend-mode: luminosity;
  }

  .bottom-left {
    left: 0;
    bottom: 0;
    animation-direction: reverse;
    animation-delay: 10s;
  }
}

.dynamic-background > div {
  animation: rotate 150s linear infinite;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.gradient-background {
  position: absolute;
  height: 100vh;
  width: 100vw;
}

.left-side {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  margin-right: 32px;
  margin-top: 24px;
  align-items: center;
  transition: all 0.5s;

  z-index: 1;

  .date {
    max-width: 54vh;
    margin: 24px 0;
    color: var(--color-text);
    text-align: center;
    font-size: 4rem;
    font-weight: 600;
    opacity: 0.88;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
  }

  .controls {
    max-width: 54vh;
    margin-top: 24px;
    color: var(--color-text);

    .title {
      margin-top: 8px;
      font-size: 1.4rem;
      font-weight: 600;
      opacity: 0.88;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .subtitle {
      margin-top: 4px;
      font-size: 1rem;
      opacity: 0.58;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .top-part {
      display: flex;
      justify-content: space-between;

      .top-right {
        display: flex;
        justify-content: space-between;

        .volume-control {
          margin: 0 10px;
          display: flex;
          align-items: center;

          .volume-bar {
            width: 84px;
          }
        }

        .buttons {
          display: flex;
          align-items: center;

          button {
            margin: 0 0 0 4px;
          }

          .svg-icon {
            height: 18px;
            width: 18px;
          }
        }
      }
    }

    .progress-bar {
      margin-top: 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .slider {
        width: 100%;
        flex-grow: grow;
        padding: 0 10px;
      }

      span {
        font-size: 15px;
        opacity: 0.58;
        min-width: 28px;
      }
    }

    .media-controls {
      display: flex;
      justify-content: center;
      margin-top: 18px;
      align-items: center;

      button {
        margin: 0;
      }

      .svg-icon {
        opacity: 0.38;
        height: 14px;
        width: 14px;
      }

      .active .svg-icon {
        opacity: 0.88;
      }

      .middle {
        padding: 0 16px;
        display: flex;
        align-items: center;

        button {
          margin: 0 8px;
        }

        button#play .svg-icon {
          height: 28px;
          width: 28px;
          padding: 2px;
        }

        .svg-icon {
          opacity: 0.88;
          height: 22px;
          width: 22px;
        }
      }

      .lyric-switch-icon {
        color: var(--color-text);
        font-size: 14px;
        line-height: 14px;
        opacity: 0.88;
      }
    }
  }
}

.cover {
  position: relative;

  .cover-container {
    position: relative;
  }

  img {
    border-radius: 0.75em;
    width: 54vh;
    height: 54vh;
    user-select: none;
    object-fit: cover;
  }

  .shadow {
    position: absolute;
    top: 12px;
    height: 54vh;
    width: 54vh;
    filter: blur(16px) opacity(0.6);
    transform: scale(0.92, 0.96);
    z-index: -1;
    background-size: cover;
    border-radius: 0.75em;
  }
}

.right-side {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  margin-right: 24px;
  z-index: 0;

  .lyrics-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-left: 78px;
    max-width: 460px;
    overflow-y: auto;
    transition: 0.5s;
    scrollbar-width: none; // firefox

    .line {
      margin: 2px 0;
      padding: 12px 18px;
      transition: 0.5s;
      border-radius: 12px;

      &:hover {
        background: var(--color-secondary-bg-for-transparent);
      }

      .content {
        transform-origin: center left;
        transform: scale(0.95);
        transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        user-select: none;

        span {
          opacity: 0.28;
          cursor: default;
          font-size: 1em;
          transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }

        span.translation {
          opacity: 0.2;
          font-size: 0.925em;
        }
      }
    }

    .lyrics-spacer {
      flex: 0 0 50%;
      pointer-events: none;
    }

    .lyric-context-menu {
      position: absolute;
      width: 0;
      height: 0;
    }

    .translation {
      margin-top: 0.1em;
    }

    .highlight div.content {
      transform: scale(1);

      span {
        opacity: 0.98;
        display: inline-block;
      }

      span.translation {
        opacity: 0.65;
      }
    }
  }

  ::-webkit-scrollbar {
    display: none;
  }
}

.close-button {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 300;
  border-radius: 0.75rem;
  height: 44px;
  width: 44px;
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0.28;
  transition: 0.2s;
  -webkit-app-region: no-drag;

  &.fullscreen-button {
    right: auto;
    left: 24px;
  }

  // macOS：左上角是红绿灯（中心线约 32px，与导航栏一致）。
  // 按钮中心线对齐到同一水平线，全屏按钮让到红绿灯右侧
  .is-mac & {
    top: 8px;
    &.fullscreen-button {
      left: 84px;
    }
  }

  .svg-icon {
    color: var(--color-text);
    padding-top: 5px;
    height: 22px;
    width: 22px;
  }

  &:hover {
    background: var(--color-secondary-bg-for-transparent);
    opacity: 0.88;
  }
}

.lyrics-page.no-lyric {
  .left-side {
    transition: all 0.5s;
    transform: translateX(27vh);
    margin-right: 0;
  }
}

@media (max-aspect-ratio: 10/9) {
  .left-side {
    display: none;
  }

  .right-side .lyrics-container {
    max-width: 100%;
  }
}

@media screen and (min-width: 1200px) {
  .right-side .lyrics-container {
    max-width: 600px;
  }
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s;
}

.slide-up-enter,
.slide-up-enter-from,
.slide-up-leave-to
/* .fade-leave-active below version 2.1.8 */ {
  transform: translateY(100%);
}

.slide-fade-enter-active {
  transition: all 0.5s ease;
}

.slide-fade-leave-active {
  transition: all 0.5s cubic-bezier(0.2, 0.2, 0, 1);
}

.slide-fade-enter,
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(27vh);
  opacity: 0;
}
</style>
