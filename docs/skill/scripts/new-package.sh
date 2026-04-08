#!/usr/bin/env bash
# scripts/new-package.sh
# Scaffold a new tsukilib package directory.
#
# Usage:
#   bash scripts/new-package.sh <package-name>
#
# Example:
#   bash scripts/new-package.sh bme280
#
# Creates:
#   pkg/bme280/
#   pkg/bme280/README.md
#   pkg/bme280/v1.0.0/godotinolib.toml
#   pkg/bme280/v1.0.0/examples/basic/main.go
#   pkg/bme280/v1.0.0/examples/basic/tsuki_example.json

set -euo pipefail

PKG="${1:-}"
if [[ -z "$PKG" ]]; then
  echo "Usage: $0 <package-name>"
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
DEST="$ROOT/pkg/$PKG"

if [[ -d "$DEST" ]]; then
  echo "Error: $DEST already exists."
  exit 1
fi

mkdir -p "$DEST/v1.0.0/examples/basic"

# README.md
cat > "$DEST/README.md" << EOF
# $PKG

> TODO: one-line description

## Installation

\`\`\`
tsuki pkg install $PKG
\`\`\`

## Usage

\`\`\`go
package main

import "$PKG"

// TODO: example
\`\`\`

## API

| Go function | Description |
|-------------|-------------|
| \`TODO\`   | TODO |
EOF

# godotinolib.toml
cat > "$DEST/v1.0.0/godotinolib.toml" << EOF
[package]
name        = "$PKG"
version     = "1.0.0"
description = "TODO: description"
author      = "tsuki-team"
cpp_header  = "TODO.h"
arduino_lib = "TODO"
cpp_class   = "TODO"

aliases = ["TODO"]

[[function]]
go     = "New"
python = "new"
cpp    = "TODO({0})"

[[function]]
go     = "Read"
python = "read"
cpp    = "{self}.read()"

[[constant]]
go     = "MODE_DEFAULT"
python = "MODE_DEFAULT"
cpp    = "TODO_MODE_DEFAULT"

[[example]]
dir = "examples/basic"
EOF

# Basic example
cat > "$DEST/v1.0.0/examples/basic/main.go" << EOF
package main

import (
	"arduino"
	"fmt"
	"$PKG"
)

var sensor ${PKG}.TODO

func setup() {
	arduino.SerialBegin(9600)
	sensor = ${PKG}.New(2)
}

func loop() {
	val := sensor.Read()
	fmt.Println(val)
}
EOF

cat > "$DEST/v1.0.0/examples/basic/tsuki_example.json" << EOF
{
  "name": "Basic Usage",
  "description": "Shows basic $PKG usage",
  "board": "uno",
  "packages": ["$PKG"]
}
EOF

echo "✔ Created pkg/$PKG/"
echo ""
echo "Next steps:"
echo "  1. Edit pkg/$PKG/v1.0.0/godotinolib.toml"
echo "  2. Edit pkg/$PKG/v1.0.0/examples/basic/main.go"
echo "  3. Update pkg/packages.json"
echo "  4. See agents/pkg-agent.md for full checklist"