# MarkPDF 技术方案 v2（实现规格）

> 本文档由 SlideNote v1 修订而来。v1 的数据模型、时间轴语义、同步、后端 API、服务端处理、AI 层大部分保留；客户端技术栈、PDF 查看器、笔记编辑器、侧栏、里程碑顺序按新需求重写。
> 标"定版"的地方不要改；标"可选"的地方实现者可自行决定；标"验证"的地方要在对应里程碑里实测并把结论写回本文档。
> 技术选型（第 2 节）已按公开的开源实现核对过（附录 C 列出了每一项的来源），不是空想；但仍需在 M0 / M1 里跑通后再算定版。

## 0. 怎么用这份文档

1. 按第 12 节的里程碑顺序，一次给实现者（Codex / Claude Code）一个里程碑，附上它引用的章节。
2. 先做 M0：生成工程骨架并跑通空壳（`npm run tauri dev`），再做功能。
3. 每个里程碑末尾有验收标准，用它判断有没有做完。
4. 所有标识符（表名、字段名、事件类型、路由、面板 id、Tauri command 名）以本文档为准，不要改名。
5. 第 6 节（前端 UI）是最重要的部分，尺寸、状态、文案都写死了，严格照做，不要"优化"。

### 0.1 v2 相对 v1 的变更摘要

| 项 | v1（SlideNote） | v2（MarkPDF） | 原因 |
|---|---|---|---|
| 客户端栈 | Flutter | Tauri 2 + React + TypeScript；Rust 只做音频 / ASR / 文件 | Obsidian 式编辑器、Edge 式 PDF 标注、可自由组合的面板在 Web 技术里都有成熟开源实现（附录 C），Flutter 里没有 |
| 平台顺序 | 五端同时 | Windows exe → macOS → iPadOS | 用户要求先出 exe |
| 账号 | 必须登录 | 可选；未登录时本地模式全功能 | 先出单机可用的 exe |
| PDF 上的标注 | 非目标 | 核心功能：Markdown 文本框、高亮、墨迹、擦除、导出带标注 PDF | 用户要求对齐 Edge 的 PDF 功能，且 Markdown 直接渲染在 PDF 上 |
| 侧栏 | 固定三 tab | Dock 面板系统，可拖拽组合 | 用户要求 |
| 笔记编辑器 | 源码 + 预览 | Obsidian 式 live preview（源码 / 阅读两种备用模式） | 用户要求 |
| 阅读视图 | 单页 | 单页 / 连续滚动 | 对齐 Edge |
| 事件类型 | 4 种 | 新增 `annotation_snapshot` | 重放时要能看到"当时在 PDF 上写了什么" |
| 面板 | 笔记 / 转写 / 总结 | + 标注列表、目录、搜索、翻译、问答（预留） | 用户要求"选中文字翻译"等 |
| PPTX 导入 | v1 范围 | 需要服务端（M9）；本地模式只支持 PDF | 转换依赖 LibreOffice |

---

## 1. 产品定义

一句话：MarkPDF 是一个"PDF 阅读器 + Markdown 笔记 + 课堂录音"的应用。上课时看课件、录整节课、直接在 PDF 页面上写 Markdown 标注、在侧栏为每一页写 Markdown 笔记；课后重放时能看到"当时翻到哪一页、写了什么"，并由 AI 基于同一条时间轴生成课堂总结。所有数据结构从一开始就为 AI 读取而设计（第 11 节）。

### 1.1 核心对象

| 对象 | 说明 |
|---|---|
| Course 课程 | 一门课，例如"数据结构 2026 秋" |
| Deck 课件 | 一份 PDF，属于一门课（PPTX 由服务端转成 PDF） |
| Session 会话 | 一次上课录音，绑定一门课和一份课件 |
| Note 笔记 | 属于 (课件, 页码)，侧栏里的 Markdown，跨会话持续存在，是"当前版本" |
| Annotation 标注 | 属于 (课件, 页码)，画在 PDF 页面上的东西：Markdown 文本框、高亮、墨迹。跨会话持续存在 |
| NoteSnapshot 笔记快照 | 录音中笔记每次保存都在时间轴留一份快照 |
| AnnotationSnapshot 标注快照 | 录音中标注每次创建 / 修改 / 删除都在时间轴留一条记录 |
| TranscriptSegment 转写段落 | 一段带起止时间的老师说话文本 |
| Marker 标记 | 录音中按下的"重点 / 没听懂 / 作业" |
| Summary 总结 | AI 生成的每页总结和整节课总结，可编辑 |

### 1.2 三种会话形态（决定 UI）

| 形态 | 条件 | 路由 |
|---|---|---|
| reading | 只看课件写笔记和标注，无录音 | `/deck/:deckId` |
| live | 正在录音 | `/session/:sessionId`，`session.ended_at == null` |
| replay | 录音已结束 | `/session/:sessionId`，`session.ended_at != null` |

### 1.3 v2 范围与非目标

v2 做：PDF 导入；Edge 对齐的阅读与标注（目录、缩略图、搜索、缩放、旋转、单页 / 连续、文本选择、高亮、墨迹、文本框、擦除、导出带标注的 PDF）；每页 Markdown 笔记（Obsidian 式 live preview，含公式）；Dock 面板（笔记 / 标注 / 目录 / 搜索 / 翻译 / 转写 / 总结）；录音、事件时间轴、重放；端侧实时转写（中英）；Windows 安装包。之后按里程碑：账号与同步、服务端转码与二次转写、AI 总结、导出 Markdown、macOS、iPadOS。

v2 不做：协作共享；课程表；手写识别；PDF 表单填写；问答（预留接口，11.5）；Android。朗读（Edge 的"大声朗读"）列为 P2 可选，见 6.5.3。

---

## 2. 技术选型

### 2.1 客户端：Tauri 2 + React + TypeScript（定版候选，M0 跑通后定版）

Tauri ≥ 2.10、Node ≥ 20、Rust stable（MSVC target）。所有 npm 包和 crate 用当前最新稳定版，生成 `package.json` / `Cargo.toml` 时自行解析版本，不要手写过期版本号。

Rust 侧只负责：麦克风采集、WAV 写入、SampleClock、sherpa-onnx 推理、模型下载与解压、sha256。其余全部逻辑在 TypeScript 里。

| 用途 | 包 | 说明 |
|---|---|---|
| 壳 | `@tauri-apps/api`、`@tauri-apps/cli` | Tauri 2 |
| SQLite | `@tauri-apps/plugin-sql`（sqlite 特性） | 迁移文件放 `src-tauri/migrations/`；表定义见第 4 节 |
| 文件对话框 / 文件系统 | `@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-fs` | 导入课件、导出 |
| 打开外链 | `@tauri-apps/plugin-opener` | Markdown 里的链接 |
| HTTP | `@tauri-apps/plugin-http` | 调后端与 LLM，绕过 webview CORS |
| PDF 渲染 | `pdfjs-dist`（≥ 4，当前 5.x） | 用 `web/pdf_viewer.mjs` 里的 `PDFViewer`、`PDFFindController`、`PDFLinkService`、`EventBus`；文本层、`getOutline()`、缩略图渲染。**pdf.js 自带的 AnnotationEditor 不用**（原因见 6.5.5） |
| 写 PDF 标注 | `annotpdf`（highkite/pdfAnnotate） | 导出时把高亮 / 墨迹 / 文本框写成标准 PDF 注解（Highlight / Ink / FreeText）；坐标原点左下 |
| 编辑器 | CodeMirror 6：`@codemirror/state`、`@codemirror/view`、`@codemirror/lang-markdown`、`@lezer/markdown` | 基底：`@atomic-editor/editor`（Obsidian 式 live preview，React，MIT）；公式：`codemirror-live-markdown` 的 `mathPlugin`（KaTeX）。两者代码 vendor 进 `packages/editor/`（都是 MIT），自己维护，不依赖上游发版 |
| 只读 Markdown 渲染 | `markdown-it` + `katex` + `highlight.js` | 文本框渲染态、总结、"当时的笔记" |
| Dock 面板 | `dockview-react` | 零依赖；tab、分组、拖拽、`toJSON()` / `fromJSON()` 持久化 |
| 状态 | `zustand` | 见附录 A |
| 路由 | `react-router` | 见 6.3 |
| 文本 diff | `diff`（jsdiff） | 行级，重放时高亮新增行 |
| ID | `uuid`（v7） | 全部 `uuidv7()` |
| 音频播放 | 原生 `<audio>` + `convertFileSrc` | WAV / m4a；`playbackRate`；`timeupdate` 不够密，用 `requestAnimationFrame` 读 `currentTime` |
| 图标 | Material Symbols Rounded（`@material-symbols/svg-400` 或字体） | 工具栏 20 px，主操作 24 px |
| 字体 | Source Sans 3、Source Code Pro 打包；CJK 走系统字体 | 见 6.1 |
| 测试 | `vitest`、`@testing-library/react`；`playwright`（可选，桌面 e2e） | |

Rust crates：`tauri`、`tauri-plugin-sql`、`tauri-plugin-dialog`、`tauri-plugin-fs`、`tauri-plugin-http`、`tauri-plugin-opener`、`cpal`（采集）、`rubato`（重采样到 16 kHz）、`sherpa-onnx`（k2-fsa 官方 crate，第三方 `sherpa-rs` 已归档，不要用）、`sha2`、`zip`、`serde` / `serde_json`、`tokio`、`reqwest`（模型下载）。WAV 写入自己实现（7.3），不用 `hound`，因为要每 5 秒回写头部。

### 2.2 为什么不沿用 v1 的 Flutter

用户的新需求里有三项在 Flutter 生态里没有可用的开源实现、需要从零造：Obsidian 式 live preview 编辑器（Flutter 只有块级 WYSIWYG 编辑器，Markdown 往返有损）、Edge 式 PDF 标注与导出（pdfrx 只渲染不写入）、可拖拽组合的 Dock 面板。Web 技术里这三项都有现成 MIT 实现（附录 C），且 pdf.js 的文本层、搜索、目录可直接用。代价是 iPadOS 上的后台录音要写一个 Swift 插件（7.9），这放到 M13。

如果最终决定坚持 Flutter：第 2、3、7 节按 v1 执行；6.5.5 的标注层改为自绘 overlay + 服务端 PyMuPDF 导出；6.5.7 的编辑器降级为"块级 live preview"；6.5.6 的 Dock 用 pub.dev 的 `docking` 包。其余章节不变。

### 2.3 服务端：Python（同 v1）

Python 3.12、FastAPI、SQLAlchemy 2.x + Alembic、PostgreSQL 16、Redis + arq。对象存储 S3 兼容（开发 MinIO，生产 COS / OSS）。工作进程镜像内置 ffmpeg、LibreOffice（`soffice --headless`）、PyMuPDF、python-pptx。二次转写 faster-whisper（`large-v3-turbo`）。LLM 走 OpenAI 兼容 Chat Completions（`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`），要求支持 JSON 输出。认证：邮箱验证码 + JWT（access 1 小时 / refresh 30 天）。不用 Firebase、不用 CloudKit。

服务端在 M9 之前不需要存在：客户端本地模式（`sync_state.local_mode = "1"`）下所有本地功能可用，翻译 / 解释直接从客户端调用用户在设置里填写的 OpenAI 兼容接口（11.9）。

### 2.4 开发与运行环境要求

Windows 开发机（当前机器：Node 24、Python 3.14、Git 已装；Rust、C++ 工具链、Flutter 未装）：
- Node ≥ 20；Rust stable（`rustup`，默认 `x86_64-pc-windows-msvc`）。
- Microsoft C++ Build Tools 2022，勾选"使用 C++ 的桌面开发"工作负载。**只装 Build Tools，不需要完整 Visual Studio**，编辑器继续用 VS Code（装 rust-analyzer 和 Tauri 扩展）。
- WebView2 Runtime：Windows 11 自带；NSIS 安装包会为缺失的机器自动引导安装。
- sherpa-onnx 与 onnxruntime 的 dll 随包分发（第 14 节）。

macOS：Xcode Command Line Tools。iPadOS：Xcode、Apple 开发者账号、`tauri ios init`。Android 暂不做。

平台配置（打包时必须）：
- Windows：无特殊权限；麦克风走系统隐私设置。
- macOS：`NSMicrophoneUsageDescription`；entitlements `com.apple.security.device.audio-input`、`com.apple.security.network.client`、`com.apple.security.files.user-selected.read-only`。
- iPadOS：`NSMicrophoneUsageDescription`；`UIBackgroundModes: [audio]`；AVAudioSession `playAndRecord`。

---

## 3. 仓库结构（monorepo）

```
markpdf/
  app/                                  # Tauri + React
    package.json  vite.config.ts  tsconfig.json  index.html
    src-tauri/
      Cargo.toml  tauri.conf.json
      capabilities/default.json         # fs / dialog / sql / http 权限
      migrations/0001_init.sql          # 第 4 节全部表
      src/main.rs  src/lib.rs
      src/commands.rs                   # #[tauri::command] 清单见 7.1
      src/audio/{capture.rs, resample.rs, wav_writer.rs, sample_clock.rs, level.rs}
      src/asr/{engine.rs, model_manager.rs}
      src/files/{hash.rs, unzip.rs}
    src/
      main.tsx  app.tsx                 # RouterProvider + ThemeProvider + DB 初始化
      core/theme/tokens.css             # 6.1 的 CSS 变量，light / dark
      core/theme/theme.ts
      core/layout/{breakpoints.ts, AdaptiveShell.tsx}
      core/utils/{time.ts, ids.ts}      # fmtClock(ms) -> "12:03" / "1:02:15"；newId() = uuidv7()
      core/strings.ts                   # 所有用户可见文案
      data/db/{client.ts, repos/*.ts}   # plugin-sql 封装 + 每张表一个 repo
      data/api/{client.ts, endpoints.ts, dto/*.ts}
      data/sync/{sync_engine.ts, upload_manager.ts}
      data/files/file_store.ts          # 路径约定，见 4.6
      domain/timeline.ts                # 第 5 节，纯 TS，有单元测试
      domain/note_diff.ts
      domain/export_markdown.ts
      domain/export_pdf.ts              # annotpdf
      domain/session_bundle.ts          # 11.7
      pdf/PdfDocumentProvider.tsx       # 打开 / 缓存 / 释放 PDFDocumentProxy
      pdf/PdfViewer.tsx                 # 6.5.4
      pdf/coords.ts                     # 页面空间 <-> 视口像素
      pdf/thumbnails.ts  pdf/find.ts  pdf/outline.ts
      pdf/SelectionToolbar.tsx          # 6.5.4 浮动工具条
      pdf/layers/{AnnotationLayer.tsx, TextBoxAnnotation.tsx, HighlightAnnotation.tsx, InkAnnotation.tsx, EraserTool.ts}
      editor/MarkdownEditor.tsx         # 6.5.7，包 packages/editor
      editor/extensions/{timestampChip.ts, pageLink.ts, toolbar.ts}
      editor/MarkdownView.tsx           # 只读渲染
      dock/{DockHost.tsx, panelRegistry.ts, defaultLayouts.ts}
      features/auth/LoginScreen.tsx
      features/library/LibraryScreen.tsx
      features/course/CourseScreen.tsx
      features/deck_import/deckImport.ts
      features/session/SessionScreen.tsx
      features/session/controllers/{recording.ts, playback.ts, noteEditor.ts, annotations.ts, currentPage.ts}
      features/session/panels/{NotesPanel, AnnotationsPanel, OutlinePanel, SearchPanel, TranslatePanel, TranscriptPanel, SummaryPanel, AskPanel}.tsx
      features/session/widgets/{SessionTopBar, ThumbnailRail, SlideToolbar, TransportBar, TimelineScrubber, MarkerBar, LevelMeter}.tsx
      features/settings/{SettingsScreen, AsrModelsScreen}.tsx
      platform/{audio.ts, asr.ts, models.ts}   # invoke / listen 封装，前端只通过这里碰 Rust
    public/fonts/  public/pdfjs/        # pdf.js worker 与 cmaps
    tests/
  packages/editor/                      # vendor 的 CM6 live preview（MIT，附来源与许可证文件）
  server/                               # 同 v1（app/main.py, api/, models/, services/, workers/, prompts/, alembic/, docker-compose.yml）
  test/fixtures/timeline_cases.json     # TS 版与 Python 版共用
  docs/SPEC.md                          # 本文档
```

---

## 4. 数据模型

### 4.1 原则

- 两类数据：**可变实体**（LWW，按 `updated_at` 决胜）和**不可变事件**（append-only，同步只做并集）。
- 客户端 SQLite 表和服务端 Postgres 表同名同字段，同步层不做字段映射。
- 所有 `id` 为 UUIDv7 字符串；所有 `*_at` 为 ISO 8601 UTC 字符串；所有时间轴位置 `*_ms` 为 int 毫秒。
- 标 `[local]` 的列只在客户端存在，不参与同步。
- **页面坐标系（定版）**：标注的所有坐标用 PDF 用户空间的点（pt），原点在页面左上角、y 向下、页面旋转为 0 时的坐标，即 pdf.js 在 `scale = 1, rotation = 0` 下 `viewport` 的坐标。视图旋转、缩放不改变存储值。导出到 `annotpdf` 时换算为左下原点：`y' = height_pt - y`。

### 4.2 可变实体表

**courses**

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| term | TEXT? | 如 "2026 秋" |
| color_index | INT | 0–7，见 6.4.2 色板 |
| created_at, updated_at | TEXT | |
| deleted_at | TEXT? | 软删除 |
| dirty | BOOL [local] | 待推送 |

**decks**

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| course_id | TEXT FK | |
| title | TEXT | 默认取文件名去扩展名 |
| source_type | TEXT | `pdf` / `pptx` |
| page_count | INT | |
| file_sha256 | TEXT | 原始文件 sha256，用于去重 |
| remote_key | TEXT? | 对象存储里 PDF 的 key |
| status | TEXT | `importing` / `uploading` / `converting` / `ready` / `error` |
| error_message | TEXT? | |
| created_at, updated_at, deleted_at | TEXT | |
| local_pdf_path | TEXT? [local] | |
| local_source_path | TEXT? [local] | pptx 原件 |
| dirty | BOOL [local] | |

