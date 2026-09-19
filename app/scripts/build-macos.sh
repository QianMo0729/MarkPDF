#!/bin/bash
# Builds the macOS .app and .dmg. The counterpart of build-windows.ps1:
#   --prepare-only   only resolve the build environment (CI exports it to later steps)
#   --skip-install   reuse the existing node_modules
#   --skip-tests     skip frontend / Rust tests already run on the same sources
#   --target <t>     aarch64-apple-darwin, x86_64-apple-darwin or universal-apple-darwin
#                    (default: the host architecture)
set -euo pipefail

prepare_only=0 skip_install=0 skip_tests=0 target=""
while [ $# -gt 0 ]; do
    case "$1" in
        --prepare-only) prepare_only=1 ;;
        --skip-install) skip_install=1 ;;
        --skip-tests) skip_tests=1 ;;
        --target) target="${2:?--target needs a value}"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

[ "$(uname -s)" = "Darwin" ] || { echo 'This script builds the macOS app bundle and disk image.' >&2; exit 1; }
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
rust_dir="$app_dir/src-tauri"

# rustup installs into ~/.cargo/bin, which a non-login shell may not have on PATH.
command -v cargo >/dev/null 2>&1 || PATH="$HOME/.cargo/bin:$PATH"
case "$(node --version 2>/dev/null)" in
    v24.*) ;;
    *) echo 'Install Node.js 24 LTS (CI uses 24.18.0).' >&2; exit 1 ;;
esac
# Respect an explicit toolchain or the developer's existing rustup default.
# CI sets the verified release toolchain explicitly before invoking this script.
host="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')" || true
case "$host" in
    aarch64-apple-darwin|x86_64-apple-darwin) ;;
    *) echo 'Install Rust with rustup, then run: rustup toolchain install 1.98.1 --profile minimal' >&2; exit 1 ;;
esac
xcode-select -p >/dev/null 2>&1 || { echo 'Install the Xcode Command Line Tools: xcode-select --install' >&2; exit 1; }

target="${target:-$host}"
case "$target" in
    aarch64-apple-darwin) archs="arm64" ;;
    x86_64-apple-darwin) archs="x64" ;;
    universal-apple-darwin) archs="arm64 x64" ;;
    *) echo "Unsupported --target: $target" >&2; exit 2 ;;
