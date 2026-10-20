const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadVerifiedFile(
  fetchRelease,
  asset,
  destination,
  onProgress = () => {}
) {
  try {
    if (
      (await fs.stat(destination)).size === asset.size &&
      (await hashFile(destination)) === asset.sha2
    ) {
      onProgress({ percent: 100, transferred: asset.size, total: asset.size });
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.${crypto.randomUUID()}.download`;
  try {
    const response = await fetchRelease(asset.url, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body)
      throw new Error(`更新下载失败（HTTP ${response.status}）`);
    let received = 0;
    let lastProgress = 0;
    const started = Date.now();
    const hash = crypto.createHash('sha256');
    const verify = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > asset.size)
          return callback(new Error('更新文件大小超出 Release 附件记录。'));
        hash.update(chunk);
        const now = Date.now();
        if (now - lastProgress >= 200 || received === asset.size) {
          lastProgress = now;
          onProgress({
            percent: (received / asset.size) * 100,
            transferred: received,
            total: asset.size,
            bytesPerSecond: (received * 1000) / Math.max(1, now - started),
          });
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      verify,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    );
    if (received !== asset.size || hash.digest('hex') !== asset.sha2)
      throw new Error('更新安装包 SHA-256 或大小校验失败。');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { hashFile, downloadVerifiedFile };