**deck_pages**（PK = deck_id + page_index）

| 列 | 类型 | 说明 |
|---|---|---|
| deck_id | TEXT | |
| page_index | INT | 0 起 |
| width_pt, height_pt | REAL | 旋转 0 时的尺寸 |
| text | TEXT | 页面文本，客户端导入时用 pdf.js `getTextContent()` 写入 |
| speaker_notes | TEXT? | 仅 pptx，服务端填 |
| updated_at | TEXT | |

**sessions**

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| course_id, deck_id | TEXT FK | |
| title | TEXT | 默认 "{deck.title} {M月d日}" |
| started_at | TEXT? | 按下录音的时刻 |
| ended_at | TEXT? | null = live |
| duration_ms | INT? | 结束时由 SampleClock 写入 |
| initial_page_index | INT | 按下录音时打开的页 |
| lang_mode | TEXT | `auto` / `zh` / `en` |
| audio_status | TEXT | `recording` / `local` / `uploading` / `uploaded` / `processed` / `error` |
| asr_status | TEXT | `none` / `device` / `server_pending` / `server_done` |
| summary_status | TEXT | `none` / `pending` / `ready` / `error` |
| audio_wav_key, audio_m4a_key | TEXT? | 对象存储 key |
| created_at, updated_at, deleted_at | TEXT | |
| local_wav_path, local_m4a_path | TEXT? [local] | |
| dirty | BOOL [local] | |

**notes**（UNIQUE deck_id + page_index）

| 列 | 类型 |
|---|---|
| id | TEXT PK |
| deck_id | TEXT |
| page_index | INT |
| markdown | TEXT |
| created_at, updated_at | TEXT |
| dirty | BOOL [local] |

**annotations**（新增）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| deck_id | TEXT | |
| page_index | INT | |
| kind | TEXT | `text_box` / `highlight` / `ink` |
| x, y, w, h | REAL | 页面空间。text_box：框的位置尺寸；highlight / ink：包围盒（由 quads / strokes 算出，用于命中与列表） |
| color | TEXT | `#RRGGBB`。text_box 为文字色；highlight 为底色；ink 为线色 |
| markdown | TEXT? | text_box 的内容；highlight 的备注 |
| selected_text | TEXT? | highlight 覆盖的原文，AI 与列表用 |
| quads_json | TEXT? | highlight：`[[x1,y1,x2,y2,x3,y3,x4,y4], …]`，每行一个四边形 |
| strokes_json | TEXT? | ink：`[[[x,y],[x,y],…], …]`，每笔一个数组 |
| stroke_width | REAL? | ink，pt |
| font_size | REAL? | text_box，pt，默认 11 |
| border_color | TEXT? | text_box 边框色 `#RRGGBB`，NULL = 无边框（迁移 0003） |
| fill_color | TEXT? | text_box 填充色 `#RRGGBB`，NULL = 无填充（迁移 0003） |
| z | INT | 同页叠放顺序，创建时取 max+1 |
| created_at, updated_at, deleted_at | TEXT | |
| dirty | BOOL [local] | |

**transcript_segments**、**page_summaries**、**session_summaries**：同 v1。

transcript_segments：`id, session_id, source (device/server), t0_ms, t1_ms, text, translation?, lang? (zh/en/mixed), page_index?, created_at, updated_at, dirty[local]`。

page_summaries（UNIQUE session_id + page_index）与 session_summaries（UNIQUE session_id）：`id, session_id, page_index (仅 page), content_json, edited_by_user, created_at, updated_at, dirty[local]`。结构见 11.2 / 11.3。

### 4.3 事件表 events（append-only）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUIDv7 |
| session_id | TEXT | |
| type | TEXT | 见下 |
| t_ms | INT | 时间轴位置，来自 SampleClock |
| payload_json | TEXT | |
| device_id | TEXT | |
| created_at | TEXT | |
| server_seq | INT? | 服务端分配的全局序号 |
| synced | BOOL [local] | |

事件类型与 payload（定版）：

| type | payload | 何时产生 |
|---|---|---|
| `page_change` | `{"page_index": 7}` | 当前页停留 ≥ 300 ms 且与上次不同（5.4） |
| `note_snapshot` | `{"page_index": 7, "markdown": "..."}` | 见 5.3 |
| `annotation_snapshot` | `{"annotation_id": "…", "page_index": 7, "kind": "text_box", "op": "created" / "updated" / "deleted", "annotation": {…annotations 行的全部非 local 字段，deleted 时为 null}}` | 见 5.6 |
| `marker` | `{"kind": "important"}`，kind 取 `important` / `confused` / `homework` | 按下标记按钮 |
| `recording_state` | `{"state": "started"}`，state 取 `started` / `paused` / `resumed` / `stopped` | 录音状态变化 |

规则：事件只在 live 形态产生；永不修改、永不单独删除；删除会话时级联删除。

### 4.4 本地专用表

- `sync_state(key TEXT PK, value TEXT)`，键：`device_id`、`local_mode`（"1" 未登录）、`last_server_seq`、`last_entities_pull_at`、`access_token`、`refresh_token`、`dock_layout_reading`、`dock_layout_live`、`dock_layout_replay`（dockview `toJSON()` 的 JSON）、`rail_collapsed`、`view_mode`（`single` / `continuous`）、`zoom_mode`（`page-width` / `page-fit` / 数字）、`editor_mode`（`live` / `source` / `reading`）、`theme`（`system` / `light` / `dark`）、`playback_speed`、`translate_target`（默认 `zh`）、`llm_base_url`、`llm_api_key`、`llm_model`、`highlight_color`、`ink_color`、`ink_width`、`text_box_font_size`、`text_color`、`text_box_border_color`、`text_box_fill_color`（空 = 无）、`rail_width`、`side_panel_width`、`delete_wav_after_upload`。
- `asr_models(id, name, dir_path, size_bytes, sha256, status, progress REAL)`：status = `not_downloaded` / `downloading` / `ready` / `error`。
- `uploads(id, kind, target_id, upload_id, part_size, completed_parts_json, status)`：分片上传断点。

### 4.5 服务端额外表（同 v1）

`users(id, email, created_at)`、`devices(id, user_id, name, platform, last_seen_at)`、`auth_codes(email, code_hash, expires_at, attempts)`、`jobs(id, user_id, kind, status, progress, error, payload_json, result_json, created_at, updated_at)`。所有实体表（含 annotations）和 events 增加 `user_id`；events 增加 `server_seq BIGSERIAL`。

### 4.6 本地文件路径约定

删除课程 / 课件 / 课堂（`domain/deletion.ts`）同时删除 PDF、来源文件、缩略图目录和 WAV / M4A；行保留 `deleted_at` 墓碑，子表（events、transcript_segments、summaries、deck_pages、notes、mindmap_nodes）硬删。删不掉的路径记入 `sync_state.pending_file_deletes`，下次启动重试；启动时也清理历史墓碑遗留的文件，并把上次运行遗留在 `importing` 的课件标为失败以便重试。设置里的“清理缩略图缓存”清空 `thumbs/`。

`appData` = Tauri `appDataDir()`，`appCache` = `appCacheDir()`。

```
<appData>/markpdf.db
<appData>/decks/<deckId>.pdf
<appData>/decks/<deckId>.pptx            # 原件，可删
<appData>/sessions/<sessionId>.wav       # 录音原始文件
<appData>/sessions/<sessionId>.m4a       # 从服务端下载的转码文件
<appData>/asr_models/<modelId>/          # encoder.onnx decoder.onnx joiner.onnx tokens.txt
<appCache>/thumbs/<deckId>/<pageIndex>.png   # 320 px 宽缩略图
```

Web 侧用 `convertFileSrc(path)` 取得可加载的 URL（`asset:` 协议，需在 `tauri.conf.json` 的 `assetProtocol.scope` 里放行以上目录）。

---
## 5. 时间轴语义（全产品的地基）

### 5.1 时钟

- live：`t_ms = totalSamplesWritten * 1000 / 16000`（整除）。`SampleClock` 在 Rust 侧每个 PCM chunk 到达时累加（7.4）。暂停 = 没有样本 = 时钟停。**不用系统时间。**
- replay：`t_ms = Math.floor(audio.currentTime * 1000)`，用 `requestAnimationFrame` 读取并节流到 30 Hz。
- `session.duration_ms` = 结束时 SampleClock 的值，同时写一个 `recording_state: stopped` 事件在该时刻。

### 5.2 派生结构：`Timeline`（`domain/timeline.ts`，纯 TS，必须有单元测试；服务端 `services/timeline.py` 实现同一套规则，共用 `test/fixtures/timeline_cases.json`）

```ts
interface PageInterval { pageIndex: number; t0Ms: number; t1Ms: number }

class Timeline {
  constructor(args: { events: Event[]; initialPageIndex: number; durationMs: number });
  readonly intervals: PageInterval[];                    // 覆盖 [0, durationMs]，无缝隙
  pageAt(tMs: number): number;                           // 二分查找
  noteAt(pageIndex: number, tMs: number): NoteSnapshot | null;      // 该页最后一个 t_ms <= tMs 的快照
  previousSnapshot(s: NoteSnapshot): NoteSnapshot | null;          // 同页上一个快照，用于 diff
  annotationsAt(pageIndex: number, tMs: number): AnnotationState[]; // 新增：tMs 时该页存活的标注
  pageForSegment(t0Ms: number, t1Ms: number): number;    // 中点落在哪个 interval
  readonly markers: Marker[];
  nextMarker(afterMs: number, kind: MarkerKind): Marker | null;    // 循环
}
```

规则：第一个 interval 从 0 开始，页为 `initial_page_index`；每个 `page_change` 在 `t_ms` 处切一刀；相邻相同页合并；最后一个 interval 到 `duration_ms`；live 时 `duration_ms` = 当前 SampleClock。

`annotationsAt`：取该页所有 `annotation_snapshot`，按 `t_ms` 升序（相同则按 `id` 升序）依次应用：`created` / `updated` 用 payload 里的 `annotation` 覆盖同 id 的状态；`deleted` 移除。只应用 `t_ms <= tMs` 的记录。

### 5.3 笔记快照策略

- 触发：最后一次击键后 1500 ms；翻页时（若有未快照的改动）；暂停 / 结束录音时；窗口失焦时。
- 去重：内容与本会话内该页上一份快照相同则不写。
- 每次快照同时 upsert `notes` 表（当前版本）。
- 只在 live 产生快照。reading / replay 中的编辑只写 `notes`。

### 5.4 翻页事件策略

"当前页"的定义：单页模式 = 显示的那一页；连续模式 = 视口内可见面积最大的页（相同取页码小的）。当前页变化并停留 ≥ 300 ms 才发 `page_change`；连续快速翻 5 页只产生 1 个事件；与上一个已发事件页码相同则不发。

### 5.5 转写段落时间

`t0_ms`、`t1_ms` 与页面事件同一时钟（同一份 PCM 缓冲），无需对齐。取法见 7.5。

### 5.6 标注快照策略（新增）

- `created`：创建完成时立即写（文本框：首次失焦；高亮：颜色选定；墨迹：一笔抬起）。
- `updated`：最后一次改动后 1500 ms 防抖（内容、位置、尺寸、颜色、备注、追加笔画都算改动）。
- `deleted`：立即写。
- 每条快照同时 upsert `annotations` 表。payload 与该标注上一条快照相同则不写。只在 live 产生；reading / replay 中的编辑只写 `annotations`。

---

## 6. 前端 UI 规格（最重要）

### 6.1 设计方向与 tokens

概念：**投影仪、纸、磁带。** PDF 是主角（投影），右侧面板是纸，底部时间轴是磁带。时间轴是整个 app 唯一允许"抢眼"的元素；其余克制：不用阴影，靠 1 px 边线和底色分层；不用装饰性渐变；动效只响应用户操作。

深色是课堂中的默认，浅色用于复习。跟随系统，设置里可固定。主题通过 `<html data-theme="light|dark">` 切换；`system` 时不写属性，靠 `prefers-color-scheme`。

**颜色（`core/theme/tokens.css` 里的 CSS 变量，名字即 token 名）**

| token | light | dark | 用途 |
|---|---|---|---|
| `--bg` | `#F5F6F8` | `#161A22` | 窗口底色 |
| `--surface` | `#FFFFFF` | `#1F2430` | 面板、顶栏、底栏 |
| `--surface2` | `#EDEFF2` | `#2A3040` | 悬停、分栏底、时间轴偶数页带 |
| `--border` | `#D9DCE1` | `#363D4D` | 所有分隔线，1 px |
| `--text` | `#1B2130` | `#E8ECF2` | 正文 |
| `--text2` | `#5C6470` | `#A2ABB8` | 次要 |
| `--text3` | `#8A919C` | `#6E7785` | 占位、禁用 |
| `--accent` | `#4457D6` | `#8A98FF` | 播放头、当前页边框、链接、焦点环、主按钮、选中标注边框 |
| `--accent-soft` | accent 12% | accent 20% | 当前转写段落底色、选中态 |
| `--highlight` | `#F5C542` | `#F5C542` | 笔记时间戳 chip、重放时新增行底色（20%）、快照刻度 |
| `--record` | `#E5484D` | `#E5484D` | 录音按钮、结束录音、错误文案 |
| `--mark-important` | `#F5C542` | 同 | 重点 |
| `--mark-confused` | `#F0803C` | 同 | 没听懂 |
| `--mark-homework` | `#2FA36B` | 同 | 作业 |
| `--slide-bg` | `#E4E6EA` | `#0F1218` | PDF 区域背景 |

**标注色板（定版）**
- 高亮 4 色（对齐 Edge）：黄 `#F5C542`、绿 `#6FD36F`、蓝 `#6FB8FF`、粉 `#FF8FC8`。渲染 `mix-blend-mode: multiply`，不透明度 0.45。
- 墨迹 / 文本框文字 5 色：黑 `#1B2130`、红 `#E5484D`、蓝 `#4457D6`、绿 `#2FA36B`、黄 `#D9A400`。
- 墨迹粗细：1 / 2 / 4 / 8 pt。文本框字号：9 / 11 / 14 / 18 pt。

**字体**
- Latin 与数字：Source Sans 3（variable，用 400 和 600）。CJK：`font-family: 'Source Sans 3', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif`。
- 代码块与内联代码：Source Code Pro。其他地方一律不用等宽。
- 时间（`00:12:03`）用正文字体加 `font-variant-numeric: tabular-nums`。
- 字号 / 行高：display 28/36 w600；title 20/28 w600；subtitle 16/24 w600；body 15/23 w400；bodySmall 13/20；caption 12/16（默认 text2）；editor 15/24。
- 阅读态与预览行宽上限 680 px。
- 不用全大写标签；次要信息不用 "A · B · C" 中点拼接，用两个空格或换行分隔。

**间距与形状**：4 px 网格（4 / 8 / 12 / 16 / 24 / 32）。圆角：控件 6，面板与弹层 10，胶囊 999。分隔全部 1 px `--border`。无阴影；浮动胶囊用 `--surface` 底 + `--border` 边。

**动效**：悬停 / 按下 120 ms ease-out；面板开合 200 ms cubic-bezier(0.33, 1, 0.68, 1)；重放自动翻页无动画；用户手动翻页 180 ms；播放头连续移动不插值。遵守 `prefers-reduced-motion`。

**图标**：Material Symbols Rounded，工具栏 20 px，主操作 24 px。触控目标 ≥ 44 × 44。键盘焦点环 2 px accent。

### 6.2 自适应布局

按窗口逻辑宽度：compact < 600；medium 600–1023；expanded ≥ 1024。`layoutClass` 由 `AdaptiveShell` 写入 store。桌面主要跑 expanded；medium 用于窄窗口；compact 只保证能用（iPad 分屏、未来手机）。

### 6.3 路由与外壳

| 路由 | 页面 |
|---|---|
| `/login` | LoginScreen（可从设置进入；未登录不强制跳转） |
| `/` | LibraryScreen（`?tab=courses` / `recent`） |
| `/course/:courseId` | CourseScreen |
| `/deck/:deckId` | SessionScreen(mode: reading) |
| `/session/:sessionId` | SessionScreen(mode: live 或 replay，由 `ended_at` 决定) |
| `/settings`、`/settings/asr` | SettingsScreen、AsrModelsScreen |

外壳：expanded 用左侧 `NavigationRail`（72 px，三项：课程 / 最近 / 设置）；medium 和 compact 用底部 `NavigationBar`。SessionScreen 不显示外壳导航。首次启动直接进入 `/`，本地模式。

### 6.4 各页面

#### 6.4.1 登录

居中列，最大宽 360。内容自上而下：app 名"MarkPDF"（display）；一行说明（body，text2）"记录每一节课的课件、录音和笔记。"；邮箱输入框；"发送验证码"（填充按钮）。发送后出现 6 位验证码框和"登录"按钮；60 秒倒计时后可重发。错误文案显示在输入框下方，record 色，例如"验证码不对，再试一次。"按钮加载时显示 spinner 并禁用。底部文字按钮"暂不登录，本地使用"，点击回 `/`。登录成功后 `local_mode = "0"`，触发 8.1 的首次同步。

#### 6.4.2 课程库

expanded：内容左对齐，内边距 32。顶部一行：标题"课程"（display）、搜索框（宽 240，占位"搜索课程"）、"新建课程"（填充按钮，accent）。

课程用**笔记本**式瓷砖：CSS grid `minmax(220px, 260px)`，比例 4:5，间距 16。瓷砖：surface 底，1 px border，圆角 10；左侧 8 px 书脊条用课程色；内容内边距 16：课程名（subtitle，最多 2 行）、学期（caption）、弹性空白、底部两行 bodySmall text2："12 次课"、"3 份课件"，最后一行 caption 最近活动日期"9月7日"。悬停底色 surface2。右键菜单：重命名、删除（确认框"删除课程会同时删除它的课件和录音。"）。

