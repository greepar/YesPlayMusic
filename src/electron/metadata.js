const fs = require('fs');
const path = require('path');
const log = require('electron-log');

/**
 * 注入音频元数据（ID3 标签 / Vorbis Comment / 封面图）
 * @param {string} filePath 本地音频文件路径
 * @param {object} metadata 元数据对象 { title, artist, album, coverUrl, year }
 */
async function injectMetadata(filePath, metadata) {
  if (!filePath || !metadata || !fs.existsSync(filePath)) {
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mp3' && ext !== '.flac') {
    return;
  }

  // 1. 获取封面图 Buffer
  let coverBuffer = null;
  let coverMime = 'image/jpeg';
  if (metadata.coverUrl) {
    try {
      // 网易云封面常为 http，保证带尺寸参数以获取高质量封面
      let coverUrl = metadata.coverUrl;
      if (coverUrl.includes('126.net') && !coverUrl.includes('?param=')) {
        coverUrl += '?param=600y600';
      }
      const response = await fetch(coverUrl);
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        coverBuffer = Buffer.from(arrayBuf);
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('png')) {
          coverMime = 'image/png';
        }
      }
    } catch (e) {
      log.warn(`[Metadata] Failed to fetch cover image: ${e.message}`);
    }
  }

  // 2. MP3 注入 ID3v2 标签
  if (ext === '.mp3') {
    try {
      const NodeID3 = require('node-id3');
      const tags = {
        title: metadata.title || '',
        artist: metadata.artist || '',
        album: metadata.album || '',
      };
      if (metadata.year) {
        tags.year = String(metadata.year);
      }
      if (coverBuffer) {
        tags.image = {
          mime: coverMime,
          type: { id: 3, name: 'front cover' },
          description: 'Front Cover',
          imageBuffer: coverBuffer,
        };
      }
      const success = NodeID3.write(tags, filePath);
      if (success) {
        log.info(`[Metadata] Successfully wrote ID3 tags to ${filePath}`);
      } else {
        log.warn(`[Metadata] NodeID3.write returned false for ${filePath}`);
      }
    } catch (err) {
      log.error(`[Metadata] Error writing ID3 tags: ${err.message}`);
    }
  }

  // 3. FLAC 注入 Vorbis Comments 与 PICTURE
  if (ext === '.flac') {
    try {
      const Metaflac = require('metaflac-js2');
      const flac = new Metaflac(filePath);
      if (metadata.title) flac.setTag(`TITLE=${metadata.title}`);
      if (metadata.artist) flac.setTag(`ARTIST=${metadata.artist}`);
      if (metadata.album) flac.setTag(`ALBUM=${metadata.album}`);
      if (metadata.year) flac.setTag(`DATE=${metadata.year}`);

      if (coverBuffer) {
        try {
          flac.importPicture(coverBuffer);
        } catch (picErr) {
          log.warn(`[Metadata] Failed to import picture to FLAC: ${picErr.message}`);
        }
      }
      flac.save();
      log.info(`[Metadata] Successfully wrote Vorbis comments to ${filePath}`);
    } catch (err) {
      log.error(`[Metadata] Error writing FLAC tags: ${err.message}`);
    }
  }
}

module.exports = {
  injectMetadata,
};
