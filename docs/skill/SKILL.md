---
name: tsuki
description: >
  Working guide for the tsuki project — an Arduino firmware framework where users write in Go or Python and the toolchain transpiles to C++. Use this skill whenever working in the tsuki repository, touching any of its components (transpiler, CLI, flash backends, web IDE, tsukilib packages), debugging transpilation issues, adding new language constructs, working on the design system, or answering questions about the project architecture. Also trigger for tasks like adding a new board, creating a tsukilib package, fixing codegen bugs, modifying the Go CLI commands, implementing checker passes, or working on the board platforms system. If the user mentions tsuki, tsuki-core, tsuki-flash, tsukilib, godotinolib.toml, tsukiboard.toml, or the tsuki IDE, always use this skill.
---

# tsuki — LLM Working Guide

> Write in Go (or Python), Upload in C++.
> This document tells you everything you need to know to work effectively in this repository as an AI assistant.

---

## What this project is

**tsuki** is an Arduino firmware framework. Users write firmware in **Go** (or Python), and the toolchain transpiles it to **C++**, which is then compiled and flashed to an Arduino-compatible board.

Tagline: _"Write in Go, Upload in C++"_

There are **three binaries** built from this repo:

| Binary | Language | Role |
|--------|----------|------|
| `tsuki` | Go (CLI) | User-facing command runner |
| `tsuki-core` | Rust | Go/Python → C++ transpiler |
| `tsuki-flash` | Rust | Compile `.cpp` → firmware + flash to board |

---

## Repository layout

```
/
├── src/                    ← tsuki-core Rust library & binary
│   ├── lib.rs              ← Public API: Pipeline, PipelineOptions, PythonPipeline
│   ├── main.rs             ← tsuki-core standalone binary entry point
│   ├── error.rs            ← TsukiError, Span, Result
│   ├── lexer/              ← Go lexer
│   ├── parser/             ← Go parser → AST
│   ├── transpiler/         ← AST → C++ codegen
│   ├── checker/            ← Semantic analysis (see references/checker-v2.md)
│   ├── runtime/            ← Package registry & built-in mappings
│   │   ├── mod.rs
│   │   ├── pkg_loader.rs   ← Loads godotinolib.toml
│   │   └── pkg_manager.rs
│   ├── python/             ← Python → C++ sub-pipeline
│   └── simulator/          ← Circuit simulator
│
├── flash/                  ← tsuki-flash Rust binary
│   ├── main.rs             ← CLI entry (clap): compile / upload / platforms subcommands
│   ├── boards.rs           ← Board definitions (FQBN, memory, toolchain) + dynamic lookup
│   ├── compile/            ← Per-architecture compile backends (avr, esp, rp2040)
│   ├── flash/              ← Flash backends (avrdude, esptool)
│   ├── cores/              ← Arduino core sources
│   ├── platforms/          ← Downloadable board platform manager (see references/board-platforms.md)
│   ├── sdk.rs              ← SDK/toolchain download & management
│   ├── lib_manager.rs      ← Arduino library resolver
│   ├── detect.rs           ← USB board auto-detection
│   └── serial_monitor.rs
│
├── cli/                    ← tsuki Go CLI
│   └── internal/
│       ├── cli/            ← Cobra commands: init, build, upload, check, config, pkg, boards
│       ├── manifest/       ← tsuki_package.json load/save
│       ├── config/         ← ~/.config/tsuki/config.json
│       ├── core/           ← Shell-out to tsuki-core binary
│       ├── flash/          ← Shell-out to tsuki-flash or arduino-cli
│       ├── check/          ← Source validation + rich tracebacks
│       └── ui/             ← Terminal UI (spinners, config panels, tracebacks)
│
├── ide/                    ← Web IDE (Next.js + TypeScript + Tailwind)
│   └── src/components/
│       ├── docs/           ← Documentation viewer
│       ├── screens/        ← IdeScreen, SettingsScreen
│       └── other/          ← PlatformsSidebar, BoardInstallModal, etc.
│
├── boards/                 ← Board platform registry (downloadable)
│   ├── boards.json         ← Registry index
│   └── <id>/v<ver>/        ← tsukiboard.toml, sandbox.json, ports.json, README.md
│
├── pkg/                    ← tsukilib package registry (git submodule → tsuki-pkg)
│   ├── packages.json
│   ├── boards.json
│   ├── libs/
│   │   └── <n>/v<semver>/
│   │       ├── godotinolib.toml
│   │       └── examples/
│   └── boards/
│       └── <id>/v<semver>/
│           └── tsuki_board.toml
│       ├── godotinolib.toml
│       └── examples/
│
├── docs/superpowers/       ← Agentic implementation specs & plans
│   ├── specs/              ← Technical design specs (checker-v2, etc.)
│   └── plans/              ← Step-by-step implementation plans
│
├── tools/
│   ├── build.py
│   └── package.py
└── Cargo.toml              ← Rust workspace root (tsuki-core + tsuki-flash)
```