课程色板（color_index 0–7）：`#4457D6 #2FA36B #E5484D #F0803C #8E5BD6 #1E9AB0 #B5651D #5C6470`。

新建课程对话框：名称、学期（可空）、8 个色块单选。

空状态：图标 `menu_book` 48 px text3；"还没有课程"（subtitle）；"新建第一门课程，然后导入课件或直接开始录音。"（body text2）；"新建课程"按钮。

"最近"tab：列表行高 72：课件首页缩略图 64 × 36（1 px border，圆角 4）；标题（subtitle）；第二行 caption："9月7日 14:00" 两个空格 "1小时31分"；右侧小型描边 chip：转写完成 / 总结完成（仅在对应状态显示）。点击进入会话。

#### 6.4.3 课程页

顶部：返回、课程名（display）、学期（caption）、右侧"开始上课"（填充，icon `mic`）和"导入课件"（描边）。

"课件"区：expanded 横向滚动，medium 网格。`DeckCard` 200 × 176：缩略图 200 × 112（16:9，用 slide-bg 补边）、标题 1 行（subtitle）、"42 页"（caption）、非 ready 时显示状态 chip："转换中 63%" / "导入失败" + "重试"文字按钮。点击进入 `/deck/:id`。右键：重命名、删除。

"课堂记录"区：列表行同"最近"tab。空状态："还没有课堂记录"、"点"开始上课"，选一份课件，就可以开始录音。"

"开始上课"流程：弹出"选择课件"对话框：列出课件 + 最后一行"导入新课件…"。选中后创建 Session（title = deck.title + 空格 + "M月d日"，initial_page_index = 0）并跳转 `/session/:id`（live，尚未开始录音，即"准备"态，6.5.16）。

#### 6.4.4 导入课件

`plugin-dialog` 的 `open()` 过滤 `pdf`、`pptx`。不可关闭的进度对话框，文案按步骤变化："正在复制文件" → "正在读取页面 12 / 42" →（pptx）"正在上传" → "正在转换为 PDF" → "正在下载" → 完成后自动关闭并打开课件。失败："转换失败：{原因}" + "重试" / "取消"。同课程内 sha256 重复：提示"这份课件已经导入过"并打开已有课件。

处理细节：
- PDF：`plugin-fs` 复制到 `decks/<id>.pdf`（sha256 由 Rust `file_sha256` 命令算）；pdf.js `getDocument` 打开；写 `page_count`；逐页 `getViewport({ scale: 1 })` 取 `width_pt / height_pt`，`getTextContent()` 的 `items` 按 `hasEOL` 拼成文本写 `deck_pages.text`（进度显示页数）；缩略图由查看器按需渲染并缓存到 `<cache>/thumbs/`。
- PPTX：已登录 → 复制到 `decks/<id>.pptx`，status = uploading → 8.5 上传 → `process` → 轮询 job → 下载 PDF → 走 PDF 流程；离线时 status 停在 `uploading`，卡片显示"等待网络"。本地模式 → 对话框"PPTX 需要登录后由服务器转换为 PDF。"，按钮"登录" / "取消"。可选：检测本机 LibreOffice（`soffice`）并用它本地转换（验证）。

#### 6.4.5 设置

expanded 双栏（左分组导航 200 px，右内容）；其他单列。分组：
- 账户：未登录显示"本地模式"+ "登录以在多台设备间同步"按钮；已登录显示邮箱与"退出登录"。
- 转写："录音时实时转写"开关（默认开）；"语言"分段按钮 自动 / 中文 / English；模型列表：名称、大小、状态、"下载" / "删除"按钮、下载进度条。
- AI 服务：接口地址（占位 `https://api.openai.com/v1`）、API Key（密码框）、模型名；"测试连接"按钮（发一条 "ping" 的 chat 请求，成功显示"连接正常"）；翻译目标语言 中文 / English。说明文字："翻译、解释和（登录后的）总结都通过这个接口。"
- 标注：默认高亮色（4 色）、默认墨迹色与粗细、文本框字号、文本框文字色、文本框边框（无 / 5 色）、文本框填充（无 / 5 色）。
- 阅读：默认视图 单页 / 连续；默认缩放 适应宽度 / 适应页面。
- 存储：已用空间；"上传成功后删除本地原始录音"开关（默认开）；"清理缩略图缓存"。
- 同步（仅已登录）：状态行（"已同步，刚刚" / "3 项待上传" / "离线"）；"立即同步"。
- 外观：跟随系统 / 浅色 / 深色。
- 快捷键：只读列表（6.6）。
- 关于：版本号。

### 6.5 会话页组件规格

`SessionScreen(mode)` 结构：

```
expanded (≥1024)
┌──────────────────────────────────────────────────────────────────────┐
│ SessionTopBar 56                                                     │
├──────┬────────────────────────────────────┬──────────────────────────┤
│Thumb │ SlideToolbar 40                    │ Dock（dockview）         │
│nail  ├────────────────────────────────────┤  默认 400，最小 320，     │
│Rail  │            PdfViewer               │  最大 50%，可拖分隔线      │
│96    │     （单页 / 连续，可缩放）           │  面板可拖拽组合            │
│      │        ‹ 7 / 42 › 胶囊(底部居中)     │                          │
├──────┴────────────────────────────────────┴──────────────────────────┤
│ TransportBar 72                                                      │
│ TimelineScrubber 28                                                  │
└──────────────────────────────────────────────────────────────────────┘

medium (600–1023)：Column[ PdfViewer flex 55 | 可拖横向分隔 | Dock flex 45 ]，
  ThumbnailRail 变成左侧抽屉；底部同上。
compact (<600)：Stack[ PdfViewer 全屏; 底部抽屉（吸附 0.12 / 0.5 / 0.92）里放面板 tab 栏
  （dockview 关闭，面板按注册顺序做 tab）]；TransportBar 精简版（录音键、时间、标记菜单 ⋯）。
```

reading 形态没有 TransportBar 和 TimelineScrubber。分隔线：8 px 命中区域，1 px 可见线，`cursor: col-resize`；宽度写入 dock 布局 JSON。

#### 6.5.1 SessionTopBar（高 56）

左：返回箭头。live 中点返回弹对话框："录音仍在进行" / "结束录音后再离开。" / 按钮"继续录音"、"结束这节课"（走 6.5.14）。左栏开关 `left_panel_open`。
中：标题 subtitle w600。reading 显示 deck 标题；live / replay 显示 session 标题（replay 中点击可内联编辑）。live 中标题右侧加 chip：8 px record 色圆点 + "录音中"。
右：同步状态圆点 8 px（绿已同步 / 黄待上传 / 灰离线或本地模式，tooltip 写明）；右栏开关 `right_panel_open`；更多 ⋯ 菜单：重命名、导出 Markdown、导出带标注的 PDF、打印、删除会话；reading 形态另有"导入新版本课件"。

#### 6.5.2 ThumbnailRail（默认宽 96，可拖动）

顶部 32 px 分段按钮：缩略图 / 目录（PDF 无书签时目录项禁用，tooltip"这份 PDF 没有目录"）。

缩略图：竖向列表，内边距 8，项间距 12。每项：缩略图宽 80，高按页面比例，1 px border，圆角 4；当前页边框 2 px accent；右上角 6 px highlight 圆点表示该页有笔记或标注；下方页码 caption 居中。replay 中未访问过的页 40% 不透明度。当前页因非用户原因变化时 `scrollIntoView({ block: 'center' })`。缩略图用 pdf.js `page.render` 到 160 px 宽 canvas，内存 LRU 200 张 + 磁盘缓存（4.6）。长按 / 右键：菜单"复制这一页的文字"。

目录：`pdfDocument.getOutline()` 递归渲染树，行高 28，缩进 12 / 级，caption 字号，点击 `linkService.goToDestination(dest)`；当前页所在的条目高亮 accent 文字。

底部折叠按钮 `chevron_left`；折叠态宽 0，状态写 `sync_state.rail_collapsed`。

右边缘是拖动条（同 Dock 分隔条）：拖动改宽度 96–320，缩略图宽 = 栏宽 − 16（缩略图按 320 px 渲染，放大不糊）；松手写 `sync_state.rail_width`。

#### 6.5.3 SlideToolbar（高 40）— Edge 功能对齐

工具条在 PdfViewer 顶部，surface 底，底边 1 px border，内边距 0 12，元素间距 8。从左到右：

1. 工具组（单选，图标 20，选中态 accent-soft 底）：选择 `arrow_selector_tool`（V）、分隔线、高亮 `ink_highlighter`（H）、绘制 `draw`（D）、添加文本 `text_fields`（T）、擦除 `ink_eraser`（E）。live 形态下工具组后的分隔线右边放 32 px 的 `RecordButton`（其后再一条分隔线）（状态样式同 6.5.13，图标 20）：开始 / 暂停 / 继续录音。reading 形态（直接打开课件）下同一位置也有录音键，按下即为该课件新建一节课（`initial_page_index` = 当前页）、跳到 `/session/:id?start=1` 并自动开始录音；replay 不显示。
2. 工具选项（随工具变化）：高亮 → 4 个 16 px 色块；绘制 → 5 个色块 + 粗细菜单；添加文本 → 文字色 5 色块 + 字号菜单 + 边框色（无 / 5 色）+ 填充色（无 / 白 / 4 淡色）；改动即写入默认值（`text_color` / `text_box_font_size` / `text_box_border_color` / `text_box_fill_color`）；擦除 → 无。
3. 弹性空白。
4. 缩放：`remove` / 百分比文字按钮（点击菜单：适应宽度、适应页面、50% … 400%）/ `add`。
5. 旋转 `rotate_right`。
6. 视图菜单 `view_agenda`：单页 / 连续。
7. 搜索 `search`（Ctrl+F）：打开 SearchPanel 并聚焦。
8. 导出菜单 `download`：导出带标注的 PDF / 导出 Markdown / 打印。

Edge 功能对照表（定版，验收时逐条核对）：

| Edge 功能 | MarkPDF | 实现 | 里程碑 |
|---|---|---|---|
| 目录 | Rail 目录 tab | `getOutline()` + `PDFLinkService` | M1 |
| 页面视图 单页 / 连续 | 视图菜单 | `PDFViewer.scrollMode` = PAGE / VERTICAL | M1 |
| 旋转 | 工具条 | `pagesRotation += 90` | M1 |
| 缩放 适应页面 / 宽度 / 百分比 | 工具条 | `currentScaleValue` = `page-fit` / `page-width` / 数字 | M1 |
| 搜索（Ctrl+F） | SearchPanel | `PDFFindController` + 命中高亮 | M1 |
| 文本选择 → 复制 | 浮动工具条 | 文本层 selection | M1 |
| 高亮（4 色）+ 备注 | 工具 H / 选择后浮条 | 6.5.5 highlight | M3 |
| 绘制（颜色、粗细） | 工具 D | 6.5.5 ink | M3 |
| 添加文本 | 工具 T | 6.5.5 text_box（Markdown） | M3 |
| 擦除 | 工具 E | 6.5.5 eraser | M3 |
| 保存副本（带标注） | 导出带标注的 PDF | `annotpdf` | M3 |
| 打印 | 导出菜单 | 导出到临时 PDF 后用系统默认程序打开（`plugin-opener`）；`window.print()` 在 WebView2 里对 canvas 页面效果差（验证） | M3 |
| 选中文本翻译 | 浮条"翻译" → TranslatePanel | 11.8 | M4 |
| 大声朗读 | P2 可选 | `speechSynthesis`（WebView2 提供 Edge 语音；验证） | 之后 |
| 表单填写 | 不做 | | |

#### 6.5.4 PdfViewer

容器底色 slide-bg。内部为 pdf.js `PDFViewer`（`container` 为滚动元素，`textLayerMode: 1`，`annotationMode: ENABLE`（显示 PDF 里已有的注解，只读），`annotationEditorMode: DISABLE`）。每页 `.page` 元素上叠加 `AnnotationLayer`（6.5.5），用 `pagerendered` / `pagechanging` / `scalechanging` / `rotationchanging` 事件同步位置。

滚轮（`pdf/wheelPaging.ts`）：Ctrl + 滚轮以光标为中心缩放。单页模式下页面不能再向该方向滚动时，滚轮翻页，规则照搬 pdf.js PresentationMode：增量归一化为页（像素模式 ÷ 900，行模式 ÷ 30），累计 ≥ 0.1 页翻一页——鼠标一格（Chromium 100 px）正好翻一页，触控板小增量累加；翻页后 50 ms 内忽略后续增量，方向反转或停顿 300 ms 清零。

- 单页模式：`scrollMode = PAGE`，左右方向键、滚轮（一格一页，规则见上）翻页；缩放 > 适应宽度时滚轮先滚动，滚到底后再翻。连续模式：`scrollMode = VERTICAL`，页间距 12。
- 缩放：Ctrl + 滚轮以鼠标位置为中心；Ctrl + `=` / `-` / `0`（0 = 适应宽度）；触控双指。范围 25%–400%。
- 底部居中胶囊（距底 16，高 36，surface 底，1 px border，圆角 999）：`chevron_left`、"7 / 42"（body，tabular）、`chevron_right`。点击页码弹出小输入框跳页。
- 当前页：按 5.4 定义，写 `currentPage` store；live 中 300 ms 防抖后调 `recordingController.onPageRested(index)`。
- replay 自动跟随：`followPages` 为真时，播放位置导致 `pageAt(t)` 变化 → `viewer.currentPageNumber = page + 1`（无动画）。用户手动翻页 → `followPages = false`，TransportBar 的"跟随翻页"chip 变未选中；再次点击 chip 重新跟随并跳到当前页。
- 文本选择（工具 = 选择）：松开鼠标且 selection 非空时，在选区上方 8 px 显示 `SelectionToolbar`（高 36，surface 底，1 px border，圆角 6）：复制、高亮（悬停展开 4 色）、备注（高亮 + 立即打开备注编辑）、翻译、加入笔记、解释。点击空白或 Esc 关闭。"加入笔记"把 `> 原文\n` 追加到当前页笔记末尾（前面空一行）；"翻译" / "解释"见 6.5.10。
- 加载态：灰色矩形 + spinner；渲染失败：居中 caption"这一页无法渲染"。
- 已有 PDF 注解只显示不编辑；导出时保留（`annotpdf` 是追加写入）。

#### 6.5.5 AnnotationLayer（画在 PDF 上的标注，核心新功能）

不用 pdf.js 自带的 AnnotationEditor，原因：它没有公开 API 注入或读取单条标注，数据模型不是我们的，无法做时间轴快照和同步，也不能放 Markdown。自己实现一层：每页一个绝对定位的 `<div class="annotation-layer">`，与 `.page` 同尺寸；内部元素位置用 `coords.ts` 把页面空间换算到当前 `viewport`（`viewport.convertToViewportPoint`），旋转和缩放时重算。z-order：highlight（最底，`pointer-events` 只在选择工具下开启）→ ink（SVG）→ text_box（最上）。

坐标换算（`pdf/coords.ts`）：页面空间是真实 PDF pt；CSS 像素/pt = pdf.js `currentScale × 96/72`（`CSS_PX_PER_PT`，pdf.js 的 `PixelsPerInch.PDF_TO_CSS_UNITS`），不能直接拿 zoom 值当比例。2026-09-15 之前的数据按 zoom 值存储（960 pt 页面被当作 1280 宽，文本框右边界卡在页面 75% 处、导出 PDF 标注偏到 75% 位置），启动时 `data/db/annotationUnits.ts` 一次性把 annotations 与 annotation_snapshot 事件乘 72/96，并写 `sync_state.annotation_units = pt`。

**text_box（Markdown 文本框，对应 Edge"添加文本"）**
- 创建：工具 T 下在页面上点击 → 在点击点创建 260 × 40 pt 的框，进入编辑态；或拖拽画框（最小 60 × 24）。文字色、字号、边框色、填充色取工具条当前默认值（初始：黑、自动、无边框、无填充）。
- 编辑态：框内是 `MarkdownEditor`（6.5.7 同一组件，`compact` 变体：无工具栏、字号 = `font_size`、行高 1.4、内边距 6）。live preview 行为与笔记编辑器一致。失焦、Esc、点击框外 → 渲染态。编辑态下同样显示 8 个把手（可缩放）和四条不可见的边缘抓手（光标 move，拖动即移动，像 Word 拖边框）；迷你条保持可用（按下不抢焦点）。
- 渲染态：`MarkdownView` 渲染，同字号；背景 = `fill_color`（NULL = 透明），边框 = 1 px `border_color`（NULL = 无）——默认两者都没有，像 Word 一样由用户自己选。悬停显示 1 px 虚线 accent outline；选中（单击）显示 2 px accent outline + 8 个缩放把手（8 × 8）+ 顶部迷你条：文字色 5 色块、字号、边框色（无 / 5 色）、填充色（无 / 5 色）、删除，迷你条的每次改动同时写入默认值。选择工具和文本工具下都能拖动框体移动、拖把手缩放（最小 60 × 24 pt）；文本工具下按下不拖动 = 进入编辑态；选择工具下双击进入编辑态。内容超出高度时框自动增高（不裁剪），手动缩放后记住高度、超出部分显示纵向滚动条。
- Delete / Backspace 删除选中框（编辑态内不触发）。
- 每次内容 / 位置 / 尺寸 / 颜色 / 字号变化按 5.6 写快照与表。

**highlight（对应 Edge"高亮"）**
- 来源：选择工具下选中文本 → 浮条选颜色；或工具 H 下直接拖选文本（松开即创建，颜色用工具条当前色）。
- 几何：`Selection.getRangeAt(0).getClientRects()` 逐行合并相邻矩形，换算到页面空间得到 `quads`；`selected_text` = `selection.toString()` 去多余空白。
- 渲染：每个 quad 一个 `<div>`，底色 = color，`mix-blend-mode: multiply`，不透明度 0.45，圆角 2。有备注时在最后一个 quad 右上角画 12 px `chat_bubble` 图标（color 色）。
- 点击（选择工具）→ 弹层（surface，圆角 10，宽 280）：4 色块、备注编辑器（`MarkdownEditor` compact，占位"写点备注…"）、"复制文字"、"删除"。备注失焦保存。
- 重叠的高亮允许存在。

