#!/bin/bash
# Writes SHA256SUMS-macos.txt next to the disk image(s). The name differs from the
# Windows SHA256SUMS.txt because both files are attached to the same GitHub Release.
set -euo pipefail
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p 'require(process.argv[1]).version' "$app_dir/src-tauri/tauri.conf.json")"
bundle_dir="${1:-${CARGO_TARGET_DIR:-$app_dir/src-tauri/target-release}/release/bundle/dmg}"
cd "$bundle_dir"
shopt -s nullglob
disk_images=(MarkPDF_"$version"_*.dmg)
[ "${#disk_images[@]}" -gt 0 ] || { echo "Disk image for MarkPDF $version not found in $bundle_dir" >&2; exit 1; }
shasum -a 256 "${disk_images[@]}" | tee SHA256SUMS-macos.txt
