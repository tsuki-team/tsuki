---
name: tsuki
description: >
  Working guide for the tsuki project — an Arduino firmware framework where users write in Go or Python and the toolchain transpiles to C++. Use this skill whenever working in the tsuki repository, touching any of its components (transpiler, CLI, flash backends, web IDE, tsukilib packages), debugging transpilation issues, adding new language constructs, working on the design system, or answering questions about the project architecture. Also trigger for tasks like adding a new board, creating a tsukilib package, fixing codegen bugs, or modifying the Go CLI commands. If the user mentions tsuki, tsuki-core, tsuki-flash, tsukilib, godotinolib.toml, or the tsuki IDE, always use this skill.
---

# tsuki — LLM Working Guide

> Write in Go (or Python), Upload in C++.  
> This document tells you everything you need to know to work effectively in this repository as an AI assistant.

---

## What this project is

**tsuki** is an Arduino firmware framework. Users write firmware in **Go** (or Python), and the toolchain transpiles it to **C++**, which is then compiled and flashed to an Arduino-compatible board.

The tagline: _"Write in Go, Upload in C++"_.

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
│   ├── lexer/              ← Go lexer (mod.rs + token.rs)
│   ├── parser/             ← Go parser producing AST (mod.rs + ast.rs)
│   ├── transpiler/         ← AST → C++ codegen (mod.rs + config.rs)
│   ├── runtime/            ← Package registry & built-in mappings
│   │   ├── mod.rs          ← Runtime, Board, ParsedTemplate
│   │   ├── pkg_loader.rs   ← LibManifest: loads godotinolib.toml
│   │   └── pkg_manager.rs  ← Install/resolve tsukilib packages
│   ├── python/             ← Python → C++ sub-pipeline
│   │   ├── mod.rs
│   │   ├── lexer.rs
│   │   ├── parser.rs
│   │   ├── ast.rs
│   │   └── transpiler.rs
│   └── simulator/          ← Circuit simulator (mod.rs)
│
├── flash/                  ← tsuki-flash Rust binary
│   ├── main.rs             ← CLI entry (clap): compile / upload subcommands
│   ├── boards.rs           ← Board definitions (FQBN, memory, toolchain)
│   ├── compile/            ← Per-architecture compile backends
│   │   ├── mod.rs
│   │   ├── avr.rs          ← AVR (Uno, Nano, Mega...)
│   │   ├── esp.rs          ← ESP32 / ESP8266
│   │   └── rp2040.rs       ← Raspberry Pi Pico
│   ├── flash/              ← Flash backends (avrdude, esptool)
│   ├── cores/              ← Arduino core sources (AVR, etc.)
│   ├── sdk.rs              ← SDK/toolchain download & management
│   ├── lib_manager.rs      ← Arduino library resolver
│   ├── detect.rs           ← USB board auto-detection
│   └── serial_monitor.rs   ← Serial port monitor
│
├── cli/                    ← tsuki Go CLI
│   ├── go.mod
│   └── internal/
│       ├── cli/            ← Cobra commands: init, build, upload, check, config, pkg, boards
│       ├── manifest/       ← tsuki_package.json load/save
│       ├── config/         ← ~/.config/tsuki/config.json
│       ├── core/           ← Shell-out to tsuki-core binary
│       ├── flash/          ← Shell-out to tsuki-flash or arduino-cli
│       ├── check/          ← Source validation + rich tracebacks
│       ├── pkgmgr/         ← tsukilib package manager (install, remove, list)
│       └── ui/             ← Terminal UI (spinners, config panels, tracebacks)
│
├── ide/                    ← Web IDE (Next.js + TypeScript + Tailwind)
│   └── src/
│       ├── app/            ← Next.js app router
│       └── components/
│           ├── docs/       ← Documentation viewer components
│           └── experiments/
│               ├── Lsp/              ← LSP engine & features
│               ├── SandboxPanel/     ← Circuit sandbox / simulator UI
│               └── GitSidebar/       ← Git integration sidebar
│
├── pkg/                    ← tsukilib package registry (bundled packages)
│   ├── packages.json       ← Package index
│   ├── keys/index.json     ← Signing keys
│   └── <n>/
│       ├── README.md
│       └── v<semver>/
│           ├── godotinolib.toml   ← Package manifest (API mapping)
│           └── examples/
│               └── <example>/
│                   ├── main.go
│                   ├── circuit.tsuki-circuit
│                   └── tsuki_example.json
│
├── tools/
│   ├── build.py            ← Official release build script
│   └── package.py          ← Package bundler
│
├── Cargo.toml              ← Rust workspace root (tsuki-core + tsuki-flash)
└── README.md
```

---

## Core concepts you must understand

### 1. The transpilation pipeline

```
User's .go (or .py) file
        |
        v
  tsuki-core (Rust)
    |- Lexer      -> tokens
    |- Parser     -> AST
    `- Transpiler + Runtime -> C++ source
        |
        v
  tsuki-flash  OR  arduino-cli
    `- compile -> .hex / .bin / .uf2
        |
        v
  Board (via avrdude / esptool / picotool)