**ink（对应 Edge"绘制"）**
- 工具 D 下 pointer 事件：`pointerdown` 开始一笔，`pointermove` 追加点（用 `getCoalescedEvents()`），`pointerup` 结束。触控笔（`pointerType === 'pen'`）绘制，手指滚动页面（iPad 验证）；鼠标绘制。
- 一笔 = 一条 annotations 行（kind = ink，`strokes_json` 只有一个数组）。同一笔内点用 Douglas–Peucker 简化，ε = 0.5 pt。
- 渲染：每页一个 `<svg>`，每笔一条 `<path>`，`stroke-linecap: round`、`stroke-linejoin: round`、宽度 = `stroke_width` × scale，不填充。
- 选择工具下点击笔画（命中距离 ≤ width/2 + 4 px）选中 → 迷你条：色块、粗细、删除。

**eraser（对应 Edge"擦除"）**
- 工具 E 下按住拖动，鼠标经过的 ink 笔画（命中同上）和 highlight（命中 quad）立即删除；单击也可删。不擦 text_box（用 Delete）。光标 `cursor: cell`。

**通用**
- 撤销 / 重做：内存栈 20 步，Ctrl+Z / Ctrl+Shift+Z，作用于本页标注的创建 / 删除 / 移动 / 缩放 / 改色（不含文本框内的文字编辑，那由编辑器自己的历史处理）。撤销产生的变化同样按 5.6 写快照。
- replay 形态：默认显示 `annotationsAt(page, t)`（"当时的标注"），随播放头变化；顶部工具条右侧 `SegmentedButton` "当时的标注" / "现在的标注"，与 6.5.7 的笔记开关联动（一个开关控制两者）。"当时的标注"只读；"现在的标注"可编辑，只写 `annotations`。
- 缩放 / 旋转时不重新布局标注内容，只变换容器。

**导出带标注的 PDF**（`domain/export_pdf.ts`）
- `annotpdf` 打开原 PDF 字节 → 对每页：highlight → `createHighlightAnnotation({ quadPoints, color, contents: markdown })`；ink → `createInkAnnotation({ inkList, color, border width })`；text_box → `createFreeTextAnnotation({ rect, contents: markdown 源码, fontSize, textColor, color: fill_color（无填充则省略 /C）})` 并写 `/BS << /W 0 | 1 >>`（无 / 有边框）。不写外观流（阅读器自己排文字，中文才能显示），所以边框颜色由阅读器决定（通常同文字色）。坐标按 4.1 换算到左下原点。
- `plugin-dialog.save()` 选路径（默认 `{deck.title} - 标注.pdf`），写入，提示"已导出到 {path}"。
- Markdown 在 FreeText 里以源码形式保存（其他阅读器看到的是原文）；"扁平化导出"（把渲染结果栅格化嵌入）列为可选。

#### 6.5.6 Dock 面板系统（右侧）

用 `dockview-react`。Dock 区默认宽 400（expanded），最小 320，最大 50%，左边 1 px border，surface 底。

**面板注册表**（`dock/panelRegistry.ts`，id 定版）

| id | 标题 | 图标 | reading | live | replay | 说明 |
|---|---|---|---|---|---|---|
| `notes` | 笔记 | `edit_note` | ✓ | ✓ | ✓ | 6.5.7 |
| `annotations` | 标注 | `format_ink_highlighter` | ✓ | ✓ | ✓ | 6.5.8 |
| `outline` | 目录 | `toc` | ✓ | ✓ | ✓ | 6.5.9，与 Rail 目录同源 |
| `search` | 搜索 | `search` | ✓ | ✓ | ✓ | 6.5.9 |
| `translate` | 翻译 | `translate` | ✓ | ✓ | ✓ | 6.5.10 |
| `explain` | 解释 | `lightbulb` | ✓ | ✓ | ✓ | 6.5.10 |
| `transcript` | 转写 | `subtitles` | | ✓ | ✓ | 6.5.11 |
| `summary` | 总结 | `auto_awesome` | | ✓ | ✓ | 6.5.12（live 只显示占位文案） |
| `ask` | 问答 | `forum` | ✓ | ✓ | ✓ | 预留，显示"即将推出"，默认不在布局里 |

每个面板单例（同一 id 只能打开一个）。所有面板可关闭；关闭后从 Dock 区右上角的 `+` 菜单（列出未打开的面板）重新打开；快捷键 Ctrl+1…9 按上表顺序聚焦并在需要时打开。

**默认布局**（`dock/defaultLayouts.ts`）
- reading：一个分组 tabs = [notes, annotations, outline, search, translate, explain]，激活 notes。
- live：上分组 [notes, annotations]（高 60%），下分组 [transcript, translate, explain]，激活 notes 与 transcript。
- replay：上分组 [notes, summary, annotations]，下分组 [transcript, translate, explain]。

**行为**
- tab 可拖到另一分组合并、拖到分组上下边缘分割（dockview 内置）；不允许浮动窗口和弹出窗口（`disableFloatingGroups`、`disablePopoutGroups`）。
- 布局变化 500 ms 防抖后 `api.toJSON()` 写 `sync_state.dock_layout_<mode>`；进入会话页时 `fromJSON`，失败（面板 id 不存在等）回退默认布局。`+` 菜单里有"重置布局"。
- tab 栏高 40，标题 bodySmall w600，激活 tab 下 2 px accent 指示条；面板内容区自己滚动。
- 面板头部（面板内第一行，高 40）由各面板自己定义（见各节）。
- compact：dockview 不启用，面板按注册顺序做底部抽屉的 tab。
#### 6.5.7 NotesPanel（笔记，Obsidian 式）

可靠性（发布审查 F1/F3/PM-03/PM-05）：模式切换和重新挂载都以编辑器当前草稿为准（`MarkdownEditor` 记住最近一次 onChange 的文本，不回退到上次保存值）；`open()` 带请求序号，慢返回的旧页查询不会覆盖正在编辑的页；导出 Markdown 前先 `flush()`；保存失败显示“保存失败，点击重试”并 5 s 自动重试；“加入笔记”在没有编辑器视图时直接落库（不递归）。

头部行（高 40，内边距 0 12）：左"第 7 页"（bodySmall text2）；中 `SegmentedButton` 实时 / 源码 / 阅读（图标 `edit`、`code`、`visibility`，compact 只显示图标；写 `sync_state.editor_mode`）；右保存状态 caption："已保存"（text3）/ "保存中…" / "未保存"（highlight 色）。live 中额外显示"已记录 12:03"（最近一次快照时刻）。

replay 中再加一行 `SegmentedButton`："当时的笔记" / "现在的笔记"（与 6.5.5 的标注开关是同一个状态 `noteViewMode`）。播放中默认"当时的笔记"。

**MarkdownEditor**（`editor/MarkdownEditor.tsx`，包 `packages/editor`，基底 atomic-editor）

三种模式：
- 实时（live preview，默认）：所见即所得地渲染，但底层始终是纯 Markdown 文本。行为（定版，逐条验收）：
  1. 光标不在该行时隐藏语法标记：`#`、`**`、`*`、`~~`、`==`、行内代码的反引号、链接的 `[]()`；光标进入该行时显示原文。
  2. 标题按阶梯字号渲染（h1 24 / h2 20 / h3 17 / h4–h6 15 w600）。
  3. 列表项前渲染圆点 / 数字；任务列表渲染可点击的复选框，点击直接改源码 `[ ]` ↔ `[x]`。
  4. 代码块：Source Code Pro，surface2 底，语法高亮，光标在块内时显示 ``` 围栏。
  5. 表格：光标不在表格内时渲染为表格；进入时显示源码（atomic-editor 的表格编辑模式可选）。
  6. 公式：`$…$` 行内、`$$…$$` 块，光标不在其中时用 KaTeX 渲染，进入时显示源码（`codemirror-live-markdown` 的 mathPlugin）。
  7. 图片 `![](path)` 渲染缩略（宽 ≤ 100%）；链接可 Ctrl+点击打开（`plugin-opener`）。
  8. 引用块左侧 2 px border 线。
  9. 自定义行内语法（`editor/extensions/`）：
     - 时间戳 `[mm:ss]` / `[h:mm:ss]` → chip（highlight 20% 底，圆角 999，内边距 2 6，tabular）。replay 中点击 → seek 到该时刻并翻页；reading / live 中不响应。
     - 页面链接 `[[p7]]` → chip（accent-soft 底）显示"第 7 页"，点击跳到该页（三种形态都响应）。atomic-editor 自带 `[[…]]` wiki link 解析，把目标匹配 `^p(\d+)$` 的当作页面链接，其余按普通文本显示。
  10. 智能列表：回车续列表、Tab / Shift+Tab 缩进、空项回车退出列表。
- 源码：纯 CodeMirror，语法着色，不隐藏标记。
- 阅读：`MarkdownView` 只读渲染，最大宽 680，内边距 16。

编辑器字号 editor 15/24，内边距 16，光标 accent。占位（text3）："在第 7 页写点什么…  支持 Markdown，公式用 $…$"。

工具栏（高 36，编辑器上方，仅实时 / 源码模式）：20 px 图标按钮：加粗、斜体、标题、列表、任务列表、代码、公式、链接、页面链接（插入 `[[p{当前页}]]`）、插入时间（`timer`，仅 live / replay）。每个按钮在光标处插入或包裹选区。插入时间写入 `[hh:mm:ss] `（不足 1 小时省略 hh），时间取 live 的 SampleClock 或 replay 的播放头。

**replay "当时的笔记"**：隐藏编辑器，`MarkdownView` 显示 `noteAt(page, t)`；相对同页上一份快照新增的行（`note_diff.ts`，行级 diff）以 highlight 20% 底色整块高亮；在播放头位于 `[snapshot.t, nextSnapshot.t)` 期间保持高亮。若该时刻尚无快照：居中 caption"这时还没有写笔记"。"现在的笔记"：显示 `notes` 表当前版本，可编辑，改动只写 `notes`。

**保存**：改动后 1500 ms 防抖 → upsert `notes`（dirty）→ live 时另写 `note_snapshot` 事件。切面板、翻页、窗口失焦时立即保存。

#### 6.5.8 AnnotationsPanel（标注列表）

头部行（高 40）：`SegmentedButton` 本页 / 全部；右侧筛选菜单 `filter_list`：文本框 / 高亮 / 墨迹（多选，默认全选）。

列表：每条卡片（内边距 8 12，1 px border 分隔）：左 4 px 竖条用标注色；第一行 caption text2："第 7 页  文本框 / 高亮 / 墨迹"；第二行 body：文本框显示 Markdown 前 2 行（渲染为纯文本）；高亮显示 `selected_text`（最多 2 行）+ 备注（bodySmall text2，有才显示）；墨迹显示"墨迹  3 笔"（同页同色相邻 5 秒内创建的笔画在列表里合并显示，数据仍是多行）。悬停底色 surface2。

点击 → 翻到该页并把标注滚入视图，标注闪一下（边框 accent 300 ms）。右键 / `⋯`：复制为 Markdown（高亮 → `> 原文\n备注`；文本框 → 内容）、删除。

空状态：图标 `format_ink_highlighter` 40 px text3；"这一页还没有标注"；"用工具栏的高亮、绘制、添加文本在页面上做标注。"

#### 6.5.9 OutlinePanel 与 SearchPanel

OutlinePanel：内容与 Rail 目录相同（6.5.2），面板版本行高 32、可折叠子级。

SearchPanel：头部搜索框（前置 `search`，占位"搜索课件、笔记、标注、转写"）+ 范围 chips（课件 / 笔记 / 标注 / 转写，多选，默认全选）。输入 300 ms 防抖。结果分组（组标题 caption text2："课件  12 处"）：
- 课件：`PDFFindController` 逐页命中，行：`第 7 页` + 命中前后各 40 字符上下文，命中文字 highlight 30% 底；点击 → 翻页并让 pdf.js 高亮该处（`findController` 的 `scrollMatches`）。
- 笔记 / 标注：SQLite `LIKE`（不区分大小写），行同上；点击 → 翻页并打开对应面板 / 滚到标注。
- 转写：同 6.5.11 的搜索，点击 → seek。
Ctrl+F 聚焦本面板搜索框（打开面板如未打开）。Enter / Shift+Enter 在课件命中间前进 / 后退。

#### 6.5.10 TranslatePanel（翻译）与 ExplainPanel（解释）

翻译和解释是两个独立面板（id `translate` / `explain`），共用同一实现（`panels/TranslatePanel.tsx`），只在文案和提示词上不同：浮条"翻译"打开翻译面板，浮条"解释"打开解释面板。

头部行（高 40）：目标语言分段 中文 / English（写 `translate_target`，解释面板用它决定解释语言）；右侧"清空"（清空本面板的输入、结果和历史）。

内容：
1. 原文框（多行，最多 8 行后滚动，surface2 底，圆角 6，内边距 8）。从 PDF 浮条进入时自动填入选中文本并立即请求；也可手动粘贴后点"翻译" / "解释"（Ctrl+Enter 同）。
2. 结果区（body，可选中复制）。加载中显示 3 条骨架条。翻译用 11.8 的翻译提示词，解释用解释提示词。
3. 操作行：`复制译文` / `复制解释`、`加入笔记`（追加 `> 原文\n> 结果\n` 到当前页笔记末尾）。
4. 历史（本会话内，每个面板各最多 20 条）：折叠列表，行显示原文前 40 字，点击回填。

未配置 AI 服务：面板显示居中文案"翻译需要先配置 AI 服务" / "解释需要先配置 AI 服务" + 按钮"去设置"。请求失败："翻译失败：{message}" / "解释失败：{message}" + "重试" + "去设置"；连不上服务时 message 为"连接不上 AI 服务（{baseUrl}）。请检查 Base URL 是否正确、服务是否已启动，以及网络或代理设置。"。

#### 6.5.11 TranscriptPanel（转写）

头部行（高 40）：搜索框（前置 `search`，占位"搜索转写"）；右侧 chip：live 时"转写中"（accent-soft，带 6 px 脉动圆点）或"转写关闭"（surface2）或"下载模型"（highlight 20%，点击去 `/settings/asr`）；replay 时"设备转写" / "服务器转写"（来源），有翻译时再加"显示翻译"开关 chip。

列表虚拟滚动，行内边距 8 12：`[ 时间列宽 44（bodySmall text2 tabular，"12:05"），间距 8，Column[ 文本 body，翻译 bodySmall text2（开关打开时）] ]`。相邻段落归属页不同时插入分隔行：1 px border 线 + 居中 caption text3"第 8 页"。

当前段落（replay：`t0 ≤ t < t1`；live：最新一条 final）底色 accent-soft，圆角 6。

自动滚动：replay 保持当前行在面板 35% 高度处；用户手动滚动后停止跟随，底部居中出现浮动胶囊"回到当前"（高 32），点击恢复。live 贴底，用户上滑后出现"回到最新"。

点击行：replay → seek `t0`（页面随之跟随）；live 无响应。

live 部分结果：列表最后一行斜体 text2 显示当前 partial，final 到达后替换为正式行。

空状态（replay 无段落）："这节课没有转写" + "录音上传后会由服务器转写。"；若 `audio_status == local` 且已登录显示按钮"上传录音"；本地模式显示"登录后可以上传录音，由服务器做更准确的转写。"；若已上传显示"服务器正在转写…"。

搜索：不区分大小写过滤行，命中文字用 highlight 30% 底。

#### 6.5.12 SummaryPanel（总结）

- reading：不在面板注册表里。
- live：居中文案"结束录音后可以生成总结"，下方三行 bodySmall text2 说明内容（每页要点、关键概念、你标记没听懂的地方）。
- replay 且 `summary_status == none`：图标 `auto_awesome` 40 px text3；"还没有总结"（subtitle）；"AI 会根据幻灯片、录音转写、你的笔记和标注，按页整理这节课。"（body text2）；"生成总结"（填充 accent）。录音未上传时按钮禁用并显示 caption"需要先上传录音"（旁边给"上传录音"文字按钮）；本地模式显示"生成总结需要登录"。若服务器转写尚未完成，点击后 summary_status = pending，文案"正在转写录音，完成后自动生成总结"。
- pending：3 条骨架灰条 + 线性进度（来自 job.progress）+ caption"正在整理 42 页课件和 1 小时 31 分的录音…"。
- ready，自上而下：
  1. 整课总结卡（surface2 底，圆角 10，内边距 16）：标题（subtitle w600，可编辑）；概述（body）；"关键概念"chips（surface2 底、1 px border、圆角 6）；"作业与截止"列表（有才显示）；"你标记没听懂的地方"行：`[14:22]` chip + "第 7 页" + 一行说明；"建议复习"行："第 N 页" + 原因。
  2. 每页列表：行标题"第 7 页  Hash Collisions"（页码 + AI 标题），默认折叠；`followPages` 为真时当前页自动展开并滚入视图。展开内容：总结（body）、要点列表、术语（术语 — 定义）、引用 chips `[12:05]`（点击 seek + 翻页）。`skipped: true` 的页只显示一行 caption"这一页老师没有展开讲"。
  3. 底部："重新生成"（描边）、"导出 Markdown"（描边）。
  编辑：悬停出现 `edit`，点击内联编辑，保存后 `edited_by_user = true`；"重新生成"前确认"会覆盖你编辑过的内容。"
- error："总结失败：{message}" + "重试"。

#### 6.5.13 TransportBar（高 72）— live

内边距 0 16，元素间距 16，从左到右：

1. `RecordButton` 已移到 SlideToolbar（6.5.3，擦除右边），TransportBar 从计时开始。按钮状态样式：idle = surface2 底 + `mic`（tooltip"开始录音"）；recording = record 底 + 白色 `pause`，外圈 2 px record 色环 1.2 s 循环脉动（透明度 1 → 0.3；`prefers-reduced-motion` 时静止）；paused = record 色描边 + record 色 `mic`。
2. 计时"00:12:03"（title 20，tabular）；下方 caption："准备录音" / "录音中" / "已暂停"。
3. `LevelMeter`：24 根 3 px 竖条，间距 2，高 20；按 RMS dB（−50…0 映射 0…1）点亮，颜色 text2，峰值条 accent；20 fps 更新。
4. `AsrChip`："转写中"（accent-soft）/ "转写关闭"（surface2）/ "下载模型"（highlight 20%，点击去设置）。
5. 弹性空白。
6. `MarkerBar`：三个 44 × 44 按钮，间距 8：重点 `star`（mark-important）、没听懂 `help`（mark-confused）、作业 `assignment`（mark-homework）；图标 20 + 下方 caption 标签。点击：写 `marker` 事件，按钮以标记色填充闪一下 300 ms，时间轴立刻出现 pin。未录音时禁用，tooltip"开始录音后可以标记"。
7. "结束这节课"（描边按钮，record 色文字和边）。

#### 6.5.14 结束录音流程

确认框：标题"结束这节课？"，正文"录音会保存到本地，接着可以上传并生成总结。"，按钮"继续录音" / "结束"（填充 record）。确认后：`audio_stop` 命令（停止流 → WAV finalize → 返回 duration_ms）→ 写 `recording_state: stopped` 事件 → `ended_at = now`、`duration_ms`、`audio_status = local` → 页面原地切换为 replay 形态（不导航）→ 已登录且有网络则自动开始上传（顶部同步点变黄，转写面板空状态显示进度）。

#### 6.5.15 TransportBar（高 72）— replay

1. `PlayButton` 48 圆，accent 底，白色 `play_arrow` / `pause`。
2. 时间："00:12:03"（title 20 tabular）+ " / 01:31:20"（bodySmall text2）。
3. `replay_10`、`forward_10` 各 40 × 40。
4. 速度文字按钮"1.0×"，菜单 0.75 / 1.0 / 1.25 / 1.5 / 2.0，写 `sync_state.playback_speed`。
5. 弹性空白。
6. `FilterChip`"跟随翻页"，默认选中（accent-soft）。判定手动翻页：以播放器自己跳到（或所在）的页为基准，当前页与之不同即视为用户翻页并关闭跟随。
7. 标记导航：三个小按钮带计数"重点 3" / "没听懂 2" / "作业 1"，点击跳到播放头之后的下一个该类标记（循环）。

#### 6.5.16 live 的"准备"态

进入 `/session/:id` 且尚未按录音：SlideToolbar 显示 idle 录音键，TransportBar 计时"00:00:00"，caption"准备录音"。PdfViewer 顶部出现一次性横幅（surface 底、1 px border、高 40）："翻到老师讲的那一页，点工具栏上的录音键开始录音。"，右侧关闭按钮。按下录音时把当前页写入 `session.initial_page_index`，写 `started_at` 和 `recording_state: started`。启动失败（数据库、监听）会回滚并停止原生采集，界面不会显示空闲而麦克风仍在录。录音期间离开会话页（设置、模型页、课程库）时页面顶部显示录音横幅（状态、计时、回到课堂、结束录音）；另一节课正在录音时打开新课堂会弹出提示，录音归属不会被切换；录音中删除课堂先停止录音。设备断开发 `audio://state: interrupted`（暂停，“继续录音”重建音频流），WAV 写入失败发 `error`（自动结束并保留已录部分）。

