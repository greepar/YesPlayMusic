const RELEASE_API =
  'https://api.github.com/repos/greepar/YesPlayMusic/releases/latest';
const RELEASE_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'YesPlayMusic-Updater',
  'X-GitHub-Api-Version': '2022-11-28',
};

function releaseVersion(release) {
  if (
    release.draft ||
    release.prerelease ||
    !/^v?\d+\.\d+\.\d+$/.test(release.tag_name || '')
  ) {
    throw new Error('GitHub Release 不是有效的正式版 tag。');
  }
  return release.tag_name.replace(/^v/, '');
}

function isNewerVersion(version, current) {
  const parse = value => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`无效版本号：${value}`);
    return value.split('.').map(BigInt);
  };
  const left = parse(version);
  const right = parse(current);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

async function latestRelease(fetchRelease) {
  const response = await fetchRelease(RELEASE_API, {
    headers: RELEASE_HEADERS,
  });
  if (!response.ok)
    throw new Error(`GitHub 更新检查失败（HTTP ${response.status}）`);
  const release = await response.json();
  return { ...release, version: releaseVersion(release) };
}

function appImageUpdateInfo(
  release,
  arch,
  repositoryUrl = 'https://github.com/greepar/YesPlayMusic'
) {
  const version = releaseVersion(release);
  if (!['x64', 'arm64'].includes(arch))
    throw new Error(`不支持自动更新的架构：${arch}`);
  const names = [`YesPlayMusic-${version}-${arch}.AppImage`];
  if (arch === 'x64') {
    names.push(
      `YesPlayMusic-${version}-x86_64.AppImage`,
      `YesPlayMusic-${version}.AppImage`
    );
  }
  return releaseAssetUpdateInfo(
    release,
    names,
    `${arch} AppImage`,
    repositoryUrl
  );
}

function windowsUpdateInfo(
  release,
  arch,
  repositoryUrl = 'https://github.com/greepar/YesPlayMusic'
) {
  const version = releaseVersion(release);
  if (arch !== 'x64') throw new Error(`不支持自动更新的 Windows 架构：${arch}`);
  const info = releaseAssetUpdateInfo(
    release,
    [`YesPlayMusic.Setup.${version}.exe`, `YesPlayMusic Setup ${version}.exe`],
    'Windows x64 安装包',
    repositoryUrl
  );
  // Matches nsis.perMachine=true. NsisUpdater must launch elevate.exe so
  // Windows can request UAC before replacing a Program Files installation.
  info.files[0].isAdminRightsRequired = true;
  return info;
}

function releaseAssetUpdateInfo(release, names, description, repositoryUrl) {
  const version = releaseVersion(release);
  const asset = names
    .map(name => release.assets?.find(file => file.name === name))
    .find(Boolean);
  if (
    !asset ||
    asset.state !== 'uploaded' ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error(`版本 ${release.tag_name} 尚未提供 ${description}。`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) {
    throw new Error('GitHub 未提供有效的安装包校验值，已跳过更新。');
  }
  const expectedUrl = `${repositoryUrl}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
  if (asset.browser_download_url !== expectedUrl)
    throw new Error('安装包下载地址与 Release 不匹配。');
  return {
    version,
    releaseName: release.name || release.tag_name,
    releaseDate: release.published_at,
    files: [
      {
        url: asset.browser_download_url,
        size: asset.size,
        sha2: asset.digest.slice(7),
      },
    ],
  };
}

module.exports = {
  RELEASE_API,
  RELEASE_HEADERS,
  releaseVersion,
  isNewerVersion,
  latestRelease,
  appImageUpdateInfo,
  windowsUpdateInfo,
};