---

## The transpilation pipeline

```
User's .go (or .py) file
        |
        v
  tsuki-core (Rust)
    |- Lexer      -> tokens
    |- Parser     -> AST
    |- Checker    -> diagnostics (multi-pass, see references/checker-v2.md)
    `- Transpiler + Runtime -> C++ source
        |
        v
  tsuki-flash  OR  arduino-cli
    `- compile -> .hex / .bin / .uf2
        |
        v
  Board (via avrdude / esptool / picotool)
```

**The CLI never re-implements transpilation.** This boundary is strict.

---

## Runtime / Package mapping system

`src/runtime/mod.rs` maps Go package calls to C++ expressions via template strings:
- `{0}`, `{1}`, `{2}` — positional call arguments
- `{self}` — receiver/instance variable
- `{args}` — all arguments joined with `, `

**Built-in packages** (always available):

| Go import | Maps to C++ |
|-----------|-------------|
| `"arduino"` | `Arduino.h` builtins (`PinMode`, `DigitalWrite`, etc.) |
| `"fmt"` | `Serial.print` / `Serial.println` |
| `"time"` | `delay()` / `millis()` |
| `"math"` | `<math.h>` |
| `"wire"` / `"Wire"` | `Wire.h` (I2C) |
| `"spi"` / `"SPI"` | `SPI.h` |
| `"serial"` / `"Serial"` | `Serial` object |
| `"Servo"` | `Servo.h` |
| `"LiquidCrystal"` | `LiquidCrystal.h` |
| `"strconv"` | `String::to...` methods |

---

## Project manifest: `tsuki_package.json`

```json
{
  "name": "my-project",
  "version": "0.1.0",
  "board": "uno",
  "language": "go",
  "packages": [
    { "name": "dht",    "version": "^1.0.0" },
    { "name": "ws2812", "version": "^1.0.0" }
  ],
  "build": {}
}
```

Supported `language` values: `"go"` (default), `"python"`, `"cpp"`, `"ino"`.

---

## Supported Go subset

- **Supported:** variables (`var`, `:=`), constants, functions, methods, structs, type aliases, `if/else`, `for` (all styles), `switch`, all operators, string literals, `import`, package calls
- **Stubs (emits a comment):** goroutines (`go`), `defer`
- **Partial:** interfaces, closures, multiple return values (struct-packed), `map` (void* stub)
- **Not supported:** channels, generics, garbage collection

---

## How to work on each component

### Transpiler (Rust — `src/`)

- **Add a new built-in mapping:** `src/runtime/mod.rs`, register in `Runtime::new()`.
- **Fix a parse bug:** `src/parser/mod.rs`. Update AST (`src/parser/ast.rs`) first, then parser, then transpiler.
- **Fix a codegen bug:** `src/transpiler/mod.rs`, in `emit_*` family of methods.
- **Add Python support:** `src/python/` mirrors the Go pipeline.
- **Errors:** All `TsukiError` variants from `src/error.rs`. Always carry a `Span` with `file`, `line`, and `col`.
- **Checker work:** Read `references/checker-v2.md` before touching `src/checker/`.

```bash
cargo build
cargo test
cargo build --release
```

### CLI (Go — `cli/`)

- **Add a flag:** edit `cli/internal/cli/<cmd>.go`.
- **Change manifest format:** `cli/internal/manifest/manifest.go`.
- **Change config keys:** `cli/internal/config/config.go`.
- **Terminal output:** helpers in `cli/internal/ui/ui.go`.

