import { reactive } from 'vue';
import type {
  PlayerCommandResult,
  PlayerProgress,
  PlayerSnapshot,
} from './protocol';

const METHODS = [
  'play',
  'pause',
  'playOrPause',
  'playNextTrack',
  'playNextFMTrack',
  'playPrevTrack',
  'mute',
  'setOutputDevice',
  'playAlbumByID',
  'playPlaylistByID',
  'playArtistByID',
  'playTrackOnListByID',
  'playIntelligenceListById',
  'addTrackToPlayNext',
  'playPersonalFM',
  'moveToFMTrash',
  'switchRepeatMode',
  'switchShuffle',
  'switchReversed',
  'clearPlayNextList',
  'removeTrackFromQueue',
  'replacePlaylist',
] as const;

const WRITABLE = new Set([
  'volume',
  'repeatMode',
  'shuffle',
  'reversed',
  'current',
]);

export default class RemotePlayer {
  private ipc: any;
  private sessionId = '';
  private requestSequence = 0;
  private lastVersion = -1;
  private progressBase = 0;
  private progressAt = Date.now();
  private state: any;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ipc = window.require('electron').ipcRenderer;
    this.state = reactive({
      playing: false,
      progress: 0,
      duration: 0,
      enabled: false,
      loading: true,
      repeatMode: 'off',
      shuffle: false,
      reversed: false,
      volume: 1,
      currentTrack: { id: 86827685, ar: [{}], al: {} },
      currentTrackID: 0,
      playlistSource: { type: 'album', id: 123 },
      list: [],
      current: 0,
      playNextList: [],
      isPersonalFM: false,
      personalFMTrack: { id: 0 },
      isCurrentTrackLiked: false,
      sourceKind: '',
      // Track the user just picked, shown (as playing) before the audio host
      // has fetched its details and audio. See previewTrack().
      pendingTrack: null,
    });
    for (const method of METHODS) {
      (this as any)[method] = (...args: unknown[]) =>
        this.command(method, args);
    }
    // Pausing while a picked track is still loading must cancel its autoplay.
    const playOrPause = (this as any).playOrPause;
    (this as any).playOrPause = () => {
      if (!this.state.pendingTrack) return playOrPause();
      this.clearPendingTrack();
      return this.command('pause');
    };
    this.ipc.on('player:snapshot', (_: unknown, snapshot: PlayerSnapshot) =>
      this.applySnapshot(snapshot)
    );
    this.ipc.on('player:progress', (_: unknown, progress: PlayerProgress) => {
      if (!progress || progress.sessionId !== this.sessionId) return;
      this.progressBase = Number(progress.progress) || 0;
      this.progressAt = progress.emittedAt || Date.now();
      this.state.progress = this.progressBase;
      this.state.playing = !!progress.playing;
    });
    this.ipc.on('player:host-ready', (_: unknown, sessionId: string) => {
      this.sessionId = sessionId;
      this.ipc.send('player:subscribe');
    });
    this.ipc.send('player:subscribe');
  }

  private applySnapshot(snapshot: PlayerSnapshot) {
    if (!snapshot || snapshot.version < this.lastVersion) return;
    if (this.sessionId && snapshot.sessionId !== this.sessionId)
      this.lastVersion = -1;
    this.sessionId = snapshot.sessionId;
    this.lastVersion = snapshot.version;
    this.progressBase = snapshot.progress || 0;
    this.progressAt = snapshot.emittedAt || Date.now();
    Object.keys(this.state).forEach(key => {
      if (key in snapshot && key !== 'progress')
        this.state[key] = (snapshot as any)[key];
    });
    this.state.progress = this.progressBase;
    this.reconcilePendingTrack();
  }

  /**
   * Show a track the user just picked right away, as if it were already
   * playing, while the audio host loads its details and audio.
   */
  previewTrack(track: any) {
    if (!track?.id || !track.name) return;
    this.state.pendingTrack = {
      track: JSON.parse(JSON.stringify(track)),
      acknowledged: false,
    };
    this.progressBase = 0;
    this.progressAt = Date.now();
    this.state.progress = 0;
    if (track.dt) this.state.duration = track.dt / 1000;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    // Safety net in case the host never switches to this track.
    this.pendingTimer = setTimeout(() => this.clearPendingTrack(), 15000);
  }

  private clearPendingTrack() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.state.pendingTrack = null;
  }

  private reconcilePendingTrack() {
    const pending = this.state.pendingTrack;
    if (!pending) return;
    if (this.state.currentTrackID === pending.track.id) {
      pending.acknowledged = true;
      // Loaded (playing) or failed: the host state is authoritative again.
      if (!this.state.loading) this.clearPendingTrack();
    } else if (pending.acknowledged) {
      // The host moved on, e.g. skipped an unplayable track.
      this.clearPendingTrack();
    }
  }

  private command(
    name: string,
    args: unknown[] = []
  ): Promise<PlayerCommandResult> {
    const requestId = `${Date.now()}-${++this.requestSequence}`;
    if (name === 'seek' && typeof args[0] === 'number') {
      this.progressBase = args[0] as number;
      this.progressAt = Date.now();
      this.state.progress = args[0];
    }
    const command = {
      requestId,
      sessionId: this.sessionId,
      name,
      args,
    };
    // Component callers may pass Vue 3 Proxies (for example a track). Strip
    // reactivity at the process boundary so Electron can clone the payload.
    return this.ipc.invoke(
      'player:command',
      JSON.parse(JSON.stringify(command))
    );
  }

  seek(time: number | null = null, sendMpris = true) {
    if (time !== null) return this.command('seek', [time, sendMpris]);
    return this.progress;
  }

  saveSelfToLocalStorage() {}
  sendSelfToIpcMain() {}

  get progress() {
    // Read the reactive value, not only the private interpolation base.
    // Progress events update state.progress every 250 ms; using progressBase
    // here left Vue with no changing dependency, so sliders stayed at 0:00
    // while audio continued playing.
    // Don't extrapolate while the host is still buffering (it reports a
    // requested-but-loading track as playing).
    if (!this.state.playing || this.state.loading) return this.state.progress;
    return Math.min(
      this.state.duration || Infinity,
      this.state.progress + (Date.now() - this.progressAt) / 1000
    );
  }
  set progress(value: number) {
    void this.seek(value);
  }
  get currentTrackDuration() {
    return this.state.duration;
  }

  // These accessors depend on the reactive snapshot state above.
  get enabled() {
    return this.state.enabled;
  }
  get playing() {
    return this.state.pendingTrack ? true : this.state.playing;
  }
  get currentTrack() {
    const pending = this.state.pendingTrack?.track;
    const current = this.state.currentTrack;
    // Keep the preview until the host has this track's details.
    if (pending && !(current?.id === pending.id && current.name))
      return pending;
    return current;
  }
  get currentTrackID() {
    return this.state.pendingTrack?.track.id ?? this.state.currentTrackID;
  }
  get playlistSource() {
    return this.state.playlistSource;
  }
  get list() {
    return this.state.list;
  }
  get playNextList() {
    return this.state.playNextList;
  }
  get isPersonalFM() {
    return this.state.isPersonalFM;
  }
  get personalFMTrack() {
    return this.state.personalFMTrack;
  }
  get isCurrentTrackLiked() {
    try {
      const store = (window as any)?.__store__;
      const currentId = this.currentTrack?.id;
      if (store?.state?.liked?.songs && currentId) {
        return store.state.liked.songs.includes(currentId);
      }
    } catch (_) {}
    return this.state.isCurrentTrackLiked;
  }
  get loading() {
    return this.state.loading;
  }
  get sourceKind() {
    return this.state.sourceKind;
  }

  get volume() {
    return this.state.volume;
  }
  set volume(value: number) {
    this.state.volume = value;
    void this.setProperty('volume', value);
  }
  get repeatMode() {
    return this.state.repeatMode;
  }
  set repeatMode(value: string) {
    this.state.repeatMode = value;
    void this.setProperty('repeatMode', value);
  }
  get shuffle() {
    return this.state.shuffle;
  }
  set shuffle(value: boolean) {
    this.state.shuffle = value;
    void this.setProperty('shuffle', value);
  }
  get reversed() {
    return this.state.reversed;
  }
  set reversed(value: boolean) {
    this.state.reversed = value;
    void this.setProperty('reversed', value);
  }
  get current() {
    return this.state.current;
  }
  set current(value: number) {
    this.state.current = value;
    void this.setProperty('current', value);
  }

  private setProperty(name: string, value: unknown) {
    if (!WRITABLE.has(name)) return Promise.resolve();
    return this.command('setProperty', [name, value]);
  }
}