#### 6.5.17 TimelineScrubber（高 28）— live 与 replay

`<canvas>` + pointer 事件，全宽，内边距 0 16。自下而上绘制：

- 轨道：高 16，垂直居中。每个 `PageInterval` 一个矩形，奇偶交替 surface2 / border 色（深色用 surface2 / `#323949`）。live 时当前 interval 随时间实时延长。带宽 ≥ 40 px 时在带内居中画页码 caption text3。每 5 分钟一根 1 px text3 刻度。
- 快照刻度：每个 `note_snapshot` 在轨道底边画 1.5 px 宽 × 6 px 高 highlight 竖线；每个 `annotation_snapshot`（op = created）画 1.5 × 4 px accent 竖线。
- 标记 pin：每个 `marker` 在轨道上边缘画 8 px 圆（标记色，1 px surface 描边）。
- 播放头：2 px accent 竖线贯穿全高 + 顶部 10 px 圆形把手（replay）；live 用 record 色竖线表示"现在"，位于轨道右端。

交互（replay）：点击 / 拖动 seek；拖动时视觉立即跟随，每 200 ms 和松手时调用 `audio.currentTime = …`。悬停 tooltip："第 7 页  12:03–15:40"；悬停在 pin 上显示"没听懂  14:22"，点击 pin 直接 seek。live 只读。按 `devicePixelRatio` 绘制。

#### 6.5.18 崩溃恢复

app 启动时查询 `ended_at IS NULL` 且 WAV 文件存在的 session → 对话框"上次录音没有正常结束"，正文"{title}，已录 47 分钟。"，按钮"丢弃"（二次确认）/ "保存并结束"。后者先调 Rust `wav_repair` 命令按文件里实际的 PCM 长度重写 RIFF/data 头（崩溃时头部可能仍是 0 或旧值，播放器会看到空文件或截断），得到 `duration_ms = samples * 1000 / 16000`，再 `ended_at = now`、补写 `recording_state: stopped` 事件在 `duration_ms`。“丢弃”删除记录和录音文件。

### 6.6 手势、快捷键、文案

**手势**：左右滑翻页（单页模式）；双指缩放；双击缩放 1× ↔ 2×；触控笔绘制、手指滚动；长按缩略图菜单；转写行点击 seek。

**快捷键**（除标注"编辑器内"外，焦点在文本框时不触发）：

| 键 | 动作 |
|---|---|
| ← / →，PageUp / PageDown | 上一页 / 下一页 |
| Space、K | 播放 / 暂停（replay） |
| J / L | −10 s / +10 s |
| V / H / D / T / E | 选择 / 高亮 / 绘制 / 添加文本 / 擦除 |
| Delete、Backspace | 删除选中标注 |
| Ctrl + Z / Ctrl + Shift + Z | 撤销 / 重做标注 |
| Ctrl + = / − / 0 | 放大 / 缩小 / 适应宽度 |
| Ctrl + 1 … 9 | 聚焦当前形态面板注册表里的第 N 个面板（笔记 / 导图 / 标注 / 目录 / 搜索 / 翻译 / 解释 / 转写 / 总结） |
| Ctrl + E | 循环 实时 → 源码 → 阅读（编辑器内也可） |
| Ctrl + Shift + T | 插入时间戳（编辑器内） |
| Ctrl + B / I | 加粗 / 斜体（编辑器内） |
| Ctrl + \ | 收起 / 展开右侧 Dock |
| Ctrl + Shift + \ | 收起 / 展开左侧 Rail |
| Ctrl + Shift + R | 开始 / 结束录音（结束走确认） |
| F1 / F2 / F3 | 重点 / 没听懂 / 作业（live） |
| Ctrl + F | 聚焦搜索面板 |
| Ctrl + Shift + E | 导出带标注的 PDF |
| Esc | 退出编辑态 / 取消选择 / 关闭弹层 |

macOS 上 Ctrl 换成 ⌘。快捷键统一在 `SessionScreen` 根节点的 `keydown` 处理器里分发，不散落在组件里。

**文案（定版，集中在 `core/strings.ts`）**：
- 提示：已保存 / 已上传录音 / 开始生成总结 / 已导出到 {path} / 网络不可用，稍后会自动同步。
- 错误：麦克风权限被拒绝  在系统设置里允许访问麦克风后重试。/ 上传失败，稍后会自动重试。/ 转写模型加载失败，录音会继续但没有实时转写。/ 翻译失败：{message} / 解释失败：{message}
- 按钮动词与结果一致："生成总结" → 提示"开始生成总结"；"上传录音" → "已上传录音"。

**离线 / 本地模式**：顶栏同步点变灰；本地功能全部可用；上传与推送进入队列（本地模式不入队）。

**可访问性**：所有图标按钮有 `aria-label`（"上一页""开始录音"等）；布局在浏览器缩放 130% 下不溢出；文字对比度 ≥ 4.5:1；键盘可达。

---

## 7. 音频与端侧转写管线（Rust 侧）

### 7.1 Tauri command 与事件（定版）

前端只通过 `platform/audio.ts`、`platform/asr.ts`、`platform/models.ts` 调用。

| command | 参数 | 返回 | 说明 |
|---|---|---|---|
| `audio_start` | `{ wav_path }` | — | 请求权限、开流；权限拒绝返回错误 `mic_permission_denied` |
| `audio_pause` / `audio_resume` | — | — | |
| `audio_stop` | — | `{ duration_ms }` | finalize WAV |
| `audio_status` | — | `{ state, t_ms }` | 崩溃恢复与页面重进时查询 |
| `wav_probe` | `{ path }` | `{ duration_ms }` | 读头部与文件长度 |
| `asr_start` | `{ model_dir, lang_mode }` | — | 加载模型并开始消费 PCM |
| `asr_stop` | — | — | |
| `models_download` | `{ id, url, sha256 }` | — | 进度经事件 |
| `models_delete` | `{ id }` | — | |
| `file_sha256` | `{ path }` | `{ sha256 }` | |
| `wav_repair` | `{ path }` | `{ duration_ms, samples }` | 崩溃恢复：按实际 PCM 长度重写 WAV 头，只接受本应用的 16 kHz/mono/16-bit 布局 |
| `models_verify` / `models_cancel` / `models_active` | 见 7.6 | | 模型哈希校验、取消下载、进行中的下载列表 |
| `print_file` | `{ path }` | — | 用系统“print”动词打印（无处理程序时报错，前端改为打开所在文件夹） |

事件（`listen`）：

| 事件 | payload | 频率 |
|---|---|---|
| `audio://tick` | `{ t_ms }` | 10 Hz |
| `audio://level` | `{ db }` | 20 Hz |
| `audio://state` | `{ state: "recording" / "paused" / "stopped" / "interrupted" }` | 变化时 |
| `asr://partial` | `{ text }` | 变化时 |
| `asr://final` | `{ t0_ms, t1_ms, text }` | 端点触发时 |
| `asr://status` | `{ status: "loading" / "ready" / "error", message? }` | 变化时 |
| `models://progress` | `{ id, progress, status }` | ≤ 5 Hz |

### 7.2 采集（`audio/capture.rs`）

- `cpal` 默认输入设备。优先请求 16 kHz / mono / i16；设备不支持时用其默认配置（常见 44.1 / 48 kHz、f32、多声道），在回调里混合为单声道并用 `rubato` 重采样到 16 kHz，再转 i16。
- 回调线程只做：拷贝到无锁队列。工作线程从队列取：`WavWriter.write(chunk)` → `SampleClock.add(n)` → 算 RMS 发 `audio://level` → 转发给 ASR 引擎的 channel。
- `pause` / `resume`：停止 / 重建 cpal stream；WAV 保持打开，resume 追加到同一文件；时钟按样本数自然停止与继续。每次由前端写 `recording_state` 事件。
- 设备断开（cpal 错误回调）→ 发 `audio://state: interrupted`，前端顶部横幅"录音被打断，点继续"，按钮"继续录音"。
- Windows 上录音期间用 `SetThreadExecutionState` 或 Tauri 的 `prevent_sleep`（验证可用性）防止系统睡眠。

### 7.3 WavWriter（`audio/wav_writer.rs`）

`File` 写 44 字节 RIFF 头占位（16 kHz、mono、16 bit），追加 PCM；**每 5 秒和 finalize 时回写 RIFF / data 长度**（`seek` + `write` + `flush`），保证崩溃时文件仍可播放。

### 7.4 SampleClock（`audio/sample_clock.rs`）

`total_samples: AtomicU64`；`t_ms = total_samples * 1000 / 16000`；以 10 Hz 发 `audio://tick`。

### 7.5 ASR 引擎（`asr/engine.rs`，官方 `sherpa-onnx` crate）

队列有界（256 块）：解码跟不上实时时，录音线程丢弃送往引擎的音频并发送 Gap，引擎按样本数推进时钟（转写时间轴不漂移）、结束当前假设并上报 `lagging`（UI 显示“转写延迟”）；停止时先停麦克风、封 WAV，再最多 3 s 排空队列后 join。设备→写盘队列同样有界（1024 块，回调 try_send 不阻塞）。

独立线程消费 PCM channel。配置对应 sherpa-onnx 的 `OnlineRecognizerConfig`：transducer（encoder / decoder / joiner）、tokens、`num_threads: 2`、`model_type: "zipformer"`、`enable_endpoint: true`、`rule1_min_trailing_silence: 2.4`、`rule2_min_trailing_silence: 1.2`、`rule3_min_utterance_length: 20`、`decoding_method: "greedy_search"`。

解码循环：`stream.accept_waveform(16000, samples_f32)`（i16 / 32768）；`while recognizer.is_ready(&stream) { recognizer.decode(&stream) }`；取 `result.text`，变化则发 partial；`recognizer.is_endpoint(&stream)` 且文本非空 → 发 final → `recognizer.reset(&stream)`。

时间戳取法（定版，常数按 15.4 的实测修订）：
- `t0_ms`：本段第一次出现非空 partial 时的音频位置减 600 ms（补偿编码器 chunk 与喂入延迟），并不小于上一段的 `t1_ms`。
- `t1_ms`：endpoint 触发时的音频位置减 1600 ms（1.2 s 尾部静音 + 同样的延迟），并不小于 `t0_ms + 200`。
- “音频位置” = 引擎挂接时的 SampleClock + 已喂入样本数 / 16，不用实时时钟，解码落后时也不漂移。
- 若 `result.timestamps` 非空且单调，可选用 `segment_base_ms + timestamps[0] * 1000` 替代 `t0_ms`，但必须先用一段已知音频验证参考系；不确定就用上面的规则。

每条 final 由前端写一行 `transcript_segments`（source = `device`），不进 events 表。模型加载失败 → `asr://status: error`，录音继续。

### 7.6 ModelManager（`asr/model_manager.rs`）

模型清单（`core/asrModels.ts`）含每个文件的精确字节数和 SHA-256。下载完成时大小与哈希都必须匹配才 ready；启动时按“常规文件 + 大小”核对，未做过哈希校验的目录后台 `models_verify`，不通过显示“校验失败，重新下载”。同一模型不能并发下载（后端按 id 登记），下载可取消，连接 20 s / 读 60 s 超时；离开再进入模型页不会重置进行中的下载。

- 清单：`GET /v1/asr-models`（已登录）或打包在 app 里的 `models.json`（本地模式，同结构）：`[{ "id": "zipformer-bilingual-zh-en-int8", "name": "中英双语（流式）", "size_bytes": 0, "url": "https://cdn.你的域名/asr/….zip", "sha256": "…", "files": { "encoder": "encoder.onnx", "decoder": "decoder.onnx", "joiner": "joiner.onnx", "tokens": "tokens.txt" } }, { "id": "zipformer-en-int8", "name": "English（流式）", … }]`。模型来源：sherpa-onnx 发布的 `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`（int8）与 `sherpa-onnx-streaming-zipformer-en-2023-06-26`（int8），重新打成 zip 放自己的 CDN，不要指向 GitHub。
- 下载到临时目录、校验 sha256、解压到 `asr_models/<id>/`，进度发 `models://progress`，前端写 `asr_models` 表。
- 语言设置 自动 / 中文 → 双语模型；English → en 模型。首次进入 live 且没有 ready 模型时不阻塞录音，只在 AsrChip 提示"下载模型"。

### 7.7 RecordingController（`features/session/controllers/recording.ts`，zustand store）

```ts
interface RecordingState { status: 'idle' | 'recording' | 'paused'; tMs: number; levelDb: number;
  asr: 'off' | 'loading' | 'on' | 'error' | 'no_model'; partial: string; currentPage: number }
// 方法
start(); pause(); resume(); stop(): Promise<void>;
onPageRested(index: number);          // 5.4 规则后写 page_change
addMarker(kind: MarkerKind);
onNoteChanged(page: number, md: string);          // 交给 NoteSnapshotter 防抖
onAnnotationChanged(op, annotation);              // 交给 AnnotationSnapshotter，5.6
```

全局单例，同一时间只有一个 live 会话。`NoteSnapshotter` / `AnnotationSnapshotter` 按 5.3 / 5.6 决定何时写事件并 upsert 表。

### 7.8 PlaybackController（`features/session/controllers/playback.ts`）

包装一个隐藏的 `<audio>`：状态 `{ playing, positionMs, durationMs, speed }`；`seek(ms)`、`skip(±10000)`、`setSpeed()`。位置用 `requestAnimationFrame` 读取并节流到 30 Hz 写 `playhead` store。音源：本地 WAV / m4a 优先（`convertFileSrc`）；没有则用 `GET …/audio/download-url` 的 URL 直接流播（支持 range），同时后台下载到 `sessions/<id>.m4a`。

### 7.9 平台差异与后续平台

- Windows / macOS：以上 Rust 管线原样运行。macOS 需要 `NSMicrophoneUsageDescription` 与 entitlements（2.4）。
- iPadOS（M13）：cpal 在 iOS 上可用但后台与音频会话管理不可靠，改为 Tauri 移动插件（Swift）：`AVAudioSession(.playAndRecord)` + `AVAudioEngine` input tap → 转 16 kHz mono i16 → 通过插件事件把 PCM chunk 送回 Rust 侧的同一条队列（WavWriter / SampleClock / ASR 不变）。`UIBackgroundModes: [audio]` 保证锁屏继续录。sherpa-onnx crate 的 iOS 静态库链接方式在 M13 验证。
- 现成插件 `tauri-plugin-audio-recorder`（cpal + AVAudioRecorder + MediaRecorder）只能录成文件、不给 PCM 流和电平，不能直接用，但其 iOS / Android 部分可作为插件骨架参考。

### 7.10 备选方案（验证后决定是否需要）

