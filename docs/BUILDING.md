# Windows 安装包与源码构建

## 直接安装

普通用户从 [GitHub Releases](https://github.com/QianMo0729/MarkPDF/releases/latest) 下载 `MarkPDF_0.1.2_x64-setup.exe`，双击按提示安装即可。无需安装 Node.js、Rust 或 Visual Studio。系统缺少 WebView2 时，安装器会下载其运行时。

下面的步骤供自行修改源码或构建安装包的开发者使用。

## 构建环境

目前验证的平台是 Windows x64。CI 固定 Node.js **24.18.0**、Rust **1.98.1**（`x86_64-pc-windows-msvc`）和 `windows-2022` runner；npm 与 Cargo 都使用已提交的 lockfile。版本和依赖固定不代表安装包逐字节相同，编译器、Windows SDK 和安装器元数据仍可能影响产物。

安装这些前置工具：

1. Node.js 24 LTS、Git。
2. Rustup，以及 `rustup toolchain install 1.98.1 --profile minimal`。
3. Microsoft C++ Build Tools，选择“使用 C++ 的桌面开发”及 Windows SDK。
4. WebView2 Runtime（Windows 11 通常已包含）。

这些是 [Tauri 官方 Windows 前置依赖](https://v2.tauri.app/start/prerequisites/#windows)。

## 从仓库生成可安装 EXE

```powershell
git clone https://github.com/QianMo0729/MarkPDF.git
cd MarkPDF
powershell -ExecutionPolicy Bypass -File .\app\scripts\build-windows.ps1
```

本机默认使用现有 Rustup 工具链；可用 RUSTUP_TOOLCHAIN 显式指定，CI 则固定上述版本。脚本安装 npm 锁定依赖，核验应用版本与离线翻译引擎文件，运行前端和 Rust 测试，再构建 NSIS 安装器及 `SHA256SUMS.txt`。默认输出：

```text
app/src-tauri/target-release/release/bundle/nsis/
  MarkPDF_0.1.2_x64-setup.exe
  SHA256SUMS.txt
```

已有依赖可加 `-SkipInstall`；已经在同一源码上验证过测试可加 `-SkipTests`。`-PrepareOnly` 只配置当前 PowerShell 进程的构建环境，方便后续手动执行 Cargo / Tauri 命令。显式设置 `CARGO_TARGET_DIR` 可更改产物位置。脚本不会启动、关闭或重新打开 MarkPDF。

## sherpa-onnx 原生库

仓库不包含开发者的绝对路径。`sherpa-onnx-sys` 按 `Cargo.lock` 的版本从 [官方 sherpa-onnx Releases](https://github.com/k2-fsa/sherpa-onnx/releases) 下载预编译原生库，并缓存在 Cargo target 目录。当前锁定为 1.13.8，Windows x64 静态库归档为 `sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2`，归档约 120 MB，解压约 1.2 GB；初次构建需要网络及额外磁盘空间。

网络受限时，可以手动下载同版本归档并选择一个进程级覆盖：

```powershell
# 归档所在目录，或解压后包含 sherpa-onnx-c-api.lib 等文件的 lib 目录。
$env:SHERPA_ONNX_ARCHIVE_DIR = 'D:\build-cache\sherpa'
# $env:SHERPA_ONNX_LIB_DIR = 'D:\build-cache\sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib\lib'
.\app\scripts\build-windows.ps1
```

显式覆盖优先。未设置覆盖时，辅助脚本也会复用 `%LOCALAPPDATA%\MarkPDF-build\<同版本归档名>\lib` 下的现成库；没有缓存则交给 crate 自动下载。无需修改 `.cargo/config.toml`，也无需提交个人路径。Windows 发布只使用官方无 TTS 归档，不接受包含 eSpeak / Piper 的完整 SDK。app/src-tauri/vendor/sherpa-onnx-sys 保留上游 1.13.8 绑定与许可证，仅修改 Windows x64 静态归档选择、SHA-256 校验和链接库名单；改动见该目录 [MARKPDF-PATCH.md](../app/src-tauri/vendor/sherpa-onnx-sys/MARKPDF-PATCH.md)。原生依赖许可证见[第三方许可说明](THIRD_PARTY_NOTICES.md)。

离线翻译引擎的来源和 SHA-256 固定在 `app/public/translation/bergamot/provenance.json`；构建会通过 `download-translation-assets.mjs` 校验或恢复对应文件。中英翻译模型和录音转写模型由应用在首次使用时下载，不是构建工具的安装步骤。

## GitHub Actions

- `Windows checks`：分支 push 和 PR 执行 npm 锁定安装、版本 / 引擎校验、前端测试 / 构建及 Rust 测试。使用只读仓库权限。
- `Windows installer release`：推送 `v<版本>` 标签后执行同样检查，生成 NSIS 安装器；通过原生导出检查（禁止残留 eSpeak / Piper）并上传安装器及 SHA-256 后发布 GitHub Release。普通用户下载 Release 中的 `.exe` 即可安装。

发布前需要同步 `app/package.json`、`app/package-lock.json`、`app/src-tauri/tauri.conf.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock` 的应用版本，并准备 `docs/RELEASE_NOTES_<版本>.md`。工作流检查标签与这些文件一致，再使用该 Markdown 作为 Release 说明。当前版本保持 0.1.2。

维护者的发布操作示例：

```powershell
git tag v0.1.2
git push origin v0.1.2
```

工作流仅 Release job 使用 `contents: write`，并使用 GitHub 自动提供的 `GITHUB_TOKEN`；不需要个人 API Key。构建先写入草稿，安装器与校验文件都上传成功后才公开。工作流使用已核验并固定提交 SHA 的 GitHub / Tauri 官方 Actions。首次托管运行是否成功，以 Actions 记录和 Release 实际附件为准。

原生库更换的实际链接证据见[Windows 原生链接审计](native-link-audit.md)。

接口依据：[Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)、[tauri-action 输入参数](https://github.com/tauri-apps/tauri-action)、[GitHub setup-node](https://github.com/actions/setup-node)、[GitHub upload-artifact](https://github.com/actions/upload-artifact)。
