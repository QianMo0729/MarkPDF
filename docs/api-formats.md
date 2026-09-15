# 翻译服务与 AI 接口核验（2026-09-15）

## 确认的问题和修改

旧客户端把所有地址都拼接为 `/chat/completions`，并在翻译、解释和连接测试中固定发送 `temperature: 0.2`。这会让 Responses / Claude Messages 地址请求错误，也会被不接受采样参数的模型或代理拒绝。报错 404 也可能来自模型名称，不能只凭状态码认定是哪一种问题。

设置中的“发送格式”只提供“OpenAI 格式”和“Claude 格式”，与服务供应商无关。地址、API Key 和模型 ID 均由用户填写，切换发送格式不会覆盖这些字段。旧的 Chat Completions / Responses 配置仍然可读，界面统一显示 OpenAI 格式。翻译方式独立设置，默认本地；用户可以单次使用 AI，也可以把 AI 设为默认翻译方式。本地失败不会自动把课件文本发送到 AI 服务。解释仍使用用户配置的 AI。

所有协议和连接测试均不发送 `temperature` 或 `top_p`，也不提供自定义温度入口。供应商使用自己的默认采样设置。

## 两种发送格式及底层协议

| 发送格式 / 内部协议 | 常规端点 | 鉴权 | 输入与输出 |
| --- | --- | --- | --- |
| OpenAI 格式 / Chat Completions | `/v1/chat/completions` | `Authorization: Bearer …` | `messages`；读取 `choices[0].message.content` |
| OpenAI 格式 / Responses（Codex 兼容） | `/v1/responses` | `Authorization: Bearer …` | 系统提示放在 `instructions`，对话放在 `input`；读取 `output` 中 message 的 `output_text` 内容块 |
| Claude 格式 / Messages | `/v1/messages` | `x-api-key` 和 `anthropic-version: 2023-06-01` | 系统提示放在顶层 `system`，其他消息放在 `messages`；读取 `content` 中 text 块 |

OpenAI 格式优先识别已填写的完整 `/responses` 或 `/chat/completions` 端点；普通 API Base 默认先发 Chat Completions。只有明确的路由不存在（404）或方法不支持（405）才尝试另一个 OpenAI 协议一次；模型不存在、认证失败、额度/限流和服务错误不触发切换。用户无需额外选择第三种格式。

Chat Completions 采用当前的 `max_completion_tokens`；如果旧兼容网关明确以 400 / 422 拒绝此字段，仅重试一次旧字段 `max_tokens`。Responses 使用 `max_output_tokens`；Claude 使用必填的 `max_tokens`。解析器不会把思考内容、工具调用或达到长度限制的部分结果当成完整译文。失败、拒绝和无文本响应会显示错误。

地址允许服务根地址、带版本或代理前缀的 API 地址、完整端点。普通根地址添加 `/v1`；自定义代理前缀保留；完整端点不会再次追加相同路径，切换格式时会替换端点后缀。查询参数保留。

Codex 兼容使用 Responses 的 HTTP 请求格式和用户自行填写的 API 地址、密钥、模型；这里没有读取 Codex 桌面登录信息或复用其账户令牌。支持标准非流式 JSON Responses 接口；要求私有登录或仅支持特殊流式协议的服务需要提供兼容端点。

## 官方来源

