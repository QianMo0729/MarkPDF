#!/bin/bash
# macOS counterpart of verify-asr-link.ps1: the shipped executable must not carry
# eSpeak / Piper code. Release builds are stripped, so besides the symbol table
# the embedded strings are searched as well (both slices of a universal binary).
set -euo pipefail
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
executable="${1:-${CARGO_TARGET_DIR:-$app_dir/src-tauri/target-release}/release/markpdf}"
[ -f "$executable" ] || { echo "Built executable not found: $executable" >&2; exit 1; }
# Check each producer separately: a pipeline with grep -q can turn a detected
# match into success when grep exits early and a producer receives SIGPIPE.
audit_output="$(mktemp "${TMPDIR:-/tmp}/markpdf-asr-audit.XXXXXX")"
trap 'rm -f "$audit_output"' EXIT
if ! nm -a "$executable" >"$audit_output"; then
    echo 'Native link audit failed: cannot inspect the symbol table.' >&2
    exit 1
fi
# A stripped binary may have no symbols; its embedded strings still need checking.
if ! strings -a -arch all "$executable" >>"$audit_output"; then
    echo 'Native link audit failed: cannot inspect embedded strings.' >&2
    exit 1
fi
match_status=0
grep -E -i 'espeak|piper|phonemiz' "$audit_output" >/dev/null || match_status=$?
if [ "$match_status" -eq 0 ]; then
    echo 'The executable retains TTS code. Do not release it; use the verified ASR-only native SDK.' >&2
    exit 1
fi
[ "$match_status" -eq 1 ] || { echo 'Native link audit failed: cannot search the audit output.' >&2; exit 1; }
echo 'Native link audit passed: no eSpeak / Piper / phonemizer code.'
