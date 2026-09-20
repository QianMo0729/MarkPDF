# MarkPDF v0.1.3

本次更新带来 macOS Apple 芯片安装包，并为 Mac 和 Windows 换上统一的新图标。

## 下载

- Windows x64：`MarkPDF_0.1.3_x64-setup.exe`。
- macOS Apple 芯片（macOS 11 及以上）：`MarkPDF_0.1.3_aarch64.dmg`，打开后将 MarkPDF 拖入“应用程序”。
- 安装包的 SHA-256 分别见 `SHA256SUMS.txt` 和 `SHA256SUMS-macos.txt`。

## 新增与改进

- 修复 macOS 26.3 及更早 WebView 导入 PDF 时出现 `TypeError: undefined is not a function` 的问题，同时恢复阅读器文字提取与搜索；已导入失败的文件可重试。
- Mac 和 Windows 使用新的紫色文档图标，提供透明圆角和各尺寸图标资源。
- macOS 新增系统菜单栏、⌘ 快捷键、融合标题栏的工具栏、系统字体与强调色适配，支持从访达打开 PDF。
- macOS 录音支持系统麦克风授权，并在录音期间防止电脑自动休眠；打印会在系统“预览”中打开带标注的 PDF。
- 从 Finder 或 Dock 启动时，能查找 Homebrew、nvm、Volta 等常见位置中的 Codex CLI。
- PDF 顶部录音栏支持折叠，并记住显示状态；调整底部录音控件布局。
- 完善 macOS 构建脚本、原生库检查及双平台自动发布流程。

## 升级

请先结束录音、等待笔记保存并退出 MarkPDF。新版本沿用原有数据目录，升级时保留应用数据：

- Windows：`%APPDATA%\com.markpdf.app\`。
- macOS：`~/Library/Application Support/com.markpdf.app/`。

Windows 安装包未进行代码签名；macOS 使用 ad-hoc 签名，尚未经过 Apple 公证。首次打开网上下载的应用时，系统可能要求确认来源；macOS 可在“系统设置 → 隐私与安全性”中允许打开。首次录音需要允许麦克风访问。

本次 macOS 安装包面向 Apple 芯片，未提供经过发布验证的 Intel 安装包。离线模型首次下载需要网络；AI 功能需配置相应服务或登录账号。
