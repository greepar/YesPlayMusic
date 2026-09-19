
<br />
<p align="center">
  <a href="https://music.qier222.com" target="blank">
    <img src="images/logo.png" alt="Logo" width="156" height="156">
  </a>
  <h2 align="center" style="font-weight: 600">YesPlayMusic</h2>

  <p align="center">
    高颜值的第三方网易云播放器,Electron优化版。
  </p>
</p>


## 📦️ 安装

访问本项目的 [Releases](https://github.com/greepar/YesPlayMusic/releases)
页面下载安装包，目前提供以下平台：

| 平台    | 架构                | 安装包                                                            |
| ------- | ------------------- | ----------------------------------------------------------------- |
| macOS   | Apple 芯片（arm64） | `YesPlayMusic-mac-<版本>-arm64.dmg`                               |
| macOS   | Intel（x64）        | `YesPlayMusic-mac-<版本>-x64.dmg`                                 |
| Windows | x64                 | 安装版 `YesPlayMusic Setup <版本>.exe`、便携版 `YesPlayMusic <版本>.exe` |
| Linux   | x64 / arm64         | `YesPlayMusic-<版本>.AppImage`                                    |

> macOS 安装包使用 ad-hoc 签名（未经 Apple 公证）。首次打开如果被系统拦截，请在
> 「系统设置 → 隐私与安全性」中点击「仍要打开」，或在终端执行
> `xattr -cr /Applications/YesPlayMusic.app`。

## 👷‍♂️ 打包客户端

如果在 Release 页面没有找到适合你的设备的安装包的话，你可以根据下面的步骤来打包自己的客户端。

1. 打包 Electron 需要用到 Node.js（22.12 及以上）和 Yarn。可前往 [Node.js 官网](https://nodejs.org/zh-cn/) 下载安装包。安装 Node.js
   后可在终端里执行 `npm install -g yarn` 来安装 Yarn。

2. 使用 `git clone --recursive https://github.com/greepar/YesPlayMusic.git` 克隆本仓库到本地。

3. 使用 `yarn install` 安装项目依赖。

4. 选择下列表格的命令来打包适合你的安装包，打包出来的文件在 `/dist_electron` 目录下。了解更多信息可访问 [electron-builder 文档](https://www.electron.build/cli)

| 命令                                | 说明                              |
| ----------------------------------- | --------------------------------- |
| `yarn electron:build --mac --arm64` | macOS Apple 芯片（在 macOS 上）   |
| `yarn electron:build --mac --x64`   | macOS Intel（在 macOS 上）        |
| `yarn electron:build --win`         | Windows x64                       |
| `yarn electron:build --linux`       | Linux AppImage（x64 和 arm64）    |

## :computer: 配置开发环境

本项目由 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 提供 API。

运行本项目

```shell
# 安装依赖
yarn install

# 运行（网页端）
yarn serve

# 运行（electron）
yarn electron:serve
```

本地运行 NeteaseCloudMusicApi

```shell
# 运行 API （默认 3000 端口）
yarn netease_api:run
```

## ☑️ Todo

查看 Todo 请访问本项目的 [Projects](https://github.com/qier222/YesPlayMusic/projects/1)

欢迎提 Issue 和 Pull request。

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于原版 YesPlayMusic 开发(https://github.com/qier222/YesPlayMusic)。

基于 [MIT license](https://opensource.org/licenses/MIT) 许可进行开源。