- [OpenAI Chat Completions 请求参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)：消息列表、模型相关参数兼容性与输出 token 字段。
- [OpenAI Responses 请求参考](https://developers.openai.com/api/reference/resources/responses/methods/create)：`input` / `instructions`、`max_output_tokens` 和结构化 `output`。
- [Claude Messages 请求参考](https://platform.claude.com/docs/en/api/messages/create)：Messages 端点、版本请求头、API key、顶层 `system`、`max_tokens` 和文本内容块。

## 验证边界

`app/tests/llm.test.ts` 用模拟 HTTP 响应验证三种底层请求结构、鉴权、端点识别、无温度参数、受限协议回退和错误处理。`app/tests/translation_settings.test.ts` 验证旧配置可读，以及切换发送格式不覆盖地址、密钥和模型。`app/tests/translation_routing.test.ts` 验证本地调用失败时不调用 AI、明确选择 AI 后才调用和取消传播。未使用用户真实密钥发起付费请求；供应商线上可用性由设置页“测试连接”验证。

## 实时转写的逐句翻译

转写面板顶部提供“翻译”开关，默认关闭；选择会保存为 `transcript_translation_enabled`。打开时从当前最新的完整句开始，后续每完成一句串行翻译一句，不会自动补翻整段旧录音。未完成的 `partial` 句子只显示和跟随滚动，不进入翻译队列。目标语言和本地 / AI 方式沿用现有翻译设置。

本地模型仅接收当前句。AI 翻译把最多前 3 个完整句、最多 600 字符放在系统提示的上下文中；当前句单独作为用户消息，并明确要求只返回当前句的译文。上下文不会从未来句子取用，全部调用仍不带温度参数。

译文写入对应 `transcript_segments.translation`，显示在原句下。数据库更新同时约束录音 ID、句子 ID、原句文本和空译文条件，避免迟到结果覆盖另一录音、已修改原句或已有译文。翻译不会阻塞录音或实时转写；第一次失败暂停队列，只有用户点击“重试翻译”才继续请求。

队列由 PDF 页面的 `TranscriptTranslationProvider` 持有，位于 DockHost 外层。同一录音从实时模式切到回放模式，或重新创建 / 隐藏面板时，继续处理已经排队的句子。关闭翻译、换录音或离开 PDF 页面会取消任务；迟到结果不会进入旧任务的持久化流程。

相关验证包括 `transcript_translation.test.ts` 的顺序、去重、上下文、失败暂停与取消边界，`transcript_translation_repo.test.ts` 的更新保护，`transcript_translation_lifecycle.test.tsx` 的模式重建保留队列及换录音 / 关闭 / 卸载取消。原 `transcript_follow.test.tsx` 的 5 项自动跟随检查继续通过。

## 同音 / 近音词纠错

纠错是独立的 AI 开关，默认关闭；使用用户自行配置的服务地址、发送格式、API Key 和模型。完整句先参考前面最多 3 句、共 600 字符进行一次保守校对；下一句完成后，再参考这句后文的最多 300 字符复核前一句一次。每条新句最多两个阶段，修正文或译文的数据库刷新不会反复触发纠错。开启时只接收当前最新完整句及之后的新句，不补处理整段历史录音。

服务请求中的原句、前句和后句均放入 JSON 数据字段，系统提示明确不执行录音文本内的指令。模型只允许提出这样的替换：`{"edits":[{"from":"two","to":"too","occurrence":1}]}`；无明确错误时返回空 `edits`。本地校验字段、词语出现次数、完整英文单词边界、同语种短词范围、改动比例和不重叠的替换区间，不接受未经校验的整句改写，也不允许修改数字或句子标点。其他字符原样保留。这些检查限制修改范围；是否属于误识别仍由上下文和模型判断。

首次实际修改时，原 ASR 文本永久保留在 `original_text`。修正句子会清掉旧译文，翻译队列据新文本重译；旧文本对应的迟到译文、错误不会覆盖或阻止新版本。纠错提交同样通过录音 ID、句子 ID、原文本三重条件保护，并在后文复核开始前读取最新持久化文本，避免重复使用旧版本。

纠错和翻译分别串行排队、分别可关闭。纠错失败后暂停，等待显式重试；同一录音的实时 / 回放面板重建保留两阶段任务，换录音、关闭纠错或离开 PDF 页面会取消。对应测试为 `transcript_correction.test.ts` 和 `transcript_correction_lifecycle.test.tsx`，覆盖结构校验、上下文边界、两阶段上限、失败暂停、生命周期及纠错与译文并发。
