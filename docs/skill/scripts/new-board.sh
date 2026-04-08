#!/usr/bin/env bash
# scripts/new-board.sh
# Scaffold a new downloadable board platform directory.
#
# Usage:
#   bash scripts/new-board.sh <board-id> <arch>
#
# Arch options: avr | esp32 | esp8266 | rp2040 | sam
#
# Example:
#   bash scripts/new-board.sh esp32s3 esp32
#
# Creates:
#   boards/esp32s3/v1.0.0/tsukiboard.toml
#   boards/esp32s3/v1.0.0/sandbox.json
#   boards/esp32s3/v1.0.0/ports.json
#   boards/esp32s3/v1.0.0/README.md

set -euo pipefail

BOARD="${1:-}"
ARCH="${2:-}"

if [[ -z "$BOARD" || -z "$ARCH" ]]; then
  echo "Usage: $0 <board-id> <arch>"
  echo "  arch: avr | esp32 | esp8266 | rp2040 | sam"
  exit 1
fi

VALID_ARCHS="avr esp32 esp8266 rp2040 sam"
if ! echo "$VALID_ARCHS" | grep -qw "$ARCH"; then
  echo "Error: arch must be one of: $VALID_ARCHS"
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
DEST="$ROOT/boards/$BOARD/v1.0.0"

if [[ -d "$DEST" ]]; then
  echo "Error: $DEST already exists."
  exit 1
fi

mkdir -p "$DEST"

# tsukiboard.toml
cat > "$DEST/tsukiboard.toml" << EOF
[board]
id          = "$BOARD"
name        = "TODO: Board Name"
version     = "1.0.0"
description = "TODO: description"
author      = "tsuki-team"
fqbn        = "TODO:${ARCH}:${BOARD}"
variant     = "${BOARD}"
flash_kb    = 0
ram_kb      = 0
f_cpu       = 0

[files]
sandbox = "sandbox.json"
ports   = "ports.json"
readme  = "README.md"

[toolchain]
type        = "${ARCH}"
variant     = "${BOARD}"
upload_tool = "$(if [[ "$ARCH" == "avr" ]]; then echo "avrdude"; else echo "esptool"; fi)"
upload_baud = 921600

[detection]
name_patterns = ["TODO"]

[[detection.usb]]
vid  = "TODO"
pid  = "TODO"
chip = "TODO"

[[define]]
name = "ARDUINO_$(echo "$BOARD" | tr '[:lower:]' '[:upper:]')"

[[define]]
name = "$(echo "$ARCH" | tr '[:lower:]' '[:upper:]')"
EOF

# sandbox.json
cat > "$DEST/sandbox.json" << EOF
{
  "type": "${BOARD}",
  "label": "$(echo "$BOARD" | tr '[:lower:]' '[:upper:]')",
  "w": 56,
  "h": 116,
  "color": "#1a1a2e",
  "borderColor": "#2d2d6e",
  "category": "mcu",
  "description": "TODO: board description",
  "pins": [
    { "id": "GND", "label": "GND", "type": "gnd",   "rx": 0,  "ry": 6 },
    { "id": "5V",  "label": "5V",  "type": "power", "rx": 0,  "ry": 12 }
  ]
}
EOF

# ports.json
cat > "$DEST/ports.json" << EOF
{
  "usb": [
    { "vid": "TODO", "pid": "TODO", "name": "TODO chip" }
  ],
  "name_patterns": ["TODO"]
}
EOF

# README.md
cat > "$DEST/README.md" << EOF
# $(echo "$BOARD" | tr '[:lower:]' '[:upper:]')

TODO: brief description.

## Specifications

| Property | Value |
|----------|-------|
| CPU | TODO |
| Flash | TODO KB |
| RAM | TODO KB |
| Architecture | ${ARCH} |

## Example: Blink

\`\`\`go
package main

import "arduino"

func setup() {
    arduino.PinMode(arduino.LED_BUILTIN, arduino.OUTPUT)
}

func loop() {
    arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.HIGH)
    arduino.Delay(500)
    arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.LOW)
    arduino.Delay(500)
}
\`\`\`

## SDK Installation

\`tsuki-flash platforms install $BOARD\`
EOF

echo "✔ Created boards/$BOARD/v1.0.0/"
echo ""
echo "Next steps:"
echo "  1. Fill in boards/$BOARD/v1.0.0/tsukiboard.toml (flash_kb, ram_kb, f_cpu, USB VID/PID)"
echo "  2. Update boards/$BOARD/v1.0.0/sandbox.json (pins)"
echo "  3. Update boards/$BOARD/v1.0.0/ports.json (VID/PID)"
echo "  4. Update boards/boards.json to register the new board"
echo "  5. See references/board-platforms.md for full spec"