```

The Go CLI **never re-implements** transpilation — it always shells out to `tsuki-core`. This boundary is strict and intentional.

### 2. The Runtime / package mapping system

`src/runtime/mod.rs` is the heart of the API mapping system. It maps Go package calls to C++ expressions via **template strings**:

- `{0}`, `{1}`, `{2}` — positional call arguments
- `{self}` — the receiver/instance variable
- `{args}` — all arguments joined with `, `

Example: mapping `"{0}.readTemperature()"` applied to `sensor.ReadTemperature()` emits `sensor.readTemperature()`.

**Built-in packages** (always available, no install needed):

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

### 3. The project manifest: `tsuki_package.json`

Every tsuki project has a `tsuki_package.json` at its root. The Go struct is in `cli/internal/manifest/manifest.go`.

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

### 4. External packages (tsukilib)

Each package under `pkg/` is defined by a `godotinolib.toml`. This TOML file declares:
- The C++ header and Arduino library it wraps
- `[[function]]` entries: Go name + Python name + C++ template
- `[[constant]]` entries: Go/Python/C++ name triples
- `[[example]]` directories

When a user runs `tsuki pkg install dht`, the package is downloaded to the local libs directory. The build pipeline then passes `--libs-dir` and `--packages dht` to `tsuki-core`, which loads the manifest via `src/runtime/pkg_loader.rs` and registers the functions into the `Runtime` before transpilation begins.

### 5. Supported Go subset

tsuki does **not** support all of Go. Before adding a feature, know the boundaries:

- **Supported:** variables (`var`, `:=`), constants, functions, methods, structs, type aliases, `if/else`, `for` (all styles), `switch`, all operators, string literals, `import`, package calls
- **Stubs (emits a comment):** goroutines (`go`), `defer`
- **Partial:** interfaces (type declaration only), closures (skeleton), multiple return values (struct-packed), `map` (`void*` stub)
- **Not supported:** channels, generics, garbage collection

---

## How to work on each component

### Transpiler (Rust — `src/`)

The pipeline in order: `Lexer` → `Parser` → `AST` → `Transpiler::generate()`.

**Add a new built-in mapping:**
Edit `src/runtime/mod.rs`, register in `Runtime::new()` using the existing `register_fn` / `register_const` pattern.

**Fix a parse bug:**
Work in `src/parser/mod.rs`. AST node types live in `src/parser/ast.rs` — update the AST first, then the parser, then the transpiler.

**Fix a codegen bug:**
Work in `src/transpiler/mod.rs`, in the `emit_*` family of methods (`emit_expr`, `emit_stmt`, `emit_func`, etc.).

**Add Python support for a new construct:**
The Python pipeline is fully separate in `src/python/`. It mirrors the Go pipeline. Touch `src/python/lexer.rs` → `src/python/parser.rs` → `src/python/transpiler.rs`.

**Error reporting:**
All errors are `TsukiError` variants from `src/error.rs`. Always carry a `Span` with `file`, `line`, and `col`. Never emit an error without a span.

```bash
cargo build
cargo test
cargo build --release
```

### CLI (Go — `cli/`)

Each subcommand is a Cobra command in `cli/internal/cli/`. The commands shell out to the Rust binaries via `cli/internal/core/core.go` and `cli/internal/flash/flash.go`.

**Add a flag to an existing command:** edit the relevant file in `cli/internal/cli/` (e.g. `build.go` for `tsuki build`).

**Change the manifest format:** edit `cli/internal/manifest/manifest.go` — struct fields + JSON tags.

**Change config keys:** edit `cli/internal/config/config.go`.

**Improve terminal output:** helpers live in `cli/internal/ui/ui.go` using the `tsuki-ux` library.

```bash
cd cli && go build ./cmd/tsuki/...
```

### Adding a new tsukilib package (under `pkg/`)

1. Create `pkg/<n>/README.md`
2. Create `pkg/<n>/v1.0.0/godotinolib.toml`:

```toml
[package]
name        = "mypkg"
version     = "1.0.0"
description = "..."
author      = "..."
cpp_header  = "MyLib.h"
arduino_lib = "MyLib"      # arduino-cli library name for auto-install
cpp_class   = "MyClass"

