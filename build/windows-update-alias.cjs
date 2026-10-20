const fs = require('node:fs/promises');
const path = require('node:path');

// Released x64 updaters only recognize the original filename. Keep that asset
// alongside the architecture-specific installer so existing installs can update.
module.exports = async ({ artifactPaths }) => {
  const aliases = [];
  for (const artifact of artifactPaths) {
    if (!/^YesPlayMusic\.Setup\.\d+\.\d+\.\d+-x64\.exe$/.test(path.basename(artifact))) continue;
    const alias = artifact.replace(/-x64\.exe$/, '.exe');
    await fs.copyFile(artifact, alias);
    aliases.push(alias);
  }
  return aliases;
};
