import Vue from 'vue';
import type { PlayerCommandResult, PlayerSnapshot } from './protocol';

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

  constructor() {
    this.ipc = window.require('electron').ipcRenderer;
    this.state = Vue.observable({
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
    });
    for (const method of METHODS) {
      (this as any)[method] = (...args: unknown[]) =>
        this.command(method, args);
    }
    this.ipc.on('player:snapshot', (_: unknown, snapshot: PlayerSnapshot) =>
      this.applySnapshot(snapshot)
    );
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
    return this.ipc.invoke('player:command', {
      requestId,
      sessionId: this.sessionId,
      name,
      args,
    });
  }

  seek(time: number | null = null, sendMpris = true) {
    if (time !== null) return this.command('seek', [time, sendMpris]);
    return this.progress;
  }

  saveSelfToLocalStorage() {}
  sendSelfToIpcMain() {}

  get progress() {
    if (!this.state.playing) return this.progressBase;
    return Math.min(
      this.state.duration || Infinity,
      this.progressBase + (Date.now() - this.progressAt) / 1000
    );
  }
  set progress(value: number) {
    void this.seek(value);
  }
  get currentTrackDuration() {
    return this.state.duration;
  }

  // Vue 2 observes these prototype accessors when the instance is installed in state.
  get enabled() {
    return this.state.enabled;
  }
  get playing() {
    return this.state.playing;
  }
  get currentTrack() {
    return this.state.currentTrack;
  }
  get currentTrackID() {
    return this.state.currentTrackID;
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