aliases = ["MyClass"]      # Go type names that map to this C++ class

[[function]]
go     = "New"
python = "new"
cpp    = "MyClass({0}, {1})"

[[function]]
go     = "Read"
python = "read"
cpp    = "{0}.read()"

[[constant]]
go     = "MODE_A"
python = "MODE_A"
cpp    = "MODE_A"

[[example]]
dir = "examples/basic"
```

3. Add at least one example under `pkg/<n>/v1.0.0/examples/`.
4. Register the package in `pkg/packages.json`.

### Web IDE (`ide/`)

Standard Next.js project.

- `experiments/Lsp/` — LSP engine (`LspEngine.ts`) and IDE features (`LspFeatures.ts`): autocomplete, diagnostics, hover for the tsuki Go dialect.
- `experiments/SandboxPanel/` — Circuit simulator UI. `SandboxDefs.ts` defines component shapes. `hooks/useSimRunner.ts` drives the simulation loop.
- `components/docs/` — Documentation viewer; page content is in `pages/`.

```bash
cd ide && npm install && npm run dev
```

### Flash / compile backends (`flash/`)

- Add a new board architecture: add a new file in `flash/compile/`, expose a `compile()` function, register it in `flash/compile/mod.rs`.
- Add a new board: add an entry in `flash/boards.rs`.
- Add a new flash tool: add a module under `flash/flash/`.

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

---

## Common tasks quick-reference

| Task | File(s) |
|------|---------|
| Add a new Go built-in function | `src/runtime/mod.rs` |
| Add a new Go language construct | `src/parser/ast.rs` → `src/parser/mod.rs` → `src/transpiler/mod.rs` |
| Add a new Python built-in | `src/python/transpiler.rs` |
| Add a new CLI command | `cli/internal/cli/<cmd>.go` + register in `cli/internal/cli/root.go` |
| Add/change a manifest field | `cli/internal/manifest/manifest.go` |
| Add a new board | `flash/boards.rs` + `flash/compile/<arch>.rs` |
| Add a new tsukilib package | `pkg/<n>/` (see section above) |
| Fix/improve an error message | `src/error.rs` + call site in parser or transpiler |
| Change release build steps | `tools/build.py` |
| Update IDE docs content | `ide/src/components/docs/pages/<Page>.tsx` |

---

## Key invariants — never break these

1. **The CLI never transpiles.** All source transformation lives in `tsuki-core`. The CLI only marshals arguments, manages processes, and handles I/O.

2. **`src/` and `flash/` are separate Rust binaries.** They share the `tsuki_core` library crate (`src/lib.rs`) but have independent `main.rs` entry points. Do not merge them.

3. **`godotinolib.toml` is the single source of truth for a package's API surface.** The README documents it for humans; the TOML drives it for the transpiler.

4. **The transpiler must be deterministic.** Given the same source + board + package set, `tsuki-core` must produce identical C++ output every time. No timestamps, no random ordering in output.

5. **Error spans must always carry file + line + col.** The rich traceback renderer in the CLI depends on all three fields. An error with an empty span produces a useless traceback.

6. **Packages shipped in `pkg/` must include at least one Go example.** The IDE and documentation system use these examples for live previews.

---

## Minimal working example

Project structure:

```
my-project/
├── tsuki_package.json
└── src/
    └── main.go
```

`tsuki_package.json`:
```json
{
  "name": "my-project",
  "version": "0.1.0",
  "board": "uno",
  "packages": []
}
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

Running `tsuki build` calls:

```
tsuki-core src/main.go build/main.cpp --board uno
```

Which produces:

```cpp
// Generated by tsuki v6.0.0 — do not edit manually.
// Source package: main

#include <Arduino.h>

void setup() {
    pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(500);
    digitalWrite(LED_BUILTIN, LOW);
    delay(500);
}
```

---

## Visual design system

tsuki has a design system defined in `STYLE.md` and `app/globals.css`. **Every new app, page, or ecosystem component must follow it without exception.** Never hardcode hex values — always use `var(--token)`.

### Fonts

```css
--font-sans: 'IBM Plex Sans', system-ui, sans-serif;  /* weights: 300 400 500 600 */
--font-mono: 'IBM Plex Mono', 'Fira Code', monospace;
--base-size:  clamp(11px, 0.85vw, 14px);              /* fluid — never fixed px in layout */
```

