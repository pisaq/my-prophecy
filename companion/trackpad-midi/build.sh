#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-../../bin/trackpad-midi}"
mkdir -p "$(dirname "$OUT")"

swiftc \
  -O \
  -parse-as-library \
  -import-objc-header MultitouchSupport.h \
  -F/System/Library/PrivateFrameworks \
  -framework MultitouchSupport \
  -framework CoreMIDI \
  -framework CoreFoundation \
  -framework Foundation \
  main.swift \
  -o "$OUT"

echo "Built $OUT"
