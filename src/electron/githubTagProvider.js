const {
  Provider,
  resolveFiles,
} = require('electron-updater/out/providers/Provider');
const {
  RELEASE_API,
  RELEASE_HEADERS,
  appImageUpdateInfo,
  windowsUpdateInfo,
} = require('./githubRelease');

class GitHubTagProvider extends Provider {
  constructor(options, updater, runtimeOptions) {
    super(runtimeOptions);
    this.options = options;
    this.platform =
      options.platform || runtimeOptions.platform || process.platform;
  }

  async getLatestVersion() {
    const body = await this.httpRequest(
      new URL(this.options.apiUrl || RELEASE_API),
      RELEASE_HEADERS
    );
    const select =
      this.platform === 'win32' ? windowsUpdateInfo : appImageUpdateInfo;
    return select(
      JSON.parse(body),
      this.options.arch || process.arch,
      this.options.repositoryUrl
    );
  }

  resolveFiles(info) {
    return resolveFiles(info, new URL('https://github.com/'));
  }
}

module.exports = { GitHubTagProvider };
