const path = require('path');
const webpack = require('webpack');
function resolve(dir) {
  return path.join(__dirname, dir);
}

module.exports = {
  lintOnSave: false,
  // 生产环境打包不输出 map
  productionSourceMap: false,
  devServer: {
    allowedHosts: 'all',
    port: process.env.DEV_SERVER_PORT || 8080,
    proxy: {
      '^/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        pathRewrite: {
          '^/api': '/',
        },
      },
    },
  },
  pwa: {
    name: 'YesPlayMusic',
    iconPaths: {
      favicon32: 'img/icons/favicon-32x32.png',
    },
    themeColor: '#ffffff00',
    manifestOptions: {
      background_color: '#335eea',
    },
    // workboxOptions: {
    //   swSrc: "dev/sw.js",
    // },
  },
  pages: {
    index: {
      entry: 'src/main.js',
      template: 'public/index.html',
      filename: 'index.html',
      title: 'YesPlayMusic',
      chunks: ['main', 'chunk-vendors', 'chunk-common', 'index'],
    },
    audio: {
      entry: 'src/audioHost.ts',
      template: 'public/audio.html',
      filename: 'audio.html',
      chunks: ['chunk-vendors', 'chunk-common', 'audio'],
    },
  },
  chainWebpack(config) {
    // webpack 5 不再自带 Node 核心模块的 polyfill。
    // 网页版不会真正用到这些模块（相关代码都在 IS_ELECTRON 分支里），置空即可
    config.merge({
      resolve: {
        extensions: ['.ts', '.js', '.vue', '.json'],
        fallback: { fs: false, path: false, child_process: false },
      },
    });
    // Electron 20+ does not expose Node's process in sandboxed renderers.
    // Provide the browser shim for dependencies expecting process.
    config
      .plugin('provide-process')
      .use(webpack.ProvidePlugin, [{ process: 'process/browser' }]);

    config.module.rule('svg').exclude.add(resolve('src/assets/icons')).end();
    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(resolve('src/assets/icons'))
      .end()
      .use('svg-sprite-loader')
      .loader('svg-sprite-loader')
      .options({
        symbolId: 'icon-[name]',
      })
      .end();
    config.module
      .rule('napi')
      .test(/\.node$/)
      .use('node-loader')
      .loader('node-loader')
      .end();

    // Vue CLI's TypeScript plugin is tied to the pre-TypeScript-7 compiler
    // API. esbuild handles the small number of .ts files in this legacy build
    // until the webpack/Vue CLI layer is replaced.
    config.module
      .rule('typescript')
      .test(/\.ts$/)
      .exclude.add(/node_modules/)
      .end()
      .use('esbuild-loader')
      .loader('esbuild-loader')
      .options({ loader: 'ts', target: 'es2020' });

    // css-loader 6 会把 url(/img/xx.png) 当作文件系统路径去解析。
    // 这类以 / 开头的地址指向 public/ 下原样提供的静态资源，保持原样即可
    ['css', 'postcss', 'scss', 'sass'].forEach(name => {
      const rule = config.module.rules.has(name) && config.module.rule(name);
      if (!rule) return;
      ['vue-modules', 'vue', 'normal-modules', 'normal'].forEach(type => {
        if (!rule.oneOfs.has(type) || !rule.oneOf(type).uses.has('css-loader'))
          return;
        rule
          .oneOf(type)
          .use('css-loader')
          .tap(options => ({
            ...options,
            url: { filter: url => !url.startsWith('/') },
          }));
      });
    });
  },
  // 添加插件的配置
  pluginOptions: {
    // electron-builder的配置文件
    electronBuilder: {
      nodeIntegration: true,
      // 页面由 express 通过 http://localhost:27232 提供，资源用相对路径即可。
      // 默认的 app://./ 在新版 Chromium 下会因跨域（CORS）被拦截导致白屏
      customFileProtocol: './',
      // 安装了 TypeScript 插件后，插件默认会去找 src/background.ts，这里显式指定
      mainProcessFile: 'src/background.js',
      preload: 'src/preload.js',
      builderOptions: {
        productName: 'YesPlayMusic',
        copyright: 'Copyright © YesPlayMusic',
        // compression: "maximum", // 机器好的可以打开，配置压缩，开启后会让 .AppImage 格式的客户端启动缓慢
        asar: true,
        // 只保留应用支持的语言，去掉 Electron 自带的 200+ 个语言包（约 70MB）。
        // electron-builder 按文件名匹配：macOS 是 zh_CN.lproj（下划线），
        // Windows/Linux 是 zh-CN.pak（连字符），且必须保留 en-US.pak 作为兜底，两种写法都要列
        electronLanguages: [
          'en',
          'en-US',
          'en_US',
          'zh-CN',
          'zh_CN',
          'zh-TW',
          'zh_TW',
          'tr',
        ],
        // 主进程和渲染进程的代码都已被 webpack 打包，运行时不需要任何 node_modules。
        // 不加这个白名单时 electron-builder 会把整个依赖树（500+ 个包，160MB）塞进 app.asar
        files: ['**', '!node_modules/**/*'],
        publish: [
          {
            provider: 'github',
            owner: 'greepar',
            repo: 'YesPlayMusic',
            vPrefixedTagName: true,
            releaseType: 'draft',
          },
        ],
        directories: {
          output: 'dist_electron',
        },
        mac: {
          target: [
            {
              target: 'dmg',
              arch: ['x64', 'arm64'],
            },
          ],
          // 没有 Developer ID 证书时（如 CI）electron-builder 会直接跳过签名，
          // 下载后的 arm64 应用会被 Gatekeeper 提示「已损坏」。
          // 这里显式使用 ad-hoc 签名；提供 CSC_LINK / CSC_NAME 时则使用真实证书。
          identity:
            process.env.CSC_LINK || process.env.CSC_NAME ? undefined : '-',
          hardenedRuntime: !!(process.env.CSC_LINK || process.env.CSC_NAME),
          artifactName: '${productName}-${os}-${version}-${arch}.${ext}',
          category: 'public.app-category.music',
          darkModeSupport: true,
        },
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64'],
            },
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
          // 没有代码签名证书：跳过签名，但仍然写入图标和版本信息。
          // （不要用 signAndEditExecutable: false，那会连图标一起丢掉。）
          // 也不要设置 publisherName：它用于校验已签名构建的自动更新
          signExecutable: false,
          icon: 'build/icons/icon.ico',
          publish: ['github'],
        },
        linux: {
          // 只发布 AppImage（x64 / arm64）。Electron 44 没有 armv7l 的官方构建；
          // 同时构建多种格式时 electron-builder 的缓存目录会发生竞争
          target: [
            {
              target: 'AppImage',
              arch: ['x64', 'arm64'],
            },
          ],
          category: 'Music',
          icon: './build/icon.icns',
        },
        dmg: {
          icon: 'build/icons/icon.icns',
          // bzip2 压缩，比默认的 zlib（UDZO）更小
          format: 'UDBZ',
        },
        nsis: {
          oneClick: true,
          perMachine: true,
          deleteAppDataOnUninstall: true,
        },
      },
      // 主线程的配置文件
      chainWebpackMainProcess: config => {
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
        config.resolve.alias.set(
          'jsbi',
          path.join(__dirname, 'node_modules/jsbi/dist/jsbi-cjs.js')
        );
      },
      // 渲染线程的配置文件
      chainWebpackRendererProcess: config => {
        // 渲染线程的一些其他配置
        // Chain webpack config for electron renderer process only
        // The following example will set IS_ELECTRON to true in your app
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
      },
      // 主入口文件
      // mainProcessFile: 'src/main.js',
      // mainProcessArgs: []
    },
  },
};