若官方 `sherpa-onnx` crate 在某平台编译或链接失败：改用 sherpa-onnx 的 WebAssembly 构建在 Web Worker 里跑流式识别，PCM 由 Rust 通过事件送到前端（每 100 ms 一包，base64 或 `Uint8Array`）。单线程性能足以跑 int8 流式 zipformer（sherpa-onnx 官方有浏览器实时 demo）。时间戳规则不变，SampleClock 仍在 Rust。

---
## 8. 本地存储与同步

### 8.1 触发

`SyncEngine.run()` 在：登录成功；app 启动（已登录）；`navigator.onLine` 恢复；前台每 60 s；任何本地写入后 5 s 防抖。同一时间只跑一个实例。本地模式下引擎不启动，写入只置 `dirty`，登录后一次性推送。

### 8.2 推送 `POST /v1/sync/push`

```json
{
  "device_id": "…",
  "entities": { "courses": [], "decks": [], "sessions": [], "notes": [], "annotations": [],
                "transcript_segments": [], "page_summaries": [], "session_summaries": [] },
  "events": [ { "id": "…", "session_id": "…", "type": "page_change", "t_ms": 723000,
                "payload": { "page_index": 7 }, "device_id": "…", "created_at": "…" } ]
}
```

- 每批最多 200 个实体、500 个事件；本地 `dirty = true` / `synced = false` 的行分批推。
- 服务端：实体按 `updated_at` LWW（更新则替换；否则忽略并把服务端版本放进 `rejected` 让客户端覆盖本地）；事件按 `id` insert-ignore。
- 响应：`{ "server_seq_max": 12345, "accepted_event_ids": [...], "rejected": { "notes": [ {…服务端版本…} ] } }`。客户端据此清 dirty / 置 synced，并用 rejected 覆盖本地。

### 8.3 拉取 `GET /v1/sync/pull?events_since=<seq>&entities_since=<iso>&cursor=`

响应：`{ "events": [...], "entities": {...}, "server_seq_max": 12345, "server_time": "…", "next_cursor": null }`。事件 insert-ignore；实体 LWW（本地 dirty 且更新则保留本地）；每页 1000 事件，跟着 `next_cursor` 拉完。游标写 `sync_state`。

### 8.4 删除

软删除：`deleted_at` 置值，作为普通实体更新同步。客户端查询一律过滤 `deleted_at IS NULL`。

### 8.5 文件

- 课件：deck 推送后若 `remote_key` 为空 → `POST /v1/decks/{id}/upload-url` → PUT 到预签名 URL → `POST /v1/decks/{id}/process`。其他设备拉到 deck 但无本地文件 → 打开时 `GET /v1/decks/{id}/download-url` 下载。
- 录音：结束后 → `POST /v1/sessions/{id}/audio/upload-init { "size_bytes": n }` → `{ "upload_id", "part_size": 8388608, "part_urls": [...] }`（S3 multipart）→ 逐片 PUT，已完成分片记入 `uploads` 表可续传 → `POST …/audio/upload-complete { "upload_id", "etags": [...] }` → 服务端入队 10.2。成功后按设置删除本地 WAV。

### 8.6 冲突

notes、annotations 用 `updated_at` LWW，v2 不做文本合并。

---

## 9. 后端 API（全部前缀 `/v1`，JSON，错误体 `{ "error": { "code": "…", "message": "…" } }`）

| 方法与路径 | 请求 | 响应 |
|---|---|---|
| POST `/auth/request-code` | `{ email }` | 204；限流 3 次 / 10 分钟 |
| POST `/auth/verify` | `{ email, code, device: { id, name, platform } }` | `{ access_token, refresh_token, user: { id, email } }` |
| POST `/auth/refresh` | `{ refresh_token }` | 同上 |
| GET `/me` | | `{ id, email }` |
| POST `/sync/push` | 8.2 | 8.2 |
| GET `/sync/pull` | 8.3 | 8.3 |
| POST `/decks/{id}/upload-url` | `{ content_type, size_bytes }` | `{ url, key, headers }` |
| POST `/decks/{id}/process` | | `{ job_id }` |
| GET `/decks/{id}/download-url` | | `{ url, expires_at }` |
| POST `/sessions/{id}/audio/upload-init` | `{ size_bytes }` | `{ upload_id, part_size, part_urls }` |
| POST `/sessions/{id}/audio/upload-complete` | `{ upload_id, etags }` | `{ job_id }` |
| GET `/sessions/{id}/audio/download-url` | | `{ url, expires_at }` |
| POST `/sessions/{id}/summarize` | `{ force: bool }` | `{ job_id }` |
| POST `/sessions/{id}/ask` | `{ question }` | 501（预留，11.5） |
| GET `/jobs/{id}` | | `{ id, kind, status, progress, error, result }`，status = queued / running / done / error |
| GET `/asr-models` | | 7.6 清单 |

错误码：`unauthorized`、`not_found`、`validation`、`rate_limited`、`conflict`、`payload_too_large`。所有接口除 auth 外要求 `Authorization: Bearer`。

---

## 10. 服务端处理

### 10.1 课件处理任务 `deck_jobs.process_deck`

1. 从对象存储下载原件。
2. pptx：`soffice --headless --convert-to pdf --outdir <tmp> <file>`（超时 120 s）；用 python-pptx 逐页取文本（所有 shape 的 text_frame）和 `notes_slide.notes_text_frame.text`。
3. PDF（含转换产物）：PyMuPDF 逐页 `page.get_text("text")`、页面尺寸。
4. upsert `deck_pages`（服务端权威，`updated_at` 取 now，使客户端拉取时覆盖）；转换产物上传到 `decks/{user_id}/{deck_id}.pdf`，写 `decks.remote_key`、`page_count`、`status = ready`；失败写 `error` 与 `error_message`。

### 10.2 录音处理任务 `audio_jobs.process_audio`

1. 下载 WAV。
2. 转码：`ffmpeg -i in.wav -ac 1 -c:a aac -b:a 48k out.m4a` → 上传 `audio/{user_id}/{session_id}.m4a`，写 `audio_m4a_key`，`audio_status = processed`。
3. 二次转写，provider 接口：

```python
class AsrProvider(Protocol):
    def transcribe(self, wav_path: str, lang_hint: str | None) -> list[Segment]:  # Segment(t0_ms, t1_ms, text, lang)
        ...
```

faster-whisper 实现：`word_timestamps=True`、`vad_filter=True`；按句号 / 问号 / 停顿 ≥ 700 ms 切段，单段 ≤ 12 s；`lang_hint` 来自 `sessions.lang_mode`（auto 时不指定）。删除该 session 旧的 `source = server` 行后写入新行。
4. 翻译：`lang_mode` 为 auto / zh 且段落语言为 en 时，每 40 段一批调用 LLM（提示词 10.3），写 `translation`。
5. 用 `services/timeline.py`（与 5.2 同规则）为每段填 `page_index`。
6. `asr_status = server_done`。若 `summary_status == pending` → 入队 11.4。
7. WAV 保留 7 天后删除（定时任务）。

### 10.3 翻译提示词（`prompts/translate.md`）

```
你是课堂录音的翻译助手。下面是一位老师上课时的英文转写片段，按 JSON 数组给出，每项有 id 和 text。
把每一段翻译成简体中文，保留术语的英文原文（用括号附在中文后，例如"哈希冲突（hash collision）"），口语中的重复和停顿词可以省略。
只输出 JSON 数组：[{"id": "...", "translation": "..."}]，不要输出其他内容。
```

---

## 11. AI 层

### 11.1 上下文构建 `services/context_builder.py`（客户端 `domain/session_bundle.ts` 生成同一结构，11.7）

输入：session、deck_pages、events、notes、annotations、transcript_segments（优先 `server`，没有则 `device`）、markers。输出：

```python
@dataclass
class PageContext:
    page_index: int
    slide_text: str
    speaker_notes: str | None
    talk_ms: int                            # 该页所有 interval 时长之和
    transcript: list[tuple[int, str]]       # (t_ms, text)
    live_notes: list[tuple[int, str]]       # (t_ms, 新增的行)，由相邻笔记快照 diff 得到
    live_annotations: list[tuple[int, str]] # (t_ms, 一行描述)，由 annotation_snapshot(created/updated) 得到，见下
    final_note: str                         # notes 表当前版本
    final_annotations: list[str]            # 当前存活标注的一行描述
    markers: list[tuple[int, str]]          # (t_ms, kind)
    skipped: bool                           # talk_ms < 20000 且无笔记无标注无标记

@dataclass
class SessionContext:
    course_name: str; deck_title: str; date: str; duration_ms: int
    pages: list[PageContext]
    lang: str                               # 输出语言，默认 zh
```

标注的一行描述（定版）：text_box → `文本框：{markdown 压成一行，≤ 200 字}`；highlight → `高亮"{selected_text ≤ 120 字}"` + （有备注时）`，备注：{markdown}`；ink → `墨迹（{n} 笔）`（墨迹只计数，不描述）。

规则：段落归页用中点规则；`live_notes` 按同页快照时间顺序做行级 diff，只保留新增行。

单页的文本渲染（喂给 11.2）：

```
## 第 {n} 页
### 幻灯片文本
{slide_text}
### 老师备注
{speaker_notes 或 "无"}
### 老师讲了什么（{talk_ms 换算成分秒}）
[12:05] …
[13:10] …
### 我当时记的
[12:40] 开放寻址 = 探测
[12:52] 高亮"linear probing"，备注：和二次探测的区别？
### 我的最终笔记
{final_note 或 "无"}
### 我在页面上的标注
{final_annotations 每行一条，或 "无"}
### 我的标记
[14:22] 没听懂
```

### 11.2 单页总结提示词（`prompts/page_summary.md`）与输出结构

system：

```
你是一个帮助大学生复习的助教。你会拿到一节课中某一页幻灯片的内容、老师在这一页讲的话（带时间戳）、学生当时记的笔记、页面上的标注和标记。
用简体中文输出（术语保留英文原文）。总结要忠于老师实际讲的内容，幻灯片上有但老师没讲的不要展开。学生高亮和标注过的内容优先覆盖。
时间戳只能引用输入里出现过的。只输出 JSON。
```

user：`{11.1 的单页文本}` +

```
按下面的 JSON 结构输出：
{"title": "这一页的主题，≤ 12 字",
 "summary": "≤ 3 句、≤ 120 字",
 "key_points": ["≤ 5 条"],
 "terms": [{"term": "", "definition": ""}],
 "examples": ["老师举的例子，没有则空数组"],
 "open_questions": ["学生标记没听懂或笔记、标注里的疑问，用一句话说明老师是怎么解释的；没有则空数组"],
 "citations": [{"t_ms": 725000, "why": "这个时刻在讲什么"}]}
```

`page_summaries.content_json` 即此结构，外加 `"skipped": true/false`。

### 11.3 整课总结提示词（`prompts/session_summary.md`）与输出结构

system 同 11.2，另加"你拿到的是每一页的总结、学生的标记和最终笔记，请整理整节课。"

user：课程名、课件名、日期、时长；所有页总结的 JSON（跳过的页只给页码和 `skipped`）；所有标记；最终笔记全文。要求输出：

```
{"title": "这节课的标题，≤ 20 字",
 "overview": "≤ 5 句的概述",
 "structure": [{"page_range": [0, 5], "topic": "这几页讲的主题"}],
 "key_concepts": ["≤ 8 个"],
 "homework": [{"text": "", "t_ms": null}],
 "confusion_points": [{"t_ms": 862000, "page_index": 7, "what": "学生没听懂的点", "explanation": "老师当时的解释，≤ 2 句"}],
 "review_suggestions": [{"page_index": 7, "reason": "为什么值得回看"}]}
```

### 11.4 执行 `summary_jobs.summarize_session`

1. 若 `asr_status != server_done` 且没有任何转写 → 任务失败 `error = "no_transcript"`；若有 device 转写则用它继续。
2. 构建 SessionContext；非 skipped 页并发 4 路调用 11.2（`temperature 0.2`，`response_format: json_object`）；解析失败重试一次并在 user 末尾追加"只输出 JSON"。
3. 全部页完成后调用 11.3。
4. upsert `page_summaries` / `session_summaries`（`edited_by_user = false`，除非 `force = false` 且已有用户编辑的行则跳过该行），`summary_status = ready`。
5. `job.progress = 已完成页数 / 总页数`，客户端轮询 `GET /jobs/{id}` 每 3 s。

### 11.5 预留：问答接口

`POST /sessions/{id}/ask { question }`，SSE 流式回答，检索 = 关键词命中的 PageContext + 该页转写；回答须带 `[t_ms, page_index]` 引用。v2 不实现，路由返回 501，客户端 AskPanel 显示"即将推出"。

### 11.6 导出 Markdown（客户端 `domain/export_markdown.ts`）

```
# {session.title}
{course}  {date}  {时长}

## 整节课
{overview}
关键概念：…
作业：…

## 第 7 页  {page title}
> {summary}
- 要点…
[12:05] 引用 → 写成 `12:05`（纯文本）

### 笔记
{final_note}

### 标注
- 高亮"linear probing"  备注：…
- 文本框：…

### 转写
[12:05] …
```

reading 形态（没有会话）导出的是课件笔记：`# {deck.title}` + 每页的"笔记"与"标注"。保存到用户选择的位置（`plugin-dialog.save()`）；提示"已导出到 {path}"。

### 11.7 AI 可读的会话包 `SessionBundle`（`domain/session_bundle.ts`，定版）

一个 JSON 文件把一节课的全部内容打包，供任何 AI 工具读取（也是服务端 context_builder 的输入格式）。菜单"导出 AI 数据包"生成 `{session.title}.markpdf.json`：

```json
{ "version": 1,
  "session": { "id": "…", "title": "…", "course": "…", "deck": "…", "date": "2026-09-07", "duration_ms": 5480000, "lang_mode": "auto" },
  "pages": [ { "page_index": 0, "width_pt": 960, "height_pt": 540, "text": "…", "speaker_notes": null } ],
  "timeline": { "intervals": [ { "page_index": 0, "t0_ms": 0, "t1_ms": 84000 } ],
                "markers": [ { "t_ms": 862000, "kind": "confused", "page_index": 7 } ] },
  "notes": [ { "page_index": 7, "markdown": "…", "snapshots": [ { "t_ms": 760000, "markdown": "…" } ] } ],
  "annotations": [ { "id": "…", "page_index": 7, "kind": "highlight", "color": "#F5C542", "selected_text": "…", "markdown": "…", "quads": [[…]], "created_t_ms": 752000 } ],
  "transcript": { "source": "server", "segments": [ { "t0_ms": 725400, "t1_ms": 731900, "text": "…", "translation": "…", "lang": "en", "page_index": 7 } ] },
  "summary": { "session": {…11.3…}, "pages": [ {…11.2…} ] } }
```

`created_t_ms` 取该标注第一条 `annotation_snapshot` 的 `t_ms`（reading 形态创建的为 null）。

### 11.8 翻译面板与"解释"提示词（客户端直连，`core/prompts.ts`）

翻译（system）：
```
你是学术文本翻译助手。把用户给出的文本翻译成{target}，保留术语的原文（用括号附在译文后），保留公式和代码原样，不要添加解释。只输出译文。
```

解释（system）：
```
你是帮助大学生理解课件的助教。用户给出课件里的一段文字，用{target}解释它在说什么，≤ 4 句，术语保留原文。如果文字本身是个定义或公式，先用一句话说明它的直观含义，再说明关键项。只输出解释。
```

user = 选中文本。`temperature 0.2`。上下文可选附加当前页 `deck_pages.text` 前 800 字（system 末尾追加"这段文字来自下面这页课件：…"）。

### 11.9 LLM 配置

- 客户端：设置里的 `llm_base_url` / `llm_api_key` / `llm_model`，请求走 `plugin-http`，路径 `{base_url}/chat/completions`。API key 只存本机 `sync_state`，不同步、不上传。
- 服务端：环境变量（2.3）。总结任务在服务端跑，翻译面板在客户端跑。

---

## 12. 里程碑与验收标准（按顺序交给实现者）

每个里程碑一个任务。附上标注的章节，要求实现者完成后逐条对照验收标准自检并给出未完成项，同时把"验证"项的结论写回本文档。

### M0 骨架（引用 2、3、4、6.1、6.2、6.3）

做：`npm create tauri-app`（React + TypeScript + Vite）；目录按第 3 节；`tokens.css`、主题切换、字体资源；`AdaptiveShell`；react-router 全部路由（页面先放占位）；`plugin-sql` 迁移文件建全第 4 节表；`repos/` 每表基本 CRUD；`sync_state.device_id` 首次启动写入；dockview 空壳（三个占位面板）跑通；`vitest` 跑通一个 `fmtClock` 测试；Rust 侧 `file_sha256` 命令跑通。

验收：
- 装好 Rust 与 C++ Build Tools 后 `npm run tauri dev` 在 Windows 启动到课程库占位页。
- 切换系统深浅色，token 颜色随之变化；设置里固定深色后不再跟随。
- 首次启动创建 `markpdf.db`，`sync_state.device_id` 已写入。
- 窗口宽度跨过 600 / 1024 时外壳在 NavigationBar 与 NavigationRail 间切换。
- Dock 空壳里拖一个 tab 到另一分组、重启后布局保持。

### M1 课程、PDF 导入、阅读器（引用 6.4.2、6.4.3、6.4.4（仅 PDF）、6.5.1–6.5.4、6.5.9、6.6）

做：课程库与课程页；新建 / 重命名 / 删除课程；PDF 导入（复制、页数、逐页文本、sha256 去重）；SessionScreen reading 形态：ThumbnailRail（缩略图 + 目录）、SlideToolbar（缩放、旋转、单页 / 连续、搜索）、PdfViewer（文本层、选择、浮动工具条的"复制"和"加入笔记"占位）、SearchPanel（课件范围）、快捷键、三个布局档位。Dock 里其他面板仍是占位。

