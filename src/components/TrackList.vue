<template>
  <div class="track-list">
    <ContextMenu ref="menu">
      <div v-show="type !== 'cloudDisk'" class="item-info">
        <img
          v-if="menuCoverUrl"
          :src="menuCoverUrl"
          loading="eager"
          decoding="sync"
        />
        <div class="info">
          <div class="title">{{ rightClickedTrackComputed.name }}</div>
          <div class="subtitle">{{ rightClickedTrackArtistName }}</div>
        </div>
      </div>
      <hr v-show="type !== 'cloudDisk'" />
      <div class="item" @click="play">{{ $t('contextMenu.play') }}</div>
      <div class="item" @click="addToQueue">{{
        $t('contextMenu.addToQueue')
      }}</div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromQueue')"
        class="item"
        @click="removeTrackFromQueue"
        >从队列删除</div
      >
      <hr v-show="type !== 'cloudDisk'" />
      <div
        v-show="!isRightClickedTrackLiked && type !== 'cloudDisk'"
        class="item"
        @click="like"
      >
        {{ $t('contextMenu.saveToMyLikedSongs') }}
      </div>
      <div
        v-show="isRightClickedTrackLiked && type !== 'cloudDisk'"
        class="item"
        @click="like"
      >
        {{ $t('contextMenu.removeFromMyLikedSongs') }}
      </div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromPlaylist')"
        class="item"
        @click="removeTrackFromPlaylist"
        >从歌单中删除</div
      >
      <div
        v-show="type !== 'cloudDisk'"
        class="item"
        @click="addTrackToPlaylist"
        >{{ $t('contextMenu.addToPlaylist') }}</div
      >
      <div v-show="type !== 'cloudDisk'" class="item" @click="copyLink">{{
        $t('contextMenu.copyUrl')
      }}</div>
      <div v-show="type !== 'cloudDisk'" class="item" @click="downloadSong">{{
        $t('contextMenu.download')
      }}</div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromCloudDisk')"
        class="item"
        @click="removeTrackFromCloudDisk"
        >从云盘中删除</div
      >
      <div
        v-if="type === 'downloads'"
        class="item"
        @click="deleteDownloadedTrack"
        >{{ $t('download.deleteFile') }}</div
      >
    </ContextMenu>

    <div ref="list" :style="listStyles">
      <div v-if="virtualized" :style="topSpacerStyle"></div>
      <TrackListItem
        v-for="entry in renderedTracks"
        :key="`${entry.track.id || entry.track.songId}-${entry.index}`"
        :track-prop="entry.track"
        :track-no="entry.index + 1"
        :highlight-playing-track="highlightPlayingTrack"
        @dblclick="playThisList(entry.track.id || entry.track.songId)"
        @click.right="openMenu($event, entry.track, entry.index)"
      />
      <div v-if="virtualized" :style="bottomSpacerStyle"></div>
    </div>
  </div>
</template>

<script>
import { mapActions, mapMutations, mapState } from 'vuex';
import { addOrRemoveTrackFromPlaylist } from '@/api/playlist';
import { cloudDiskTrackDelete } from '@/api/user';
import { isAccountLoggedIn } from '@/utils/auth';

import TrackListItem from '@/components/TrackListItem.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import locale from '@/locale';
import { downloadTrack, removeDownloadedTrack } from '@/utils/download';

