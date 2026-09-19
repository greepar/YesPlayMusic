import type { PlayerCommand, PlayerSnapshot } from '@/player/protocol';

const store: any = require('@/store').default;
const ipc = window.require('electron').ipcRenderer;
const player: any = store.state.player;
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let version = 0;
let lastSerialized = '';

function snapshot(): PlayerSnapshot {
  const source = player._howler?._src || '';
  return {
    sessionId,
    version: ++version,
    emittedAt: Date.now(),
    playing: player.playing,
    progress: Number(player.seek(null, false) || 0),
    duration: player.currentTrackDuration,
    enabled: player.enabled,
    loading: !!player._loading,
    repeatMode: player.repeatMode,
    shuffle: player.shuffle,
    reversed: player.reversed,
    volume: player.volume,
    currentTrack: player.currentTrack,
    currentTrackID: player.currentTrackID,
    playlistSource: player.playlistSource,
    list: [...player.list],
    current: player.current,
    playNextList: [...player.playNextList],
    isPersonalFM: player.isPersonalFM,
    personalFMTrack: player.personalFMTrack,
    isCurrentTrackLiked: player.isCurrentTrackLiked,
    sourceKind:
      typeof source === 'string' && source.includes('kuwo.cn') ? 'kuwo' : '',
  };
}

function publish(force = false) {
  const next = snapshot();
  const serialized = JSON.stringify({
    ...next,
    version: 0,
    emittedAt: 0,
    progress: next.playing ? 0 : next.progress,
  });
  if (force || serialized !== lastSerialized || next.playing) {
    lastSerialized = serialized;
    ipc.send('player:snapshot', next);
  }
}

ipc.on('player:command', async (_: unknown, command: PlayerCommand) => {
  try {
    let value;
    if (command.name === 'setProperty') {
      const [property, next] = command.args;
      player[property as string] = next;
    } else {
      value = await player[command.name](...command.args);
    }
    publish(true);
    ipc.send('player:result', {
      requestId: command.requestId,
      sessionId,
      ok: true,
      version,
      value,
    });
  } catch (error) {
    ipc.send('player:result', {
      requestId: command.requestId,
      sessionId,
      ok: false,
      version,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
ipc.on('player:request-snapshot', () => publish(true));
ipc.on('play', () => player.playOrPause());
ipc.on('next', () =>
  player.isPersonalFM ? player.playNextFMTrack() : player.playNextTrack()
);
ipc.on('previous', () => player.playPrevTrack());
ipc.on('increaseVolume', () => {
  player.volume = Math.min(1, player.volume + 0.1);
});
ipc.on('decreaseVolume', () => {
  player.volume = Math.max(0, player.volume - 0.1);
});
ipc.on('repeat', () => player.switchRepeatMode());
ipc.on('shuffle', () => player.switchShuffle());
ipc.on('settings-sync', (_: unknown, settings: any) => {
  store.state.settings = settings;
  player.setOutputDevice();
});
ipc.on('player:restore', (_: unknown, previous: PlayerSnapshot) => {
  let attempts = 0;
  const restore = setInterval(() => {
    attempts += 1;
    if (player._howler) {
      clearInterval(restore);
      player.seek(previous.progress || 0, false);
      if (previous.playing) player.play();
      publish(true);
    } else if (attempts >= 20) {
      clearInterval(restore);
    }
  }, 250);
});
ipc.send('player:host-ready', sessionId);
publish(true);
setInterval(() => publish(), 250);