验收：
- 导入一份 100 页 PDF，从点击到打开 ≤ 5 s；翻页 ≤ 100 ms；缩放平滑无白屏。
- 单页 / 连续切换后当前页保持；旋转后缩略图与页码正确。
- 有书签的 PDF 目录树可点击跳转；Ctrl+F 搜到的词在页面上高亮并可 Enter 逐个跳转。
- 选中一段文字，浮条出现，"复制"得到正确文本。
- 键盘 ← → 翻页；Ctrl + = / − / 0 缩放；拖分隔线改 Dock 宽度并在重启后保持。
- 窗口宽 800 时上下分栏，宽 1200 时左右三栏。

### M2 笔记编辑器（引用 6.5.7、5.3、附录 C 的编辑器条目）

做：vendor atomic-editor 与 mathPlugin 进 `packages/editor`；`MarkdownEditor` 三种模式；6.5.7 的 10 条 live preview 行为；时间戳与页面链接语法；工具栏；笔记持久化（1500 ms 防抖）；NotesPanel 头部；浮条"加入笔记"生效。

验收：
- 在第 7 页写含 `$E=mc^2$`、表格、代码块、任务列表的笔记，实时模式下光标离开即渲染、进入即显示源码；切源码 / 阅读模式一致；重启 app 笔记仍在第 7 页。
- 点击任务列表复选框源码里 `[ ]` 变 `[x]`。
- `[[p3]]` 显示为"第 3 页"chip，点击翻到第 3 页。
- Ctrl+E 循环模式；Ctrl+B / I 加粗 / 斜体；中文输入法组合输入不被 live preview 打断（验证）。
- 两个库共存冲突时记录结论：若冲突改用 codemirror-live-markdown 为基底。

### M3 页面标注与导出（引用 6.5.3、6.5.5、6.5.8、5.6、4.1）

做：AnnotationLayer 全部：text_box（Markdown 编辑 / 渲染、移动、缩放、颜色、字号）、highlight（选区 → quads、颜色、备注）、ink（笔画、简化、颜色、粗细）、eraser；撤销 / 重做；AnnotationsPanel；导出带标注的 PDF（annotpdf）；打印（导出后系统打开）；SelectionToolbar 高亮 / 备注项。

验收：
- 在一页上加 1 个含公式的文本框、2 个不同颜色高亮（其中 1 个带备注）、3 笔墨迹；缩放到 200%、旋转 90° 后位置全部正确；重启后仍在。
- 导出的 PDF 用 Edge 和 Adobe Reader 打开，高亮 / 墨迹位置正确，文本框显示 Markdown 源码。
- 擦除工具划过墨迹即删；Ctrl+Z 恢复。
- 标注面板"全部"列表点击任一条跳到对应页并闪烁。
- 触控屏（若有）上手指滚动、笔绘制（验证，无设备则标注未验证）。

### M4 Dock 面板系统与翻译（引用 6.5.6、6.5.10、11.8、11.9、6.4.5 AI 服务组）

做：面板注册表、默认布局、`+` 菜单、布局持久化与重置、Ctrl+1…7；TranslatePanel；设置里的 AI 服务组与"测试连接"；SelectionToolbar 的"翻译" / "解释"。

验收：
- 关闭"目录"再从 `+` 打开；把"翻译"拖到"笔记"下方形成上下分组；重启后布局保持；"重置布局"回到默认。
- 选中 PDF 一句英文点"翻译"，面板打开并显示中文译文，术语带括号原文；"加入笔记"在当前页笔记末尾追加引用块。
- 未配置 AI 服务时面板显示"去设置"。

### M5 录音与事件（引用 5、6.5.13–6.5.18、7.1–7.4、7.7）

做：Rust 采集、重采样、WavWriter、SampleClock、电平；Tauri 命令与事件；RecordingController；live TransportBar、MarkerBar、准备态横幅、结束流程；`page_change`、`note_snapshot`、`annotation_snapshot`、`marker`、`recording_state` 事件；TimelineScrubber live 绘制；崩溃恢复；防睡眠。`Timeline` 单元测试（含 `annotationsAt`）。

验收：
- Windows 上录 60 分钟（窗口最小化 30 分钟），得到可播放 WAV，时长误差 < 1 s；`events` 表里有对应的翻页、笔记快照、标注快照记录。
- 录音中快速连翻 5 页只产生 1 条 `page_change`。
- 暂停 30 s 再继续，SampleClock 不前进，事件 `t_ms` 连续。
- 录音中强杀进程，重开出现恢复对话框，选"保存并结束"后 session 变为 replay 且时长正确。
- `Timeline.intervals` 测试：空事件、首尾同页、连续同页合并、live 延长；`annotationsAt` 测试：创建 → 修改 → 删除三个时刻的状态。

### M6 重放（引用 5.2、6.5.4 跟随、6.5.5 replay、6.5.7 当时的笔记、6.5.15、6.5.17、7.8）

做：PlaybackController；replay TransportBar；TimelineScrubber 交互；跟随翻页；"当时的笔记"快照 + diff 高亮；"当时的标注"；标记导航；倍速；时间戳 chip seek。

验收：
- 播放到 12:03 时页面自动到第 7 页；手动翻页后跟随关闭，点 chip 恢复。
- 在快照时刻前后拖动播放头，笔记面板内容与高亮随之变化，页面上的标注随之出现 / 消失；无快照时显示"这时还没有写笔记"。
- 拖动 scrubber 过程中播放头视觉不卡顿；松手后音频从对应位置播放。
- 点笔记里的 `[12:40]` chip，播放头与页面同时跳转。

### M7 端侧转写（引用 6.4.5 转写组、6.5.11、7.5、7.6、7.10）

做：官方 `sherpa-onnx` crate 接入（Windows 上 dll 随包）；ModelManager 与模型页；live 实时段落与 partial；replay 转写同步高亮、自动滚动、回到当前、搜索、页分隔；SearchPanel 转写范围。

验收：
- 下载中英模型（进度可见、校验通过）；录一段 10 分钟英文讲课，段落 `t0/t1` 与实际语音误差 ≤ 1 s。
- 录音期间 UI 不掉帧（DevTools Performance 帧时间 < 16 ms 常态）。
- 模型缺失时录音正常进行，AsrChip 显示"下载模型"。
- crate 无法编译或运行时改走 7.10 并记录结论。

### M8 Windows 安装包（引用 14）

做：`tauri build` 产出 NSIS exe 与 MSI；WebView2 引导；dll 资源；图标；版本号；崩溃日志写本地文件（`plugin-log`）；可选自动更新（`plugin-updater`）。

验收：
- 在一台干净的 Windows 11 机器上安装、导入 PDF、写笔记、做标注、录音 5 分钟、重放、导出 PDF，全流程无报错。
- 安装包体积记录在文档里。

### M9 后端、认证、同步、文件（引用 2.3、4.5、8、9、10.1、6.4.1、6.4.5 同步组）

做：FastAPI 项目与 docker-compose；邮箱验证码登录；push / pull（含 annotations）；课件上传与处理（PDF 提文本；PPTX 转换 + 备注）；录音分片上传与续传；客户端登录页、本地模式 → 登录后首次同步、同步状态、设置里的同步组。

验收：
- 设备 A 录一节课，设备 B 登录后能看到会话、笔记、标注、事件，重放时页面与标注跟随正确，音频从服务端流播。
- 导入 pptx，在 B 上打开是 PDF 且 `speaker_notes` 已填。
- 上传中断网后恢复，从已完成分片继续，不重传。
- A、B 同时改同一页笔记，最后保存的一方胜出，双方最终一致。
- 本地模式用了一周的数据在登录后全部推送到服务端。

### M10 服务端处理（引用 10.2、10.3）

做：转码；faster-whisper 二次转写；翻译；`page_index` 回填；客户端转写面板"服务器转写"与"显示翻译"。

验收：
- 上传后 90 分钟录音在 ≤ 15 分钟内（有 GPU）得到服务端转写；客户端拉取后转写面板自动切到"服务器转写"。
- 英文段落有中文翻译，术语保留英文。

### M11 AI 总结与导出（引用 6.5.12、11）

做：context builder（含 Python 版 timeline 与标注描述）、两个提示词、summarize 任务、SummaryPanel 全部状态、编辑与重新生成、引用 chip、导出 Markdown、导出 SessionBundle。

验收：
- 一节 42 页的课，总结任务进度从 0 到 1 可见，完成后每讲过的页有标题与 ≤ 3 句总结；没讲的页标"没有展开讲"；学生高亮过的术语出现在该页 terms 里。
- 点任意引用 chip，音频与页面跳到该时刻，且该时刻转写确实在讲相关内容。
- 编辑某页总结后重新生成，先出现覆盖确认。
- 导出的 Markdown 和 `.markpdf.json` 用任意阅读器 / `jq` 打开结构完整。

### M12 macOS（引用 2.4、14）

做：`tauri build` 在 macOS 上产出 .app / .dmg；entitlements；⌘ 快捷键；hardened runtime 与公证（可选）。

验收：M8 的全流程在 macOS 上通过；录音权限弹窗文案正确。

### M13 iPadOS（引用 7.9、6.2 compact、6.6 手势）

做：`tauri ios init`；Swift 录音插件（AVAudioEngine → PCM → Rust 队列）；后台音频模式；sherpa-onnx iOS 链接；触控手势（笔绘制、手指滚动、双指缩放）；medium / compact 布局打磨；文件导入走系统"文件"。

验收：iPad 锁屏录 60 分钟得到完整 WAV；分屏（medium）下能完成"导入、标注、录音、重放"；Apple Pencil 绘制不触发滚动。

---

## 13. 测试

- 单元（vitest）：`Timeline`（5.2 全部方法，含 `annotationsAt`）；`note_diff`（新增行识别）；`coords`（页面空间 ↔ 视口，旋转 0 / 90 / 180 / 270）；`fmtClock`；`export_pdf` 的坐标换算；`SyncEngine` 的 LWW 合并与 rejected 处理（用内存 SQLite）。
- Rust（cargo test）：`WavWriter` 头部回写；`SampleClock`；重采样后样本数。
- 组件（testing-library）：TransportBar 三种录音状态；NotesPanel 模式切换；TranscriptPanel 当前行高亮与"回到当前"；AnnotationsPanel 筛选；SlideToolbar 工具单选。
- e2e（playwright，可选）：导入 PDF → 写笔记 → 加高亮 → 重启 → 数据仍在。
- 服务端：`timeline.py` 与 TS 版共用 `test/fixtures/timeline_cases.json`，两边都必须通过；context_builder 的分页、标注描述与 skipped 判定；push / pull 的幂等（重复推同一批事件不产生重复行）。

---

## 14. 打包与平台配置

- Windows：`tauri build` → `bundle/nsis/*.exe`（默认分发）与 `bundle/msi/*.msi`；`tauri.conf.json` 里 `bundle.windows.webviewInstallMode = downloadBootstrapper`；`bundle.resources` 包含 sherpa-onnx 与 onnxruntime 的 dll 和 `models.json`；应用图标 `icons/`；代码签名可选（无签名时 SmartScreen 会警告，文档里写明）。
- macOS：entitlements（2.4）；`hardenedRuntime`；`tauri build --bundles app,dmg`。
- iPadOS：Xcode 工程由 `tauri ios init` 生成；Info.plist 权限文案；`UIBackgroundModes audio`。
- 字体：`public/fonts/SourceSans3-VariableFont_wght.ttf`、`SourceCodePro-Regular.ttf`，在 `tokens.css` 里 `@font-face` 声明。
- pdf.js worker 与 cmaps 从 `pdfjs-dist` 拷到 `public/pdfjs/`，`GlobalWorkerOptions.workerSrc` 指向它；不从 CDN 加载。

---

## 附录 A：前端 store 与 hook 清单（zustand）

| store / hook | 类型 | 说明 |
|---|---|---|
| `useDb()` | Database | plugin-sql 单例 |
| `useAuth` | `{ token, user, localMode }` | |
| `useLayoutClass()` | LayoutClass | 由 AdaptiveShell 写入 |
| `useCourses()` / `useCourse(id)` | 查询 hook | 写入后通过 store 事件失效重查 |
| `useDecks(courseId)` / `useSessions(courseId)` / `useRecentSessions()` | 查询 hook | |
| `usePdfDocument(deckId)` | `PDFDocumentProxy` | 引用计数，最后一个使用者卸载时 `destroy()` |
| `useThumbnail(deckId, page)` | ImageBitmap / URL | LRU 200 |
| `useNote(deckId, page)` | Note | |
| `useAnnotations(deckId, page)` | Annotation[] | |
| `useSession(sessionId)` / `useSessionEvents(sessionId)` | | |
| `useTimeline(sessionId)` | Timeline | 由 events + session 派生，memo |
| `useTranscript(sessionId)` | TranscriptSegment[] | 优先 server |
| `useRecording` | RecordingState（7.7） | 全局单例 |
| `usePlayback(sessionId)` | PlaybackState（7.8） | |
| `usePlayhead(sessionId)` | number | 30 Hz |
| `useCurrentPage(sessionId)` | number | live 取用户页；replay 跟随时取 pageAt(playhead) |
| `useFollowPages(sessionId)` | boolean | |
| `useTool` | `{ tool, highlightColor, inkColor, inkWidth, textColor, fontSize }` | SlideToolbar 状态 |
| `useAnnotationSelection` | `{ selectedId, undo, redo }` | 6.5.5 通用 |
| `useDockLayout(mode)` | dockview JSON | 持久化 |
| `useEditorMode` | `live` / `source` / `reading` | 持久化 |
| `useNoteViewMode(sessionId)` | `atTime` / `current` | 笔记与标注共用 |
| `useSummary(sessionId)` / `useSummaryJob(sessionId)` | | 轮询 |
| `useAsrModels()` | AsrModel[] | |
| `useSettings` | Settings | 语言、外观、开关、AI 服务、标注默认 |
| `useSyncStatus()` | `synced` / `pending(n)` / `offline` / `local` | |

## 附录 B：关键 JSON 示例

`annotations` 一行（highlight）：

```json
{ "id": "018f…", "deck_id": "018f…", "page_index": 7, "kind": "highlight",
  "x": 72.0, "y": 210.5, "w": 380.2, "h": 28.0, "color": "#F5C542",
  "markdown": "和二次探测的区别？", "selected_text": "linear probing",
  "quads_json": "[[72,210.5,452.2,210.5,72,224.5,452.2,224.5]]", "strokes_json": null,
  "stroke_width": null, "font_size": null, "z": 3,
  "created_at": "2026-09-07T06:12:32Z", "updated_at": "2026-09-07T06:12:40Z", "deleted_at": null }
```

`annotation_snapshot` 事件：

```json
{ "id": "018f…", "session_id": "018f…", "type": "annotation_snapshot", "t_ms": 752000,
  "payload": { "annotation_id": "018f…", "page_index": 7, "kind": "highlight", "op": "created",
               "annotation": { …上面的行去掉 dirty… } },
  "device_id": "…", "created_at": "2026-09-07T06:12:32Z" }
```

`transcript_segments` 一行、`page_summaries.content_json`、`GET /jobs/{id}`：同 v1。

## 附录 C：参考实现与来源（实现前先读）

| 用途 | 项目 | 用法 |
|---|---|---|
| PDF 渲染、文本层、搜索、目录 | https://github.com/mozilla/pdf.js ；示例 https://mozilla.github.io/pdf.js/examples/ | 直接依赖 `pdfjs-dist` |
| pdf.js `PDFViewer` 组件与 AnnotationEditor 的 API 说明 | https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/ | 读它理解 EventBus / PDFViewer 用法；我们不用其 editor |
| 高亮坐标归一化、选区 → 矩形、导出示例 | https://github.com/QuocVietHa08/react-pdf-highlighter-plus （MIT）；原版 https://github.com/agentcooper/react-pdf-highlighter | 参考其 `scaledPosition` 换算和 `exportPdf`，不整包引入 |
| 把标注写回 PDF | https://github.com/highkite/pdfAnnotate （npm `annotpdf`，MIT） | 直接依赖 |
| Obsidian 式 live preview 基底 | https://github.com/kenforthewin/atomic-editor （npm `@atomic-editor/editor`，MIT） | vendor 进 `packages/editor` |
| 公式 / 表格 / 代码块 live preview 插件 | https://github.com/blueberrycongee/codemirror-live-markdown （MIT） | 取 `mathPlugin`；冲突时改为基底 |
| 其他 Obsidian 式编辑器参考 | https://github.com/Type-32/codemirror-rich-obsidian ；https://github.com/jecaro094/md-editor ；CM6 + Tauri 的完整 app https://github.com/zhulidr/notebook_editor_md | 只看实现思路 |
| Dock 面板 | https://github.com/mathuo/dockview （文档 https://dockview.dev） | 直接依赖 `dockview-react` |
| Tauri 2 | https://v2.tauri.app ；SQL 插件 https://docs.rs/crate/tauri-plugin-sql/latest | |
| Tauri 录音插件（结构参考） | https://github.com/brenogonzaga/tauri-plugin-audio-recorder ；https://github.com/ayangweb/tauri-plugin-mic-recorder | cpal 用法与移动端插件骨架；不直接用（无 PCM 流） |
| 端侧 ASR | https://github.com/k2-fsa/sherpa-onnx ；Rust crate https://crates.io/crates/sherpa-onnx ；流式模型列表 https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html ；WASM 构建 https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/wasm/build.rst | 官方 crate；WASM 为备选 |
| Edge PDF 功能清单 | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-pdf | 6.5.3 对照表的依据 |
| PDF 标注 UX 参考 | https://github.com/zotero/reader （fork 了 pdf.js，构建复杂；只参考交互，不复制代码） ；https://github.com/RyotaUshio/obsidian-pdf-plus （Markdown 原生的 PDF 标注思路） | |
| Tauri + PDF 的小示例 | https://github.com/taberkkaya/PdfViewer | 看 `convertFileSrc` 加载本地 PDF 的做法 |

## 附录 D：通用约束

