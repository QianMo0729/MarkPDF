# MarkPDF ASR-only native link patch (Windows, macOS)

Upstream: `sherpa-onnx-sys` **1.13.8**, distributed on crates.io under Apache-2.0.
The original Rust FFI bindings and license are retained. `Cargo.toml.orig` records
the original manifest; the application selects this copy with `[patch.crates-io]`.

For **Windows x64** and **macOS (arm64, x64) static** builds only, `build.rs`:

1. Downloads the official `no-tts-lib` archive of the target (table below).
2. Verifies its published SHA-256 before extracting a newly downloaded archive.
3. Omits `piper_phonemize`, `espeak-ng` and `ucd` from native link directives.
4. Rejects a library-directory override containing those full-SDK libraries.

The additional `sha2` build dependency checks the archive. Public FFI types and
the ASR API are unchanged. MarkPDF does not call TTS APIs. Other upstream target
selection remains unchanged and is not covered by MarkPDF's release QA.

| Target | Archive | SHA-256 | Size |
| --- | --- | --- | --- |
| Windows x64 | `sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2` | `f0aa074ddc39553b30208b53e84c12275d09702911c9faa8d34fa932428e4641` | 120,099,517 bytes |
| macOS arm64 | `sherpa-onnx-v1.13.8-osx-arm64-static-no-tts-lib.tar.bz2` | `3d7f9b8a496694af13d9802c33b8133231e397bdef302f543d19468765e83136` | 19,756,929 bytes |
| macOS x64 | `sherpa-onnx-v1.13.8-osx-x64-static-no-tts-lib.tar.bz2` | `8ffc3ede9f997fec547b5c99b8e2073b8e04fd48a5f65e1a6d5d314ad0106ad9` | 19,433,402 bytes |

The digests are the ones GitHub publishes for the
[v1.13.8 release assets](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8).

- [Official Windows download matrix](https://k2-fsa.github.io/sherpa/onnx/install/windows/generated/download/windows_x64.html)
- [Official Windows release archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2)
- [Official macOS arm64 release archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-arm64-static-no-tts-lib.tar.bz2)

Do not restore the full SDK for releases: a real MSVC release link map showed
eSpeak/Piper exported functions retained in that executable despite ASR-only
application usage, and macOS releases follow the same rule (`verify-asr-link.sh`
checks the shipped executable). A new SDK version requires fresh digests and a
native link audit.