```bash
cd cli && go build ./cmd/tsuki/...
```

### Flash / compile backends (`flash/`)

- **Add a board architecture:** new file in `flash/compile/`, register in `flash/compile/mod.rs`.
- **Add a board:** entry in `flash/boards.rs`.
- **Add a flash tool:** module under `flash/flash/`.
- **Board platforms (downloadable):** read `references/board-platforms.md`.

```bash
cargo build --bin tsuki-flash
```

### Adding a tsukilib package (`pkg/` — submodule `tsuki-pkg`)

`/pkg` is a **git submodule** pointing to `github.com/tsuki-team/tsuki-pkg`. All
library and board packages live in that separate repo; the monorepo just references
it. In development you work directly inside the submodule directory.

**Library packages** (`tsuki-pkg/libs/<n>/`):

1. Create `pkg/libs/<n>/README.md`
2. Create `pkg/libs/<n>/v1.0.0/godotinolib.toml` (see template in examples/new-package.toml)
3. Add at least one example under `pkg/libs/<n>/v1.0.0/examples/basic/main.go`
4. Register in `pkg/packages.json` (and `tsuki-pkg/packages.json`) with URLs pointing to
   `https://raw.githubusercontent.com/tsuki-team/tsuki-pkg/main/libs/<n>/...`

**Board packages** (`tsuki-pkg/boards/<id>/`):

1. Create `pkg/boards/<id>/README.md`
2. Create `pkg/boards/<id>/v1.0.0/tsuki_board.toml`
3. Register in `pkg/boards.json` (and `tsuki-pkg/boards.json`)

**Remote install (binary distribution — no submodule):**

When `tsuki pkg install <n>` runs without the submodule present, the CLI fetches
`godotinolib.toml` from `PkgRegistryURL` (default: GitHub raw `tsuki-team/tsuki-pkg/main`)
and caches it in `~/.cache/tsuki/pkg/<n>/<version>/`. tsuki-core then loads from cache
transparently via `load_all_with_cache()` in `src/runtime/pkg_loader.rs`.

```bash
# Verify registry entry
tsuki pkg search <n>
# Install from registry (fetches remote if no submodule)
tsuki pkg install <n>
```

### Web IDE (`ide/`)

- `experiments/Lsp/` — LSP engine & IDE features (autocomplete, diagnostics, hover)
- `experiments/SandboxPanel/` — Circuit simulator UI
- `components/other/` — Sidebar panels (PlatformsSidebar, BoardInstallModal, etc.)

```bash
cd ide && npm install && npm run dev
```

---

## Supported boards reference

| ID | Board | Architecture | Flash | RAM |
|----|-------|-------------|-------|-----|
| `uno` | Arduino Uno | AVR ATmega328P | 32K | 2K |
| `nano` | Arduino Nano | AVR ATmega328P | 32K | 2K |
| `mega` | Arduino Mega 2560 | AVR ATmega2560 | 256K | 8K |
| `leonardo` | Arduino Leonardo | AVR ATmega32U4 | 32K | 2K |
| `due` | Arduino Due | ARM AT91SAM3X8E | 512K | 96K |
| `esp32` | ESP32 Dev Module | Xtensa LX6 | 4096K | 520K |
| `esp8266` | ESP8266 NodeMCU | ESP8266EX | 4096K | 80K |
| `pico` | Raspberry Pi Pico | RP2040 | 2048K | 264K |
| `teensy40` | Teensy 4.0 | iMXRT1062 | 1984K | 1024K |

> **Downloadable platforms** (esp32, esp8266, etc.) can also be installed via `tsuki-flash platforms install <id>`. See `references/board-platforms.md`.

---

## Common tasks quick-reference

