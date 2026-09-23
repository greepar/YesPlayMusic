import type { PlayerCommand, PlayerSnapshot } from '@/player/protocol';

const store: any = require('@/store').default;
const ipc = window.require('electron').ipcRenderer;
const player: any = store.state.player;
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let version = 0;
let lastStateSignature = '';

function snapshot(): PlayerSnapshot {
  const source = player._howler?._src || '';
  return {
    sessionId,
    version,
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

function stateSignature() {
  return JSON.stringify([
    player.currentTrackID,
    player.currentTrack?.name,
    player.currentTrackDuration,
    player.playing,
    !!player._loading,
    player.enabled,
    player.repeatMode,
    player.shuffle,
    player.reversed,
    player.volume,
    player.current,
    player.list.length,
    player.playNextList.length,
    player.isPersonalFM,
    player.personalFMTrack?.id,
    player.isCurrentTrackLiked,
  ]);
}

function publish() {
  lastStateSignature = stateSignature();
  const next = snapshot();
  next.version = ++version;
  // The player lives in Vuex and its nested values are Vue 3 Proxies. Electron
  // IPC accepts plain structured-cloneable data only.
  ipc.send('player:snapshot', JSON.parse(JSON.stringify(next)));
}

function tick() {
  if (stateSignature() !== lastStateSignature) {
    publish();
    return;
  }
  if (!player.playing) return;
  ipc.send('player:progress', {
    sessionId,
    emittedAt: Date.now(),
    progress: Number(player.seek(null, false) || 0),
    playing: true,
  });
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
    publish();
    ipc.send(
      'player:result',
      JSON.parse(
        JSON.stringify({
          requestId: command.requestId,
          sessionId,
          ok: true,
          version,
          value,
        })
      )
    );
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
ipc.on('player:request-snapshot', () => publish());
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
ipc.on('like', async () => {
  await store.dispatch('likeATrack', player.currentTrack.id);
  publish();
});
ipc.on('player:sync-liked', (_: unknown, likedSongs: number[]) => {
  if (Array.isArray(likedSongs)) {
    store.commit('updateLikedXXX', {
      name: 'songs',
      data: likedSongs,
    });
    publish();
  }
});
ipc.on('system-resume', () => {
  if (player.playing && player._howler && !player._howler.playing()) {
    player.play();
  }
  publish();
});
ipc.on('settings-sync', (_: unknown, settings: any) => {
  store.state.settings = settings;
  player.setOutputDevice();
});
ipc.on('player:restore', (_: unknown, previous: PlayerSnapshot) => {
  let attempts = 0;
  const restoreTrackID = previous.currentTrackID;
  const restoreProgress = previous.progress || 0;
  const restore = setInterval(() => {
    attempts += 1;
    if (player._howler) {
      clearInterval(restore);
      // Startup restore is only allowed to set the position while the same
      // track is still at its initial position. A user seek or track change
      // during startup must always win over this delayed timer.
      if (
        player.currentTrackID === restoreTrackID &&
        Number(player.seek(null, false) || 0) < 1
      ) {
        player.seek(restoreProgress, false);
      }
      if (previous.playing) player.play();
      publish();
    } else if (attempts >= 20) {
      clearInterval(restore);
    }
  }, 250);
});
ipc.send('player:host-ready', sessionId);
publish();
Promise.resolve(store.dispatch('fetchLikedSongs')).then(() => publish());
setInterval(tick, 250);
