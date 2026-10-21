const fs = require('node:fs');
const path = require('node:path');

function createReleaseNotes(tag, assetNames) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Invalid release tag: ${tag}`);
  const version = tag.slice(1);
  const link = (names, label) => {
    const name = names.find(name => assetNames.includes(name));
    if (!name) throw new Error(`Missing download artifact: ${names.join(' or ')}`);
    return `[${label}](https://github.com/greepar/YesPlayMusic/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)})`;
  };
  return `### 📥 快速下载

**Windows**

- 普通 Intel / AMD 电脑：${link([`YesPlayMusic.Setup.${version}-x64.exe`], '下载 x64 安装版')}
- ARM 电脑（如骁龙设备）：${link([`YesPlayMusic.Setup.${version}-arm64.exe`], '下载 ARM64 安装版')}
- 免安装版：${link([`YesPlayMusic.${version}-x64.exe`], 'x64')} · ${link([`YesPlayMusic.${version}-arm64.exe`], 'ARM64')}

**macOS**

- Apple 芯片（M 系列）：${link([`YesPlayMusic-mac-${version}-arm64.dmg`], '下载安装包')}
- Intel 芯片：${link([`YesPlayMusic-mac-${version}-x64.dmg`], '下载安装包')}

**Linux**

- 普通 Intel / AMD 电脑：${link([`YesPlayMusic-${version}-x86_64.AppImage`, `YesPlayMusic-${version}-x64.AppImage`, `YesPlayMusic-${version}.AppImage`], '下载 x86_64 AppImage')}
- ARM 设备：${link([`YesPlayMusic-${version}-arm64.AppImage`], '下载 ARM64 AppImage')}

> 已安装支持自动更新的版本，可直接在应用内检查更新。

---
`;
}

if (require.main === module) {
  const [tag, directory, output] = process.argv.slice(2);
  if (!tag || !directory || !output) throw new Error('Usage: node build/release-notes.cjs <tag> <assets-directory> <output>');
  fs.writeFileSync(output, createReleaseNotes(tag, fs.readdirSync(directory)));
}
module.exports = { createReleaseNotes };
