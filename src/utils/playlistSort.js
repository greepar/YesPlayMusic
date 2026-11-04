export function sortPlaylistTracks(tracks, key, direction, locale = 'zh-CN') {
  if (!key) return tracks;
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  });
  const value = track => {
    if (key === 'duration') return track.dt ?? track.duration ?? 0;
    if (key === 'album') return track.al?.name ?? track.album?.name ?? '';
    return track.name ?? '';
  };
  const sign = direction === 'desc' ? -1 : 1;
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const compared =
        key === 'duration'
          ? value(a.track) - value(b.track)
          : collator.compare(value(a.track), value(b.track));
      return compared * sign || a.index - b.index;
    })
    .map(entry => entry.track);
}