Always enable: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`.

### Color tokens — dark mode (default)

#### Surfaces

| Token | Value | Use |
|-------|-------|-----|
| `--surface` | `#0a0a0a` | body, root background |
| `--surface-1` | `#111111` | sidebar, primary panels |
| `--surface-2` | `#171717` | cards, modals |
| `--surface-3` | `#1f1f1f` | inputs, dropdowns |
| `--surface-4` | `#282828` | toggles, chips |

#### Text

| Token | Value | Use |
|-------|-------|-----|
| `--fg` | `#ededed` | primary text |
| `--fg-muted` | `#8c8c8c` | secondary text, labels |
| `--fg-faint` | `#484848` | placeholders, inactive icons |

#### Borders and overlays

```css
--border:        #242424   /* primary border */
--border-subtle: #1c1c1c   /* internal separators */
--hover:  rgba(255,255,255,0.04)
--active: rgba(255,255,255,0.08)
```

#### Semantic

```css
--ok: #22c55e   --err: #ef4444   --warn: #f59e0b   --info: #93c5fd
```

#### Accent — critical rule

```css
--accent:     #ededed   /* white in dark, black in light */
--accent-inv: #0a0a0a   /* background for "solid" buttons */
```

The accent is **deliberately neutral** (black/white). There is no brand color — identity comes from typography and density. Never use blue, green, or purple as a brand color.

### Light mode

Same tokens with inverted values. Activated by adding `html.light`. The class `html.dark` is the default.

### Global typographic classes (public web)

Defined in `app/globals.css`:

| Class | Description |
|-------|-------------|
| `.t-display` | `clamp(52px → 100px)` weight 600, tracking -0.04em — hero |
| `.t-h2` | `clamp(28px → 48px)` weight 600, tracking -0.03em |
| `.t-h3` | `17px` weight 600, tracking -0.02em |
| `.t-body` | `15px` weight 400, line-height 1.68, `--fg-muted` |
| `.t-label` | `10.5px` mono, uppercase, tracking 0.09em, `--fg-faint` |
| `.t-mono` | `13px` mono |

### Layout and global primitive classes

```css
.container  /* max-width 1100px, margin 0 auto, padding 0 28px */
.section    /* padding 120px 0 */
.card       /* surface-1, border, radius 8px, hover border lift */
.badge      /* mono 10.5px, border, radius 20px, surface ghost */
.btn / .btn-primary / .btn-secondary
.divider    /* 1px, rgba(255,255,255,0.07) */
```

### Syntax tokens (embedded editor)

```css
--syn-kw: #ededed  --syn-fn: #d4d4d4  --syn-str: #a0a0a0
--syn-num: #b0b0b0  --syn-com: #525252  --syn-typ: #c8c8c8
```

Classes: `.syn-kw .syn-fn .syn-str .syn-num .syn-com .syn-typ .syn-pkg .syn-op`

### Animations

Durations: **150–200 ms ease** for UI. 300 ms maximum. Never more.

```css
.animate-fade-up  /* fadeUp 200ms ease — entrance from below */
.animate-fade-in  /* fadeIn 150ms ease */
.animate-up       /* fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) both — hero */
.reveal / .reveal.visible  /* scroll-triggered fade-up via IntersectionObserver */
```

### Rules that must never be broken

- No visible shadows between panels — use `border: 1px solid var(--border)` only.
- No large radii: `border-radius` max 8–12px on cards, 4–6px on controls.
- No decorative gradients in the IDE UI (allowed sparingly on the public website).
- No hardcoded colors — always `var(--token)` or `color-mix(in srgb, var(--token) N%, transparent)`.
- No animations > 300ms on functional UI transitions.
- No `!important` or Tailwind `@apply` except with strong justification.
- No fixed `px` in main layout sizes — use `clamp()`.

### Class writing pattern (Tailwind + CSS vars)

```tsx
// ✅ Correct
className="text-[var(--fg-muted)] bg-[var(--surface-2)]"
className="hover:bg-[color-mix(in_srgb,var(--err)_10%,transparent)]"

// ❌ Avoid
className="text-gray-400 bg-zinc-900"
```

### Surface hierarchy on a new screen

```
body                → var(--surface)    — background
sidebar / nav       → var(--surface-1)  — primary panel
cards / modals      → var(--surface-2)  — floating elements
inputs / dropdowns  → var(--surface-3)  — controls
toggles / chips     → var(--surface-4)  — small elements
```