esac

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$rust_dir/target-release}"
case "$CARGO_TARGET_DIR" in /*) ;; *) CARGO_TARGET_DIR="$app_dir/$CARGO_TARGET_DIR" ;; esac

sherpa_version="$(awk '/^name = "sherpa-onnx-sys"$/ { getline; gsub(/^version = "|"$/, ""); print; exit }' "$rust_dir/Cargo.lock")"
[ -n "$sherpa_version" ] || { echo 'Cannot locate sherpa-onnx-sys in Cargo.lock.' >&2; exit 1; }
archive_stem() { echo "sherpa-onnx-v$sherpa_version-osx-$1-static-no-tts-lib"; }

if [ -n "${SHERPA_ONNX_LIB_DIR:-}" ]; then
    [ "$archs" != "arm64 x64" ] || { echo 'SHERPA_ONNX_LIB_DIR holds one architecture; use SHERPA_ONNX_ARCHIVE_DIR for universal builds.' >&2; exit 1; }
    [ -f "$SHERPA_ONNX_LIB_DIR/libsherpa-onnx-c-api.a" ] || { echo 'SHERPA_ONNX_LIB_DIR must contain the matching macOS static libraries.' >&2; exit 1; }
    for tts_library in libpiper_phonemize.a libespeak-ng.a libucd.a; do
        [ ! -e "$SHERPA_ONNX_LIB_DIR/$tts_library" ] || { echo 'SHERPA_ONNX_LIB_DIR points to the full SDK. Use the official matching no-tts-lib archive.' >&2; exit 1; }
    done
elif [ -n "${SHERPA_ONNX_ARCHIVE_DIR:-}" ]; then
    for arch in $archs; do
        [ -f "$SHERPA_ONNX_ARCHIVE_DIR/$(archive_stem "$arch").tar.bz2" ] || { echo "SHERPA_ONNX_ARCHIVE_DIR must contain $(archive_stem "$arch").tar.bz2" >&2; exit 1; }
    done
elif [ "$archs" != "arm64 x64" ]; then
    cached_lib="$HOME/Library/Caches/MarkPDF-build/$(archive_stem "$archs")/lib"
    [ ! -f "$cached_lib/libsherpa-onnx-c-api.a" ] || export SHERPA_ONNX_LIB_DIR="$cached_lib"
fi

# Export only build variables between GitHub Actions steps. No user credentials
# or application settings are inspected by this script.
if [ -n "${GITHUB_ENV:-}" ]; then
    for name in RUSTUP_TOOLCHAIN CARGO_TARGET_DIR SHERPA_ONNX_LIB_DIR SHERPA_ONNX_ARCHIVE_DIR; do
        [ -z "${!name:-}" ] || echo "$name=${!name}" >> "$GITHUB_ENV"
    done
fi
echo "Build target: $target -> $CARGO_TARGET_DIR"
if [ -n "${SHERPA_ONNX_LIB_DIR:-}" ]; then echo 'Using the existing sherpa-onnx static library directory.'
elif [ -n "${SHERPA_ONNX_ARCHIVE_DIR:-}" ]; then echo 'Using the supplied sherpa-onnx archive.'
else echo "sherpa-onnx-sys will download and verify official v$sherpa_version ASR-only libraries when needed."; fi
[ "$prepare_only" -eq 0 ] || exit 0

cd "$app_dir"
if [ "$target" != "$host" ]; then
    for triple in aarch64-apple-darwin x86_64-apple-darwin; do
        case "$target" in universal-apple-darwin|"$triple") rustup target add "$triple" ;; esac
    done
fi
[ "$skip_install" -eq 1 ] || npm ci
node scripts/check-release-version.mjs
node scripts/download-translation-assets.mjs
if [ "$skip_tests" -eq 0 ]; then
    npm test
    npm run build
    cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
fi
# The disk image step mounts a scratch volume (/Volumes/dmg.XXXXXX, shown in Finder as "MarkPDF") and
# has to detach it again. An app started from that volume keeps it busy, and the step then fails with
# nothing but "failed to run bundle_dmg.sh" and leaves the volume and its rw.*.dmg behind.
scratch_volume_check() {
    local busy device
    busy="$(pgrep -fl '^/Volumes/dmg\.[^/]*/MarkPDF\.app/' || true)"
    if [ -n "$busy" ]; then
        echo 'MarkPDF is running from the scratch volume of a disk image build. Quit it (Cmd-Q), then build again:' >&2
        echo "$busy" >&2
        return 1
    fi
    hdiutil info | awk -v ours="$CARGO_TARGET_DIR/$target/release/bundle/macos/rw." \
        '/^image-path/ { hit = index($0, ours) > 0 } hit && /^\/dev\/disk[0-9]+[[:space:]]/ && NF == 2 { print $1 }' |
        while read -r device; do hdiutil detach "$device" >/dev/null || true; done
    rm -f "$CARGO_TARGET_DIR/$target/release/bundle/macos"/rw.*.dmg
}
scratch_volume_check
npm run tauri -- build --ci --target "$target" --bundles app,dmg -- --locked || { scratch_volume_check || true; exit 1; }
"$app_dir/scripts/verify-asr-link.sh" "$CARGO_TARGET_DIR/$target/release/bundle/macos/MarkPDF.app/Contents/MacOS/markpdf"
"$app_dir/scripts/write-checksums.sh" "$CARGO_TARGET_DIR/$target/release/bundle/dmg"
echo "Disk image and SHA256SUMS-macos.txt: $CARGO_TARGET_DIR/$target/release/bundle/dmg"