| Task | File(s) |
|------|---------|
| Add a new Go built-in function | `src/runtime/mod.rs` |
| Add a new Go language construct | `src/parser/ast.rs` → `src/parser/mod.rs` → `src/transpiler/mod.rs` |
| Add a new Python built-in | `src/python/transpiler.rs` |
| Add a new CLI command | `cli/internal/cli/<cmd>.go` + register in `cli/internal/cli/root.go` |
| Add/change a manifest field | `cli/internal/manifest/manifest.go` |
| Add a new board (static) | `flash/boards.rs` + `flash/compile/<arch>.rs` |
| Add a new board platform (downloadable) | `boards/<id>/v<ver>/` — see `references/board-platforms.md` |
| Add a new tsukilib package | `pkg/libs/<n>/` (submodule: `tsuki-pkg`) |
| Fix/improve a checker pass | `src/checker/` — read `references/checker-v2.md` first |
| Fix/improve an error message | `src/error.rs` + call site |
| Change release build steps | `tools/build.py` |
| Update IDE docs content | `ide/src/components/docs/pages/<Page>.tsx` |
| Add sidebar panel to IDE | `ide/src/components/other/` + wire in `IdeScreen.tsx` + add to store.ts |

---

## Key invariants — never break these

1. **The CLI never transpiles.** All source transformation lives in `tsuki-core`.
2. **`src/` and `flash/` are separate Rust binaries.** Do not merge them.
3. **`godotinolib.toml` is the single source of truth for a package's API surface.**
4. **The transpiler must be deterministic.** Same input → identical C++ output every time.
5. **Error spans must always carry file + line + col.** The rich traceback renderer requires all three.
6. **Packages in `pkg/libs/` must include at least one Go example.** The IDE uses them for live previews.
7. **Never hardcode hex colors in the IDE.** Always `var(--token)` — see the design system section below.

---

## Minimal working example

`tsuki_package.json`:
```json
{ "name": "my-project", "version": "0.1.0", "board": "uno", "packages": [] }
```

`src/main.go`:
```go
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
```

`tsuki build` calls `tsuki-core src/main.go build/main.cpp --board uno`, producing:

```cpp
// Generated by tsuki v6.0.0 — do not edit manually.
#include <Arduino.h>

void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
    digitalWrite(LED_BUILTIN, HIGH); delay(500);
    digitalWrite(LED_BUILTIN, LOW);  delay(500);
}
```

---

## Visual design system (summary)

> Full design system reference in `references/design-system.md`.

**Fonts:** `IBM Plex Sans` (sans), `IBM Plex Mono` (mono). Always antialiased.

**Color tokens (dark mode default):**

| Token | Value | Use |
|-------|-------|-----|
| `--surface` | `#0a0a0a` | body background |
| `--surface-1` | `#111111` | sidebar, primary panels |
| `--surface-2` | `#171717` | cards, modals |
| `--surface-3` | `#1f1f1f` | inputs, dropdowns |
| `--fg` | `#ededed` | primary text |
| `--fg-muted` | `#8c8c8c` | secondary text |
| `--accent` | `#ededed` | white in dark, black in light |
| `--border` | `#242424` | primary border |

**Rules that must never be broken:**
- No visible shadows — use `border: 1px solid var(--border)` only
- No large radii: max 8–12px on cards, 4–6px on controls
- No hardcoded colors — always `var(--token)` or `color-mix(...)`
- No animations > 300 ms on functional UI

---

## Reference files

Read these when working on the relevant area:

- `references/checker-v2.md` — Full spec for the multi-pass semantic checker (Passes 0–4, CFG, data-flow, incremental cache, new error codes T0012–T0403)
- `references/board-platforms.md` — Full implementation plan for downloadable board platforms (`tsukiboard.toml`, `platforms/mod.rs`, IDE `PlatformsSidebar`, pre-compiled core reuse)
- `references/design-system.md` — Complete design token reference, typographic classes, layout primitives, animation rules
- `references/error-codes.md` — Full table of all TsukiError T-codes, severities, and descriptions

## Agent guides

Read these before spawning or acting as a specialized subagent:

- `agents/transpiler-agent.md` — How to work on lexer/parser/transpiler/checker tasks
- `agents/flash-agent.md` — How to work on tsuki-flash compile backends, SDK, board platforms
- `agents/ide-agent.md` — How to work on the Next.js IDE (components, store, Tauri bridge)
- `agents/pkg-agent.md` — How to create or update tsukilib packages

## Scripts

- `scripts/new-package.sh <name>` — Scaffold a new tsukilib package directory
- `scripts/new-board.sh <id> <arch>` — Scaffold a new board platform directory
- `scripts/check-invariants.py` — Validate repository invariants (spans, examples, determinism markers)