- TypeScript `strict`；ESLint + Prettier；文件按第 3 节路径放置；不要把业务逻辑写进组件，放 controller / domain。
- 所有与时间轴相关的计算只允许在 `domain/timeline.ts` 里做，UI 不得自行推算。
- 所有页面空间与视口的换算只允许在 `pdf/coords.ts` 里做。
- 所有用户可见文案集中在 `core/strings.ts`，与 6.6 保持一致。
- 前端与 Rust 的边界只在 `platform/*.ts`；Rust 不持有业务状态（除录音管线）。
- vendor 进来的第三方代码保留原许可证文件与来源 URL。
- 每个里程碑提交时附：改动文件列表、运行方式、未完成的验收项、"验证"项的结论。

---

## 15. v2.1 增补（2026-09-14 实现过程中确定，优先级高于前文冲突处）

### 15.1 页面文本框对齐 Edge（修订 6.5.5 text_box）

- 外观：背景**全透明**，渲染态无边框；悬停显示 1 px 虚线（accent 60%）；选中 / 编辑态 2 px accent 实线边框；不再是"独立的标注框"。
- 字号：默认为"自动"（`text_box_font_size = 0`）：创建时按当前缩放取 `clamp(round(18 / scale), 12, 48)` pt，保证屏幕上约 18 px；可选 12 / 16 / 20 / 24 / 32 pt。
- 尺寸：默认 260 × 40 pt，最小 60 × 24 pt；高度随内容自动增长（编辑态用 CodeMirror 的文档自然高度，去掉编辑器的 40vh 末尾留白）。
- 文本工具下点击已有文本框直接进入编辑（不会新建）；新建只在点击空白处发生。
- 渲染态用 markdown-it，`breaks: true`（单个换行即换行）。

### 15.2 思维导图（新增面板 `mindmap`，参考 MarginNote 4）

**数据表 `mindmap_nodes`**（可变实体，LWW；迁移 `0002_mindmap.sql`）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| deck_id | TEXT | 每份课件一棵树 |
| parent_id | TEXT? | 根节点为 null |
| kind | TEXT | `root` / `excerpt` / `text` |
| markdown | TEXT | 卡片上的笔记（root 为标题） |
| annotation_id | TEXT? | excerpt：关联的高亮或文本框 |
| page_index | INT? | excerpt：所在页 |
| order_index | INT | 同级顺序 |
| color | TEXT? | 摘录取标注颜色 |
| collapsed | BOOL | |
| created_at, updated_at, deleted_at, dirty | | |

**布局**（`domain/mindmap_layout.ts`，有单元测试）：根在左、子树向右展开，子节点纵向堆叠、以父节点为中心；水平间距 56、垂直间距 14；节点尺寸由 DOM 测量。连线为父右缘 → 子左缘的三次贝塞尔。

**面板**（`panels/MindmapPanel.tsx`）：
- 头部：添加子节点（Tab）、添加同级（Enter）、删除（Delete）、适应窗口、缩放 −/+、最大化面板。
- 画布：拖空白平移；滚轮平移、Shift+滚轮横向、Ctrl+滚轮以光标为中心缩放（30%–200%）；网点底纹。
- 卡片：摘录卡显示 `P{页码}` 徽标 + 摘录原文（高亮文字或文本框内容，最多 4 行）+ 下方 Markdown 笔记；文本卡只显示 Markdown。root 卡 accent 底。双击 / F2 进入编辑（compact live preview 编辑器），Esc 或失焦保存。有子节点时右侧 −/+ 折叠钮，空格键也可折叠。
- 点击卡片：跳到该页并闪烁关联标注。
- 拖拽卡片到另一张卡片上 → 成为其子节点（不能拖进自己的子树）。
- 进入方式："摘录"（选区浮条第 7 项：先创建高亮再生成摘录卡，挂在当前选中卡或根下）、标注面板右键"加入导图"。同一标注只生成一张卡。
- 空状态："还没有导图" + 说明 + "新建第一个节点"。
- 导出 Markdown 时以缩进列表输出"## 导图"。

**时间轴**：v2.1 不为导图记录事件；后续可加 `mindmap_snapshot`。

### 15.3 其他实现约定

- 标注层挂在我们自己的 `.mp-ann-host` 元素里，pdf.js 每次重绘页面都会清空 `.page` 的子元素，因此在 `pagesinit / pagerendered / pagechanging / scalechanging / rotationchanging / updateviewarea` 事件后重新 append。
- Dock 布局恢复时，若默认布局里有保存时尚不存在的面板（如新增的导图），自动加到第一组一次（`dock_layout_<mode>_known` 记录已知面板）。
- 墨迹：仅 `pointerType === 'pen'` 时使用 `getCoalescedEvents()`；鼠标只用主事件（合成事件会带入陈旧样本）。
- 选区浮条在 DOM 选区被清除（`selectionchange`）时自动消失。
- 导出 PDF 的注解文本用 UTF-16BE（BOM `FE FF`）写入，annotpdf 按单字节输出字符串。
- 开发调试：`window.__markpdf`（仅 dev）暴露导入、查询、各 store；WebView2 用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 可通过 CDP 自动化测试。

### 15.4 M7 端侧转写实现说明（2026-09-14）

- 依赖：`sherpa-onnx = "1.13"`（默认 static 特性）。`sherpa-onnx-sys` 的 build script 从 GitHub 下载 `…-win-x64-static-MT-Release-lib.tar.bz2`；本机下载失败，改为手动下载并用 `SHERPA_ONNX_LIB_DIR`（`src-tauri/.cargo/config.toml`）指向解压后的 `lib/`。静态库 1.2 GB（onnxruntime.lib 944 MB），只影响链接时间。
- `asr/engine.rs`：`Decoder`（recognizer + stream + 分段簿记）与线程 / 事件无关，live 与离线 bench 共用。时间戳不用 SampleClock 实时值，而是 `offset_ms + 已喂入样本数 / 16`（offset 为挂接时的 SampleClock），解码慢于实时也不会漂移；t0 / t1 规则仍按 7.5（−300 ms / −1000 ms，`t1 ≥ t0 + 200`）。停止时 drain 队列 → `input_finished` → 冲出最后一段。
- 命令：`asr_start(model_dir)`（要求录音已在进行，挂到 `Recorder::set_asr_sink`）、`asr_stop`（先摘掉 sink 再 join）、`asr_bench(model_dir, wav_path)`（开发 / 测试：离线跑 16 kHz WAV，返回分段与耗时）。`audio_stop` 会兜底停掉仍挂着的引擎。事件 `asr://status {loading|ready|error|stopped}`、`asr://partial {text}`、`asr://final {t0_ms,t1_ms,text}`。
- 前端：`platform/asr.ts`；`recording.ts` 在 `audio_start` 成功后异步 `startAsr`（设置关闭 → off；无就绪模型 → no_model；加载中 → loading；失败 → error + toast，录音不受影响）；final 写 `transcript_segments`（source=device，`lang` 由脚本粗判 zh / en / mixed，`page_index` 取当前页）；`stop()` 先 `asr_stop` 再 `audio_stop`，事件监听延迟 800 ms 拆除以接住冲出的最后一段。AsrChip 在 no_model 时可点击跳到 设置 → 转写模型。
- 模型清单改为逐文件从 Hugging Face（或 hf-mirror）下载到 `asr_models/<id>/`，统一命名 encoder / decoder / joiner .onnx + tokens.txt；`models_check` 以四个文件都存在为 ready。
- `model_type` 留空让 sherpa-onnx 从 ONNX 元数据推断：双语 2023-02-20 是 zipformer，英文 2023-06-26 是 zipformer2；写错类型会让 sherpa-onnx 直接 `exit(-1)` 杀掉整个进程（已踩坑）。
- 链接警告 LNK4098（预编译库为 /MT，Rust 默认 /MD）目前只是警告；sherpa 返回的字符串由它自己的 API 释放，不跨 CRT 释放内存。若日后出问题改用 `-C target-feature=+crt-static`。
- 时间戳实测（英文 zipformer2 int8，TTS WAV 真实语音区间 700–3250 / 5850–9400 / 12100–13950 ms）：用 300 / 1000 ms 常数时得到 1200–4000 / 6300–10400 / 12400–15680，t0 平均晚 ~500 ms、t1 晚 ~800 ms；改为 600 / 1600 ms 后误差在 ±200 ms 内。
- 测试用“虚拟麦克风”：debug 构建提供 `audio_inject_wav(path)`（`Recorder::inject_wav`），把 WAV 按实时节奏灌进采集管线并暂时屏蔽真实麦克风，`window.__markpdf.injectWav(path)` 调用；release 构建返回 `dev_only`。测试语音用 Windows SAPI（Zira）生成 16 kHz WAV。

### 15.5 已验证项（2026-09-14）

M0 骨架、M1 阅读器（导入 / 单页连续 / 缩放旋转 / 目录 / 搜索 / 选区浮条）、M2 编辑器（实时预览、公式、时间戳、页面链接、三种模式、自动保存）、M3 标注（高亮备注、墨迹、文本框、擦除、撤销、导出 PDF 含中文备注）、M4 面板与翻译（mock LLM 联调通过，`http://*:*` 作用域）、M5 录音（cpal 采集、WAV 头回写、SampleClock、事件、暂停时钟停止、崩溃恢复代码）、M6 重放（跟随翻页、当时的笔记 diff 高亮、当时的标注、标记导航、倍速）、导图面板、M7 端侧转写（英文 zipformer2 int8 模型：离线 bench 与虚拟麦克风 live 全链路——partial 实时显示、endpoint 分段、`transcript_segments` 落库、面板按页分组、结束后重放仍在；设置页下载模型走应用内 reqwest，进度条正常；转写文本句子大小写）、M8 安装包（NSIS + MSI）。未做：M9+ 后端、转写标点模型、导图时间轴事件、会话打包导出。

## 16. v2.2 增补（2026-09-16，优先级高于前文冲突处）

### 16.1 录音的删除与重新转写

- 删除：课件页顶部的"此 PDF 的录音"栏在选中某段录音时直接显示"重命名""删除"图标按钮（原"更多"菜单中的两项保留），删除走 `domain/deletion.ts` 的 `deleteSessionWithFiles`（行墓碑 + 事件 / 转写 / 总结硬删 + WAV / M4A 文件）。录音进行中按钮禁用。
- 重新转写：replay 形态下转写面板头部的 `refresh` 按钮、空状态里的"用本机模型转写这段录音"、"更多"菜单的"重新转写"三处入口，先弹确认框（已有转写时说明会替换设备转写及其纠错 / 翻译）。
- Rust 命令 `asr_transcribe_file(job_id, model_dir, wav_path)`：用 `WavPcmReader` 按 1600 采样一块流式读 WAV（不整段载入内存），喂给与实时转写相同的 `Decoder`（端点、时间戳规则一致），每 1 s 音频发 `asr://transcribe {job_id, done_ms, total_ms}`；`asr_transcribe_cancel(job_id)` 在块间取消，返回 `cancelled`。只接受 16 kHz PCM16。
- 前端 `controllers/retranscribe.ts`（zustand）：录音进行中拒绝；模型取 `session.lang_mode`（无则设置里的语言）对应的就绪模型（16.2 的选择与回退规则），无模型抛 `NoModelError`（面板提示并跳到设置 → 转写模型）；完成后 `replaceDeviceSegments` 删除该会话 `source='device'` 的旧行、按 40 行一批插入新行，`page_index` 用 `Timeline.pageAt(t0)` 按当时翻页事件归页，`asr_status` 置 `device`。失败或取消不动旧转写。

### 16.2 转写模型分档

- `core/asrModels.ts` 按下载大小分四档：轻量 ≤200 MiB（建议 4 GB 内存）、标准 ≤500 MiB（8 GB）、高精度 ≤1000 MiB（8 GB）、旗舰 ≤2000 MiB（16 GB）。每个模型标注发布日期、精度、语言、`实测占用`或`预估占用`（进程工作集，含 onnxruntime；实测来自 `src-tauri/tests/asr_memory.rs`：en int8 141 MiB、中英 int8 262 MiB、zh int8 2025 250 MiB；估算 ≈ int8 1.15× / fp16 2.1× / fp32 1.1× 权重 + 70 MiB）。
- 模型清单（均为 sherpa-onnx 流式模型，可同时用于实时与离线重转写）：中英双语 2023-02-20 int8 / fp32；中文 small-ctc 2025-04-01 int8（zipformer2 CTC，单文件 `model.onnx`）、中文大模型 2025-06-30 int8 / fp16、中文 XL 2025-06-30 int8 / fp16；英文 2023-06-26 int8、英文 2023-06-21（LibriSpeech+GigaSpeech）int8 / fp32。文件逐个从 Hugging Face 下载并按 LFS 元数据的大小 / SHA-256 校验。
- 选择：设置 `asr_model_zh` / `asr_model_en`（空 = 内置默认：中英 int8、英文 int8），语言"自动"沿用中文档位。`readyDirFor(lang, selected)` 依次尝试用户选择 → 内置默认 → 该语言其他已就绪模型。设置页每个已就绪模型下有"中文 / English 用这个模型"单选。
- Rust `engine.rs`：`model_layout(dir)` 识别 transducer（encoder / decoder / joiner + tokens）或 zipformer2 CTC（`model.onnx` + tokens），`Decoder::new` 按布局构造 `OnlineModelConfig`。

### 16.3 ChatGPT 账号（Codex）接入

- 设置 → 翻译与 AI 新增"接入方式"：自定义 API（原有）/ ChatGPT 账号（Codex）。后者通过本机 Codex CLI 的 `codex app-server`（JSON-RPC over stdio）使用用户的 ChatGPT 订阅额度：MarkPDF 不接触 OAuth 令牌，登录 / 刷新 / 额度全部由 Codex 管理（`~/.codex/auth.json`）。
- Rust `codex/mod.rs`：查找二进制（设置里的路径 → `~/.codex/bin` → PATH（含 npm 全局 `codex.cmd` 旁的 `node_modules`）→ `%APPDATA%/npm`），`codex --version` 探测。npm 按 CLI 的模块解析顺序先查 `@openai/codex/node_modules/@openai/codex-<os>-<arch>`，再查平级平台包和旧版 `@openai/codex` 内置 vendor；每个包兼容 `vendor/<triple>/bin` 与 `vendor/<triple>/codex`。懒启动一个 app-server 进程（Windows 下 `CREATE_NO_WINDOW`），reader 线程按行分发响应 / 通知，服务端请求（审批等）一律回错误避免挂起；窗口销毁时杀进程。命令：`codex_locate`、`codex_status`（`account/read`）、`codex_login_start`（`account/login/start {type: chatgpt}` 返回 authUrl，完成由 `account/login/completed` 通知转成 `codex://login` 事件）、`codex_login_cancel`、`codex_logout`、`codex_models`（`model/list` 全量分页）、`codex_rate_limits`、`codex_chat`、`codex_shutdown`。
- `codex_chat`：每次请求新建 `thread/start {ephemeral, sandbox: read-only, approvalPolicy: never, baseInstructions = system 提示, config.features.memories = false, cwd = <appData>/codex-cwd}`，再 `turn/start {input: text, effort, disabledPluginIds: []}`，收集 `item/agentMessage/delta` 与 `turn/completed` 里的 agentMessage 文本；`turn.status = failed/interrupted` 或 `error` 通知即报错；超时 240 s。
- 前端：`platform/codex.ts` 封装；设置 `llm_provider`（`custom` / `codex`）、`codex_model`、`codex_effort`、`codex_path`；`data/api/llm.ts` 的 `chat()` 在 provider 为 codex 时改走 `codex_chat`（system → baseInstructions，多轮对话拼成一条用户消息），`isLlmConfigured()` 对 codex 恒真。设置面板 `CodexSettings.tsx`：二进制检测 / 路径覆盖、账号状态与登录 / 退出、模型下拉（`displayName`，默认项标注）、推理强度下拉（来自该模型的 `supportedReasoningEfforts`，附说明）、本周额度、测试连接、条款与额度消耗提示（每次请求约 2 万 token 的 Codex 工具上下文）。
- 已验证（2026-09-16，Codex CLI 0.154.0）：initialize → account/read（ChatGPT Pro 账号）→ model/list（gpt-6-astra 默认、gpt-5.6-sol / terra / luna、gpt-5.5，各自的 effort 档位）→ thread/start + turn/start 一轮 "OK" 回复全链路正常；Rust 侧同一链路由可选测试 `MARKPDF_CODEX_BIN=<codex.exe> cargo test --lib codex::tests::live_roundtrip -- --ignored --nocapture` 覆盖（会消耗一次极小的订阅额度）。设置页、模型分档页、重新转写与删除录音的入口已用 Playwright（Edge + 模拟 Tauri）冒烟；真实 Tauri 窗口内的登录按钮（打开浏览器授权页）未在本轮实机点过。
- 自动发现回归验证（2026-09-17，Windows，Codex CLI 0.155.0）：复用正在运行的 MarkPDF 的 PATH，旧查找逻辑返回 `codex_not_found`，修复后无需手填路径即可发现 npm 嵌套平台包；原生 `live_roundtrip` 通过账号读取、模型列表和一轮 "OK" 回复。回归测试覆盖嵌套 / 平级 / 旧内置布局及优先级；设置页仅 `codex_not_found` 显示安装指引，启动与版本错误保留详情。此验证未重新执行浏览器 OAuth 授权。

### 16.4 编辑与交互修正

- 文本框拖动 / 缩放改用 pointer capture + `touch-action: none` + `pointercancel` 收尾：触控或触笔拖动时浏览器不再把手势当作页面平移（此前会触发 `pointercancel`，框只在视觉上移动、数据库不写入，松手后回到原位）；移动中保持自动增高后的高度。左栏 / 右侧 Dock 分隔条同样改为 pointer 事件。
- 实时预览公式：光标只要离开 `$…$` / `$$…$$` 本身的字符范围就渲染（含边界，输入闭合 `$` 后再输入任意字符即渲染），不再以整行为单位（Obsidian 行为）。
- KaTeX 在 `.md-view` 与编辑器里统一为 1.05em、行高 1，块级公式外边距 0.3em，含公式的行与普通行间距一致。
