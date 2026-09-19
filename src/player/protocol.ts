export const PLAYER_COMMANDS = [
  'play',
  'pause',
  'playOrPause',
  'playNextTrack',
  'playNextFMTrack',
  'playPrevTrack',
  'seek',
  'mute',
  'setOutputDevice',
  'replacePlaylist',
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
  'setProperty',
] as const;

export type PlayerCommandName = typeof PLAYER_COMMANDS[number];

export interface PlayerCommand {
  requestId: string;
  sessionId: string;
  name: PlayerCommandName;
  args: unknown[];
}

export interface PlayerCommandResult {
  requestId: string;
  sessionId: string;
  ok: boolean;
  version: number;
  value?: unknown;
  error?: string;
}

export interface PlayerSnapshot {
  sessionId: string;
  version: number;
  emittedAt: number;
  playing: boolean;
  progress: number;
  duration: number;
  enabled: boolean;
  loading: boolean;
  repeatMode: 'off' | 'on' | 'one';
  shuffle: boolean;
  reversed: boolean;
  volume: number;
  currentTrack: any;
  currentTrackID: number;
  playlistSource: any;
  list: number[];
  current: number;
  playNextList: number[];
  isPersonalFM: boolean;
  personalFMTrack: any;
  isCurrentTrackLiked: boolean;
  sourceKind?: string;
}

export interface PlayerProgress {
  sessionId: string;
  emittedAt: number;
  progress: number;
  playing: boolean;
}

export const isPlayerCommand = (value: any): value is PlayerCommand =>
  value &&
  typeof value.requestId === 'string' &&
  typeof value.sessionId === 'string' &&
  PLAYER_COMMANDS.includes(value.name) &&
  Array.isArray(value.args);
