# Windows 原生链接审计（0.1.1）

2026-09-15，本机 Windows x64 / MSVC Release 实际链接验证：MarkPDF 改用官方 **sherpa-onnx 1.13.8 无 TTS 静态库**后，最终 EXE 的链接映射与导出表都没有 eSpeak / Piper / phonemizer 符号。应用继续使用原有 ASR API。

## 为什么需要更换原生库

旧的完整 SDK 虽然由 ASR 代码引入，但实际 EXE 保留了以下函数，不能仅根据应用没有调用 TTS 就认定它们被优化掉：

| 完整 SDK 的实际链接符号 | 来源对象 | 链接地址 |
| --- | --- | --- |
| `espeak_Initialize` | `espeak_api.obj` | `0x140ef21f0` |
| `espeak_ng_Initialize` | `speech.obj` | `0x141502b00` |
| `piper::phonemize_eSpeak` | `phonemize.obj` | `0x140ef7460` |

`dumpbin /exports` 同样列出了 eSpeak / Piper 导出。Microsoft 的 [MAP 文档](https://learn.microsoft.com/en-us/cpp/build/reference/map-generate-mapfile?view=msvc-170)说明映射记录最终符号地址及来源对象；[OPT 文档](https://learn.microsoft.com/en-us/cpp/build/reference/opt-optimizations?view=msvc-170)说明未引用 COMDAT 的消除条件，不能替代实际产物检查。

## 更换后的检查

使用[官方无 TTS 静态库归档](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2)，归档大小 120,099,517 字节，SHA-256：

```text
f0aa074ddc39553b30208b53e84c12275d09702911c9faa8d34fa932428e4641
```

两次独立校验与 vendored crate 的构建校验均通过。实际归档没有 `piper_phonemize.lib`、`espeak-ng.lib`、`ucd.lib`，新构建输出也没有这些链接指令。

新 Release 的 `/MAP` 文件中，`espeak`、Piper 的 C++ 命名空间 `@piper@@`、`phonemiz`、`espeak_api.obj`、`speech.obj` 的匹配数均为 **0**；`dumpbin /exports` 检查通过。这里只统计对应原生符号，普通 Windows 命名管道 `NamedPipe` 不属于 Piper。

另以[原生 ASR 测试](../app/src-tauri/tests/asr_native_smoke.rs)加载现有英文及中英双语两套模型，复用生产 `Decoder`，输入合成静音及 5.12 秒英文朗读；两者都完成解码、间隔处理、结束收尾和时间线断言，4 个关键词均命中。双语模型把英文 `two` 识别为 `to`；本次验证证明引擎能加载和运行，不代表中文质量或实时麦克风链路已经重新测评。没有读取用户录音或启动安装的应用。

诊断构建的 SHA-256（用于核对本次证据，不作为最终安装包校验值）：

| 产物 | SHA-256 |
| --- | --- |
| 完整 SDK 诊断 EXE | `a6f9ee1ab0051ffd1816ac22420927941b7cf38403f45d7b152f3ac27ede194e` |
| 完整 SDK MAP | `bef4f2665890c3602de9a95babbb8dcc6118b5a887d0bcc86d726a43ce3663f0` |
| 无 TTS SDK 诊断 EXE | `a356f40c7cdbce7e39cc23fcfc4437642da43c8077b8c097264a12a407bf960b` |
| 无 TTS SDK MAP | `5f1da1eae5c896a6aaf83b8afdbc5125d7b43a1c721165ce0e2bbc5e0370a4b7` |

原始 MAP 含本机构建路径，保留在被 Git 忽略的审计目录；本页只记录可公开的符号、方法与摘要。最终安装包以 Release 附件的 `SHA256SUMS.txt` 为准。此审计限定于上述 Windows x64 原生产物，其他依赖的许可证见[第三方许可说明](THIRD_PARTY_NOTICES.md)。

## 防止回归

- [受控 crate 补丁](../app/src-tauri/vendor/sherpa-onnx-sys/MARKPDF-PATCH.md)固定无 TTS 下载地址、摘要与 Windows 链接列表；显式指向完整 SDK 的覆盖会失败。
- `build-windows.ps1` 和 tag Release 工作流均在发布前执行 `verify-asr-link.ps1`。旧的完整 SDK EXE 已被该检查实际拒绝，新的无 TTS EXE 已通过。
- 更换原生库版本时，重新生成 Release MAP，复核符号及 ASR 实际加载，不能只更新摘要。
