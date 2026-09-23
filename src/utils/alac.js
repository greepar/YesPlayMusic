// Called only for M4A uploads in the cloud disk. The MP4 sample entry, not
// the file extension, tells us whether Chromium needs help decoding it.
export async function prepareCloudM4a(source, signal) {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const view = new DataView(bytes.buffer);
  let moov = -1;
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'moov') {
      moov = offset;
      break;
    }
    if (size < 8) break;
    offset += size;
  }
  if (moov < 0 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp')
    throw new Error('Invalid M4A');
  // 'alac' appears in the sample description near the start of moov. An
  // AAC M4A goes straight to Chromium; it does not load the decoder.
  const description = new TextDecoder('latin1').decode(
    bytes.subarray(moov, Math.min(bytes.length, moov + 65536))
  );
  if (!description.includes('alac')) return null;

  const { default: decode } = await import('@audio/decode-aac');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { channelData, sampleRate } = await decode(bytes);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const channels = channelData.length;
  const frames = channelData[0]?.length;
  if (!channels || !frames || !sampleRate) throw new Error('Empty ALAC audio');

  // A seekable 16-bit WAV lets the existing Howler controls handle playback,
  // volume, pause and seeking without maintaining a second player engine.
  const dataSize = frames * channels * 2;
  const wav = new ArrayBuffer(44 + dataSize);
  const header = new DataView(wav);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++)
      header.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  header.setUint32(4, dataSize + 36, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * channels * 2, true);
  header.setUint16(32, channels * 2, true);
  header.setUint16(34, 16, true);
  write(36, 'data');
  header.setUint32(40, dataSize, true);
  const pcm = new DataView(wav, 44);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, channelData[channel][i]));
      pcm.setInt16(
        offset,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true
      );
      offset += 2;
    }
  }
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}
