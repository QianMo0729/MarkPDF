# 本地中英翻译核查与实现

核查日期：2026-09-15。先读取官方模型、引擎与接口资料，再下载并实际推理。

## 核查结论

Mozilla 有可直接在 CPU 上运行的英语与简体中文双向离线模型。Firefox 使用 Bergamot 的 WebAssembly 构建；翻译模型为单方向，两个方向需要分别下载。[Firefox 架构说明](https://firefox-source-docs.mozilla.org/toolkit/components/translations/resources/01_overview.html)

旧 `firefox-translations-models` 仓库已经归档，因此本次以 Mozilla 当前 Remote Settings 正式模型清单与 Firefox 源码为准。[归档仓库](https://github.com/mozilla/firefox-translations-models)、[当前训练与推理仓库](https://github.com/mozilla/translations)、[正式模型清单](https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records)

本次固定的模型文件如下；文件名、下载地址、精确字节数、SHA-256 均保存于 `app/src/data/translation/models.json`。不依赖启动时在线刷新模型清单。

| 方向 | 版本 | 文件数量 | 总大小 |
| --- | --- | --- | --- |
| 英语 → 简体中文 | 2.2 | 4 | 51,934,991 字节，约 49.5 MiB |
| 简体中文 → 英语 | 2.0，桌面模型 | 3 | 70,084,668 字节，约 66.8 MiB |

WASM 为正式清单中的 Bergamot v0.6.0（资源协议版本 3.0），4,960,506 字节。JavaScript 绑定来自 Firefox 的 v0.6.0 源文件，未做修改。精确来源与校验值保存在 `app/public/translation/bergamot/provenance.json`。[引擎清单](https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-wasm/records)、[Firefox JS 绑定](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/translations/bergamot-translator/bergamot-translator.js)

旧 npm 包 `@browsermt/bergamot-translator` 的 0.4.9 版本不是本次运行时。当前 v0.6.0 的 `TranslationModel` 构造函数需要源语言、目标语言参数，不能直接套用旧版封装。[Firefox 引擎调用实现](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/translations/content/translations-engine.worker.js)

## 实现行为

- 引擎与官方 MPL-2.0 许可证随应用打包，无远程代码加载。
- 默认中英翻译使用本地引擎。首次翻译下载对应方向的模型，也可在“翻译与 AI”设置预下载两个方向。
- 模型下载仅向固定 Mozilla CDN 发出 GET 请求，不携带原文、PDF 内容、API 密钥或自定义请求体。桌面端使用已有 Tauri HTTP 插件，避免浏览器跨域限制。
- 模型放在应用数据目录 `translation_models/<模型版本>/`；浏览器测试环境使用 IndexedDB。完整下载先校验精确长度与 SHA-256，再写入缓存。
- 加载缓存时再次校验 SHA-256；损坏文件不会送入引擎。失败或取消后保留已校验的完整文件，重试会跳过它们。
- 翻译在独立 Web Worker 中执行。取消会终止运行中的推理；空闲 90 秒后释放引擎及模型内存。不会占用录音所用的主线程。
- 支持英语与简体中文，单次最多 20,000 字符。解释功能和主动选择的 AI 翻译仍使用 AI 服务；本地失败不会自动上传原文。[AI API 格式说明](./api-formats.md)

## 验证及边界

1. **官方下载与校验**：通过公开 Mozilla 附件 CDN 下载 7 个模型文件及 WASM，全部精确长度与 SHA-256 通过。
2. **真实引擎推理**：用当前打包的 `worker.js`、官方 JS/WASM 和完整模型，在只允许 `file:` 读取的 Node V8 环境完成三次中英推理，包括来回切换模型。结果见 `translation-inference-smoke.json`。
3. **真实浏览器离线推理**：独立无头 Edge/Chromium 中，将同一组官方模型附件通过测试下载响应送入真实缓存与校验代码；关闭页面后创建新页面、新 JS 模块和新 Worker，禁止所有外网请求，三次推理全部通过，外网请求次数为 0，浏览器错误为 0。结果见 `translation-browser-smoke.json`。示例：`Machine learning is a branch of artificial intelligence.` → `机器学习是人工智能的一个分支。`，反向同样成功。
4. **缓存回归测试**：6 项通过，覆盖已有缓存完全不联网、同长度文件损坏、错误下载不入库、取消后不写入、已取消请求不读盘、失败后保留先前完整文件。

浏览器离线测试的首次下载使用已核实的本地官方附件作为测试响应。直接从普通网页抓取 Mozilla CDN 受跨域限制，不能视为桌面 Tauri 原生下载的在线验证。本次未重启用户应用，未读取或更改用户数据库，因此尚未在更新后的真实桌面窗口中执行首次模型下载或交互验收。测试句子证明接口、缓存与实际推理可用，不代表专业课件术语的翻译质量评估。

## 重现

在 `app` 目录执行：

```powershell
node scripts/download-translation-assets.mjs --models
npm run test -- tests/localTranslationModelFiles.test.ts
```

运行独立 Vite 服务（例如端口 1428），用安装有 Playwright 的 Node 环境执行 `node scripts/translation-browser-smoke.cjs --fixtures`。`PLAYWRIGHT_MODULE` 可指定 Playwright 安装路径；测试使用独立无头浏览器环境，不连接个人浏览器。