export default {
  name: 'TrackList',
  components: {
    TrackListItem,
    ContextMenu,
  },
  props: {
    tracks: {
      type: Array,
      default: () => {
        return [];
      },
    },
    type: {
      type: String,
      default: 'tracklist',
    }, // tracklist | album | playlist | cloudDisk
    id: {
      type: Number,
      default: 0,
    },
    dbclickTrackFunc: {
      type: String,
      default: 'default',
    },
    albumObject: {
      type: Object,
      default: () => {
        return {
          artist: {
            name: '',
          },
        };
      },
    },
    extraContextMenuItem: {
      type: Array,
      default: () => {
        return [
          // 'removeTrackFromPlaylist'
          // 'removeTrackFromQueue'
          // 'removeTrackFromCloudDisk'
        ];
      },
    },
    columnNumber: {
      type: Number,
      default: 4,
    },
    highlightPlayingTrack: {
      type: Boolean,
      default: true,
    },
    itemKey: {
      type: String,
      default: 'id',
    },
  },
  data() {
    return {
      rightClickedTrack: {
        id: 0,
        name: '',
        ar: [{ name: '' }],
        al: { picUrl: '' },
      },
      rightClickedTrackIndex: -1,
      listStyles: {},
      visibleStart: 0,
      visibleEnd: 80,
      scrollFrame: 0,
    };
  },
  computed: {
    ...mapState(['liked', 'player', 'settings']),
    isRightClickedTrackLiked() {
      return this.liked.songs.includes(this.rightClickedTrack?.id);
    },
    rightClickedTrackComputed() {
      return this.type === 'cloudDisk'
        ? {
            id: 0,
            name: '',
            ar: [{ name: '' }],
            al: { picUrl: '' },
          }
        : this.rightClickedTrack;
    },
    menuCoverUrl() {
      const picUrl =
        this.rightClickedTrackComputed?.al?.picUrl ||
        this.rightClickedTrackComputed?.album?.picUrl ||
        '';
      if (!picUrl) return '';
      return picUrl.includes('?') ? picUrl : `${picUrl}?param=224y224`;
    },
    rightClickedTrackArtistName() {
      return (
        this.rightClickedTrackComputed?.ar?.[0]?.name ||
        this.rightClickedTrackComputed?.artists?.[0]?.name ||
        ''
      );
    },
    virtualized() {
      // A 200-track page used to miss virtualization because the threshold was
      // strictly greater than 200. That kept every Vue row, icon and listener
      // alive on the common first page returned by the playlist API.
      return this.type !== 'tracklist' && this.tracks.length >= 100;
    },
    itemHeight() {
      return this.type === 'album' ? 48 : 64;
    },
    renderedTracks() {
      const start = this.virtualized ? this.visibleStart : 0;
      const end = this.virtualized ? this.visibleEnd : this.tracks.length;
      return this.tracks.slice(start, end).map((track, offset) => ({
        track,
        index: start + offset,
      }));
    },
    topSpacerStyle() {
      return { height: `${this.visibleStart * this.itemHeight}px` };
    },
    bottomSpacerStyle() {
      return {
        height: `${
          Math.max(0, this.tracks.length - this.visibleEnd) * this.itemHeight
        }px`,
      };
    },
  },
  watch: {
    tracks() {
      this.visibleStart = 0;
      this.visibleEnd = 80;
      this.$nextTick(this.updateViewport);
    },
  },
  created() {
    if (this.type === 'tracklist') {
      this.listStyles = {
        display: 'grid',
        gap: '4px',
        gridTemplateColumns: `repeat(${this.columnNumber}, 1fr)`,
      };
    }
  },
  mounted() {
    this.scrollContainer = document.querySelector('main');
    this.scrollContainer?.addEventListener(
      'scroll',
      this.scheduleViewportUpdate,
      {
        passive: true,
      }
    );
    window.addEventListener('resize', this.scheduleViewportUpdate, {
      passive: true,
    });
    this.$nextTick(this.updateViewport);
  },
  activated() {
    this.$nextTick(this.updateViewport);
  },
  beforeUnmount() {
    this.scrollContainer?.removeEventListener(
      'scroll',
      this.scheduleViewportUpdate
    );
    window.removeEventListener('resize', this.scheduleViewportUpdate);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
  },
  methods: {
    ...mapMutations(['updateModal']),
    ...mapActions(['nextTrack', 'showToast', 'likeATrack']),
    scheduleViewportUpdate() {
      if (!this.virtualized || this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.updateViewport();
      });
    },
    updateViewport() {
      if (!this.virtualized || !this.$refs.list || !this.scrollContainer) {
        this.visibleStart = 0;
        this.visibleEnd = this.tracks.length;
        return;
      }
      const listRect = this.$refs.list.getBoundingClientRect();
      const viewportRect = this.scrollContainer.getBoundingClientRect();
      const overscan = 20;
      const firstVisible = Math.floor(
        (viewportRect.top - listRect.top) / this.itemHeight
      );
      const visibleCount = Math.ceil(viewportRect.height / this.itemHeight);
      this.visibleStart = Math.max(0, firstVisible - overscan);
      this.visibleEnd = Math.min(
        this.tracks.length,
        Math.max(
          visibleCount + overscan * 2,
          firstVisible + visibleCount + overscan
        )
      );
    },
    openMenu(e, track, index = -1) {
      this.rightClickedTrack = track;
      this.rightClickedTrackIndex = index;
      this.$refs.menu.openMenu(e);
    },
    closeMenu() {
      this.rightClickedTrack = {
        id: 0,
        name: '',
        ar: [{ name: '' }],
        al: { picUrl: '' },
      };
      this.rightClickedTrackIndex = -1;
    },
    playThisList(trackID) {
      if (this.dbclickTrackFunc !== 'none') {
        // Switch the UI to the picked song at once; audio loads behind it.
        const entry = this.tracks.find(t => (t.id || t.songId) === trackID);
        this.player.previewTrack?.(entry?.simpleSong ?? entry);
      }
      if (this.dbclickTrackFunc === 'default') {
        this.playThisListDefault(trackID);
      } else if (this.dbclickTrackFunc === 'none') {
        // do nothing
      } else if (this.dbclickTrackFunc === 'playTrackOnListByID') {
        this.player.playTrackOnListByID(trackID);
      } else if (this.dbclickTrackFunc === 'playPlaylistByID') {
        this.player.playPlaylistByID(this.id, trackID);
      } else if (this.dbclickTrackFunc === 'playAList') {
        let trackIDs = this.tracks.map(t => t.id || t.songId);
        this.player.replacePlaylist(trackIDs, this.id, 'artist', trackID);
      } else if (this.dbclickTrackFunc === 'dailyTracks') {
        let trackIDs = this.tracks.map(t => t.id);
        this.player.replacePlaylist(trackIDs, '/daily/songs', 'url', trackID);
      } else if (this.dbclickTrackFunc === 'playCloudDisk') {
        let trackIDs = this.tracks.map(t => t.id || t.songId);
        this.player.replacePlaylist(trackIDs, this.id, 'cloudDisk', trackID);
      } else if (this.dbclickTrackFunc === 'playDownloads') {
        let trackIDs = this.tracks.map(t => t.id || t.songId);
        this.player.replacePlaylist(trackIDs, this.id, 'downloads', trackID);
      }
    },
    playThisListDefault(trackID) {
      if (this.type === 'playlist') {
        this.player.playPlaylistByID(this.id, trackID);
      } else if (this.type === 'album') {
        this.player.playAlbumByID(this.id, trackID);
      } else if (this.type === 'tracklist' || this.type === 'downloads') {
        let trackIDs = this.tracks.map(t => t.id);
        this.player.replacePlaylist(
          trackIDs,
          this.id,
          this.type === 'downloads' ? 'downloads' : 'artist',
          trackID
        );
      }
    },
    play() {
      this.player.addTrackToPlayNext(this.rightClickedTrack.id, true);
    },
    addToQueue() {
      this.player.addTrackToPlayNext(this.rightClickedTrack.id);
    },
    like() {
      this.likeATrack(this.rightClickedTrack.id);
    },
    addTrackToPlaylist() {
      if (!isAccountLoggedIn()) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'show',
        value: true,
      });
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'selectedTrackID',
        value: this.rightClickedTrack.id,
      });
    },
    removeTrackFromPlaylist() {
      if (!isAccountLoggedIn()) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      const track = this.rightClickedTrack;
      this.$refs.menu?.closeMenu();
      if (!track || !track.id) return;
      setTimeout(() => {
        if (confirm(`确定要从歌单删除 ${track.name}？`)) {
          let trackID = track.id;
          addOrRemoveTrackFromPlaylist({
            op: 'del',
            pid: this.id,
            tracks: trackID,
          }).then(data => {
            this.showToast(
              data.body.code === 200
                ? locale.t('toast.removedFromPlaylist')
                : data.body.message
            );
            this.$parent.removeTrack(trackID);
          });
        }
      }, 20);
    },
    copyLink() {
      this.$copyText(
        `https://music.163.com/song?id=${this.rightClickedTrack.id}`
      )
        .then(() => {
          this.showToast(locale.t('toast.copied'));
        })
        .catch(err => {
          this.showToast(`${locale.t('toast.copyFailed')}${err}`);
        });
    },
    downloadSong() {
      const track = this.rightClickedTrack;
      if (!track || !track.id) return;
      if (this.settings.askBeforeDownload === false) {
        const quality = this.settings.downloadQuality || 320000;
        downloadTrack(track, quality);
      } else {
        this.updateModal({
          modalName: 'downloadTrackModal',
          key: 'selectedTrack',
          value: track,
        });
        this.updateModal({
          modalName: 'downloadTrackModal',
          key: 'show',
          value: true,
        });
      }
    },
    removeTrackFromQueue() {
      this.$store.state.player.removeTrackFromQueue(
        this.rightClickedTrackIndex
      );
    },
    removeTrackFromCloudDisk() {
      const track = this.rightClickedTrack;
      this.$refs.menu?.closeMenu();
      if (!track) return;
      setTimeout(() => {
        if (confirm(`确定要从云盘删除 ${track.songName}？`)) {
          let trackID = track.songId;
          cloudDiskTrackDelete(trackID).then(data => {
            this.showToast(
              data.code === 200 ? '已将此歌曲从云盘删除' : data.message
            );
            let newCloudDisk = this.liked.cloudDisk.filter(
              t => t.songId !== trackID
            );
            this.$store.commit('updateLikedXXX', {
              name: 'cloudDisk',
              data: newCloudDisk,
            });
          });
        }
      }, 20);
    },
    deleteDownloadedTrack() {
      const track = this.rightClickedTrack;
      this.$refs.menu?.closeMenu();
      if (!track) return;
      setTimeout(async () => {
        if (confirm(`确定要从本地删除 ${track.name} 吗？`)) {
          const removed = await removeDownloadedTrack(track);
          this.showToast(removed ? '已从本地删除' : '删除本地文件失败');
        }
      }, 20);
    },
  },
};
</script>

<style lang="scss" scoped></style>
