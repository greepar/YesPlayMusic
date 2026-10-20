const {
  Provider,
  resolveFiles,
} = require('electron-updater/out/providers/Provider');
const {
  RELEASE_API,
  RELEASE_HEADERS,
  appImageUpdateInfo,
} = require('./githubRelease');

class GitHubTagProvider extends Provider {
  constructor(options, updater, runtimeOptions) {
    super(runtimeOptions);
    this.options = options;
  }

  async getLatestVersion() {
    const body = await this.httpRequest(
      new URL(this.options.apiUrl || RELEASE_API),
      RELEASE_HEADERS
    );
    return appImageUpdateInfo(
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
