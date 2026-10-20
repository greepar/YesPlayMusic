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

| 平台    | 架构                | 安装包                                                                   |
| ------- | ------------------- | ------------------------------------------------------------------------ |
| macOS   | Apple 芯片（arm64） | `YesPlayMusic-mac-<版本>-arm64.dmg`                                      |
| macOS   | Intel（x64）        | `YesPlayMusic-mac-<版本>-x64.dmg`                                        |
| Windows | x64                 | 安装版 `YesPlayMusic Setup <版本>.exe`、便携版 `YesPlayMusic <版本>.exe` |
| Linux   | x64 / arm64         | `YesPlayMusic-<版本>.AppImage`                                           |

> macOS 安装包使用 ad-hoc 签名（未经 Apple 公证）。首次打开如果被系统拦截，请在
> 「系统设置 → 隐私与安全性」中点击「仍要打开」，或在终端执行
> `xattr -cr /Applications/YesPlayMusic.app`。

### Linux AppImage 自动更新

AppImage 启动后及运行期间每 6 小时检查正式版更新，自动下载并校验安装包。
下载完成后选择“重启并更新”即可替换 AppImage 本体；选择“稍后”不会中断播放，
也不会在退出时自动安装，下次启动时会再次提醒。网络或下载错误不会影响当前版本。

AppImage 文件及其所在目录必须可写。推荐放在
`~/.local/share/yesplaymusic/YesPlayMusic.AppImage`，并让桌面启动图标指向这个路径。
文件名不要包含版本号，以便更新后保持启动路径不变。放在 root 管理的 `/opt` 或
`/usr` 时，请先移到用户目录；应用不会自行提权修改系统文件。
Windows、macOS 和 Linux 均直接根据 GitHub 正式版 Release 的 tag 检测更新，
无需 `latest.yml` / `latest-linux.yml`。Linux 按架构选择 Release 中的 AppImage，
并使用 GitHub API 提供的 SHA-256 摘要校验安装包；缺少摘要时拒绝安装。
macOS 按 Intel / Apple 芯片架构选择 ZIP 更新附件，DMG 用于首次安装。

下载更新时，Windows 任务栏、macOS Dock 和支持 LauncherEntry D-Bus API 的 Linux
Dock / 任务栏显示系统进度条，完成或失败后清除。设置页“软件更新”同步显示下载百分比，
Linux 桌面不支持系统进度条时仍可在此查看。安装阶段显示正在安装，不虚构安装百分比。

### macOS 自动更新

设置中的“自动检查更新”默认开启，启动后及每 6 小时根据 Release tag 检查更新，
先弹出“下载并安装 / 稍后”。关闭开关后不再自动检查，仍可点击“检查更新”手动检测；
开关立即生效并保存，手动检测会显示最新版本、发现新版或检查失败的结果。
只有选择“下载并安装”才下载对应架构 ZIP，校验 GitHub SHA-256，随后自动重启安装。
安装前验证 `.app` 的签名、Bundle ID、版本及 Mach-O
架构，退出再替换应用并重新打开。Developer ID 签名的应用必须保持原团队；
当前 ad-hoc 构建也会验证签名完整性，不会重新签名或移除 quarantine。
旧应用保存在安装目录旁的隐藏 `.yesplaymusic-update-*` 目录；替换或启动请求失败
会恢复旧应用。新版完成初始化且主界面加载成功 5 秒后，自动删除该次旧版备份、
ZIP 和安装脚本；主界面未成功加载时保留备份。启动请求成功不代表后续崩溃也会自动回滚。
应用和所在目录必须可写；建议安装在 `~/Applications`，如 `/Applications`
不可写请先手动移动。直接从 DMG 或 App Translocation 运行时需先安装再更新。
选择“稍后”不会下载或安装。旧版仍需手动安装一次新版以启用此功能。

### Windows 安装版自动更新

安装版启动后及每 6 小时根据正式版 Release tag 检查更新，自动下载
`YesPlayMusic.Setup.<版本>-<架构>.exe`（x64 / ARM64），使用 GitHub 附件 SHA-256 校验。
ARM64 只选择 ARM64 安装包；x64 同时兼容旧版无架构后缀的安装包名。
发布时保留 `YesPlayMusic.Setup.<版本>.exe` 的 x64 兼容副本，供旧版更新器使用。
下载完成后选择“重启并更新”，通过 NSIS 覆盖安装并重新启动。
全局安装可能弹出 Windows 管理员授权；取消或选择“稍后”不会在退出时偷偷安装。

Windows 单文件便携版也支持 x64 / ARM64 自更新：发现新版先询问，选择“下载并安装”后
下载 `YesPlayMusic.<版本>-<架构>.exe`，校验 SHA-256；退出后等待原便携启动器释放文件，
在原位置替换 EXE 并重新打开，不会转换为安装版。程序和所在目录必须可写，建议使用
固定文件名 `YesPlayMusic.exe`，放在桌面、下载或其他用户目录。
替换或启动失败时尝试恢复并重新打开旧版；新版主界面成功加载 5 秒后清理旧 EXE、
缓存与安装脚本。更新缓存位于用户数据目录的 `updates/portable` 下。
旧单文件版仍需手动替换一次含自更新功能的新版，后续即可使用应用内更新。

## 👷‍♂️ 打包客户端

如果在 Release 页面没有找到适合你的设备的安装包的话，你可以根据下面的步骤来打包自己的客户端。

1. 打包 Electron 需要用到 Node.js（22.12 及以上）和 Yarn。可前往 [Node.js 官网](https://nodejs.org/zh-cn/) 下载安装包。安装 Node.js
   后可在终端里执行 `npm install -g yarn` 来安装 Yarn。

2. 使用 `git clone --recursive https://github.com/greepar/YesPlayMusic.git` 克隆本仓库到本地。

3. 使用 `yarn install` 安装项目依赖。

4. 选择下列表格的命令来打包适合你的安装包，打包出来的文件在 `/dist_electron` 目录下。了解更多信息可访问 [electron-builder 文档](https://www.electron.build/cli)

| 命令                                | 说明                            |
| ----------------------------------- | ------------------------------- |
| `yarn electron:build --mac --arm64` | macOS Apple 芯片（在 macOS 上） |
| `yarn electron:build --mac --x64`   | macOS Intel（在 macOS 上）      |
| `yarn electron:build --win nsis portable --x64` | Windows x64                     |
| `yarn electron:build-win-arm64`    | Windows ARM64                   |
| `yarn electron:build --win`        | Windows x64 和 ARM64（分别输出安装版与便携版） |
| `yarn electron:build --linux`       | Linux AppImage（x64 和 arm64）  |

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

查看 Todo 请访问本项目的 [Projects](https://github.com/greepar/YesPlayMusic/projects)

欢迎提 Issue 和 Pull request。

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于原版 YesPlayMusic 开发(https://github.com/qier222/YesPlayMusic)。

基于 [MIT license](https://opensource.org/licenses/MIT) 许可进行开源。
