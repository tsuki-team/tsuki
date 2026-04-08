# Plan: tsuki — Major Feature Expansion
 
## Context
 
The tsuki IDE currently handles a single source file, a single language (Go/Python), a fixed board set, and outputs plain text from tsuki-core. This plan covers ten coordinated epics to transform it into a full multi-file, multi-language, richly-visual IDE with a properly styled CLI toolchain.
 
User answers that shape scope:
- Multi-file Go → **real local packages** (`package sensors` importable from `main.go`)
- Rust → **best-effort full Rust transpilation**
- Board shapes → **vector schematic detail** (visible ICs, pads, labels)
- tsuki-ux → **output + interactive mode**, interactive disableable via `--non-interactive` flag for IDE
 
---
 
## Epic 1 — Multi-file Support (Go local packages)
 
### Problem
The transpiler is a single-file pipeline. `Pipeline::run(source, filename)` accepts one string. The IDE only ever sends the active tab's content. No import resolution exists for project-local packages.
 
### Architecture
 
**Package model:** All `.go` files in `src/` belong to either `package main` or a named sub-package. Local imports use project-relative paths: `import "myproject/sensors"`.
 
**New transpiler API** — `src/lib.rs`:
```rust
pub struct SourceFile {
    pub path:    String,
    pub content: String,
    pub package: String,   // from `package` declaration
}
 
// New entrypoint for project-wide compilation
impl Pipeline {
    pub fn run_project(
        &self,
        files:       &[SourceFile],
        entry_pkg:   &str,          // "main"
    ) -> Result<String>
}
```
 
**How it works:**
1. **Pass 0** — Parse each file just enough to extract package name and exported symbol declarations.
2. **Pass 1** — Build `ProjectContext { packages: HashMap<pkg_name, ExportedSymbols> }`.
3. **Pass 2** — Full transpile of each file, with `ProjectContext` injected into the `Runtime` so cross-package calls (`sensors.Read()`) resolve correctly.
4. **Output** — Merge all generated C++ into one file (like Arduino `#include` chain), with a single generated header for each sub-package.
 
**New Rust type** — `src/transpiler/project.rs`:
```rust
pub struct ProjectContext {
    pub packages: HashMap<String, PackageExports>,
}
pub struct PackageExports {
    pub functions: HashMap<String, FuncSig>,
    pub types:     HashMap<String, TypeDef>,
    pub consts:    HashMap<String, ConstDef>,
}
```
 
**Manifest change** — `cli/internal/manifest/manifest.go`:
Add optional `"entry_point": "src/main.go"` field (defaults to `src/main.go`).
 
**Tauri command** — `ide/src-tauri/src/main.rs`:
```rust
#[tauri::command]
async fn transpile_project(
    project_dir: String,
    board:       String,
    lang:        Option<String>,
) -> Result<String, String>
```
This command scans `<project_dir>/src/*.go`, groups by package, calls `Pipeline::run_project()`.
 
Also add:
```rust
#[tauri::command]
async fn get_project_source_files(project_dir: String) -> Result<Vec<SourceFileInfo>, String>
// Returns all .go/.py/.rs files under src/ with package names
```
 
**CLI** — `cli/internal/core/core.go`:
Add `CheckProject(projectDir, board, pkgs)` that passes `--project-dir` to tsuki-core.
 
**IDE store** — `ide/src/lib/store.ts`:
```typescript
// Add to AppState:
entryPoint: string | null          // fileId of main.go
projectPackageMap: Map<string, string[]>  // package name → file IDs
```
Add action `refreshProjectPackages()` that reads all source files and updates the map.
 
**LSP cross-file** — `ide/src/components/experiments/Lsp/LspEngine.ts`:
```typescript
export interface LspProjectContext {
    files:    Map<string, string>           // fileId → source
    packages: Map<string, ExportedSymbol[]> // pkg name → exports
}
```
New function `runProjectDiagnostics(ctx: LspProjectContext, opts)` that:
1. Runs per-file v2 diagnostics
2. Adds cross-file undefined-symbol check using `ctx.packages`
3. Returns `Map<fileId, Diagnostic[]>`
 
Wire into CodeEditor: when a file changes, re-run project-level analysis and refresh all open tabs' diagnostics.
 
**Sandbox** — `ide/src/components/experiments/SandboxPanel/views/SimView.tsx`:
Replace single-file `sourceContent` with a call to `transpile_project()`.
 
**Files affected:**
- `E:\tsuki\src\lib.rs` — new `SourceFile`, `run_project()`
- `E:\tsuki\src\transpiler\mod.rs` — cross-package resolution
- `E:\tsuki\src\transpiler\project.rs` — NEW: `ProjectContext`
- `E:\tsuki\src\main.rs` — `--project-dir` flag
- `E:\tsuki\ide\src-tauri\src\main.rs` — new Tauri commands
- `E:\tsuki\ide\src\lib\store.ts` — `entryPoint`, `projectPackageMap`
- `E:\tsuki\ide\src\lib\tauri.ts` — new wrapper functions
- `E:\tsuki\ide\src\components\experiments\Lsp\LspEngine.ts` — `LspProjectContext`
- `E:\tsuki\ide\src\components\experiments\Lsp\tsukilspenginev2\index.ts` — cross-file checks
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\views\SimView.tsx`
- `E:\tsuki\cli\internal\core\core.go`
- `E:\tsuki\cli\internal\manifest\manifest.go`
 
---
 
## Epic 2 — Rust Language Support
 
### Problem
Only Go and Python are supported. Rust is a natural fit for embedded/Arduino projects.
 
### Architecture
 
Mirror the Python pipeline pattern exactly.
 
**New directory:** `E:\tsuki\src\rust\`
```
src/rust/
  mod.rs       — pub use submodules, RustPipeline struct
  lexer.rs     — tokenize Rust source (keywords, operators, strings, comments)
  ast.rs       — Rust AST node types
  parser.rs    — Rust → AST (fn, struct, impl, let, if, for, match, use, mod)
  transpiler.rs — Rust AST → Arduino C++
```
 
**Supported Rust subset** (best-effort):
- Variables: `let x = 5;`, `let mut y: i32 = 0;`
- Functions: `fn setup() {}`, `fn loop() {}`, `fn read(pin: u8) -> i32 {}`
- Structs + impl blocks
- Control flow: `if/else`, `for x in iter`, `while`, `loop {}`, `match`
- `use arduino::*;` → maps to runtime
- Macros: `println!()` → Serial, `arduino::delay!()` → delay()
- Modules: `mod sensors;` → pulls in `sensors.rs` from same dir
- Attributes: `#![no_std]` (stripped), `#[arduino::setup]` (marks entry)
- References `&T`, `&mut T` → C++ pointer/reference (best-effort, no borrow check)
- Closures (basic, single-expression)
- Not supported: lifetimes, generics, async/await, traits (beyond basic `impl Trait`)
 
**Runtime mappings** — `src/runtime/mod.rs`:
Add Rust-flavored aliases for existing arduino mappings (same underlying C++ template).
 
**`src/lib.rs`:**
```rust
pub mod rust;
 
pub struct RustPipeline {
    cfg:  TranspileConfig,
    opts: PipelineOptions,
}
impl RustPipeline {
    pub fn run(&self, source: &str, filename: &str) -> Result<String>
}
```
 
**Tauri** — `ide/src-tauri/src/main.rs`:
Update `transpile_source`, `emit_sim_bundle`, `run_simulator` to handle `lang = "rust"` → `RustPipeline::run()`.
 
**IDE changes:**
- `store.ts`: Add `'rust'` to `projectLanguage` type
- `store.ts` `loadFromDisk`: Detect `"language": "rust"` in manifest
- `store.ts` `scanDir`: recognize `.rs` extension
- `LspEngine.ts`: Add a `diagnoseRust()` function (v1 regex-based initially): missing `fn setup()`/`fn loop()`, unbalanced braces, missing `use arduino`
- `FilesSidebar.tsx`: Show `.rs` icon for `.rs` files
- `useSimRunner.ts`: Handle `.rs` extension
- `SettingsScreen.tsx` LSP: Add Rust entry to Languages section
 
**CLI** — `cli/internal/manifest/manifest.go`:
Add `LangRust = "rust"` constant.
Update `EffectiveLanguage()` to return rust.
`cli/internal/check/check.go`: glob `*.rs` for Rust projects.
 
**Files affected:**
- `E:\tsuki\src\rust\` — NEW (5 files)
- `E:\tsuki\src\lib.rs`
- `E:\tsuki\src\runtime\mod.rs`
- `E:\tsuki\src\main.rs`
- `E:\tsuki\Cargo.toml`
- `E:\tsuki\ide\src-tauri\src\main.rs`
- `E:\tsuki\ide\src\lib\store.ts`
- `E:\tsuki\ide\src\components\experiments\Lsp\LspEngine.ts`
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\hooks\useSimRunner.ts`
- `E:\tsuki\ide\src\components\other\FilesSidebar.tsx`
- `E:\tsuki\ide\src\components\screens\SettingsScreen.tsx`
- `E:\tsuki\cli\internal\manifest\manifest.go`
- `E:\tsuki\cli\internal\check\check.go`
 
---
 
## Epic 3 — More Boards and Libraries
 
### Boards to add
 
In `E:\tsuki\flash\boards.rs` (static entries):
- `arduino_mega` — ATmega2560, 256K flash, 8K RAM
- `arduino_nano` — ATmega328P (5V, 16MHz variant)
- `arduino_nano_every` — ATmega4809
- `arduino_leonardo` — ATmega32U4 (USB HID)
- `arduino_due` — AT91SAM3X8E (ARM, 3.3V)
- `stm32_bluepill` — STM32F103C8T6 (ARM Cortex-M3)
- `raspberry_pi_pico` — RP2040 (dual-core, existing xiao_rp2040 extended)
- `teensy40` — iMXRT1062
 
Each also gets a `pkg/<id>/v1.0.0/tsuki_board.toml` with FQBN and pin definitions.  
`pkg/packages.json` gets corresponding `type: "board"` entries.
 
### Libraries to add
 
New packages in `pkg/` (each with `godotinolib.toml` + Go example):
- `ds18b20` — Dallas OneWire temperature sensor
- `max7219` — 8×8 LED matrix driver
- `oled_ssd1306` — OLED display (128×64, I2C)
- `rtc_ds3231` — Real-time clock
- `hcsr04` — Ultrasonic distance sensor
- `l298n` — Dual H-bridge motor driver
- `nrf24l01` — 2.4 GHz radio module
- `sd_card` — SD card (SPI)
- `midi` — MIDI serial protocol
- `tft_ili9341` — Color TFT display
 
**Files affected:**
- `E:\tsuki\flash\boards.rs`
- `E:\tsuki\pkg\packages.json`
- `E:\tsuki\pkg\<board|lib>\v1.0.0\` — NEW entries
 
---
 
## Epic 4 — Simulator Components + Board TSX Packages
 
### New simulator components
 
Add to `E:\tsuki\ide\src\components\experiments\SandboxPanel\SandboxDefs.ts`:
- `matrix_8x8` — MAX7219-driven 8×8 dot matrix (64 pins mapped to rows/cols)
- `shift_register_595` — 74HC595 (serial in, parallel out)
- `motor_driver_l298n` — dual H-bridge, 4 input pins + 2 enable
- `stepper_motor` — 4-coil, shows rotation angle
- `ds18b20_probe` — OneWire temp probe
- `imu_mpu6050` — I2C, shows orientation visually
- `logic_analyzer_probe` — attach to wire, shows waveform
 
Each component needs:
- Entry in `COMP_DEFS` (type, w, h, pins array with arduino pin numbers)
- Shape function in `shapes/` (new file `shapes/advanced-shapes.tsx`)
- Simulation logic hook in `SandboxShapes.tsx` `ComponentBody()`
 
### Board package TSX designs
 
**Architecture:** Each board gets a detailed SVG-based React component stored in `shapes/board-shapes.tsx`.
 
New detailed shapes:
- `ArduinoUnoBody` — enhance existing: visible ATmega328P IC, USB-B port, power jack, ICSP header, crystal, voltage regulator
- `ArduinoMegaBody` — ATmega2560, 4× UART labels, extra digital/analog pin rows
- `ArduinoNanoBody` — enhance existing: USB mini port, visible chip
- `Esp32Body` — enhance existing: CP2102 USB bridge IC, WiFi antenna trace, 38-pin layout
- `Esp8266Body` — NodeMCU layout, ESP-12F module visible
- `RpiPicoBody` — RP2040 chip, USB micro, SWD header, 40-pin layout
- `STM32BluepillBody` — STM32F103, JTAG header, boot jumpers
 
Design rules for all board shapes:
- PCB color: `#1a3a1a` (green) or `#1a1a4a` (blue) per real board
- Copper pads: `#c8a830` (gold)
- IC chips: dark rectangle with visible pin stubs
- Silkscreen labels: `#e8e8e8` tiny text at pin positions
- Pin positions MUST match `COMP_DEFS[type].pins[i].pos` exactly
 
**Files affected:**
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\SandboxDefs.ts`
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\SandboxShapes.tsx`
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\shapes\board-shapes.tsx`
- `E:\tsuki\ide\src\components\experiments\SandboxPanel\shapes\advanced-shapes.tsx` — NEW
 
---
 
## Epic 5 — Checker Error Handling Improvements
 
### Problems
1. `declareVar()` early-returns when `currentScope()` is null (top-level `const`/`var` silently skipped)
2. Rust checker `TsukiError` has no "secondary span" / notes system
3. `pretty_error()` doesn't render multi-span errors (no "note: original declared here")
4. v2 engine: import path strings are stripped of quotes before lookup but the `KNOWN_LIBS` lookup uses quoted keys inconsistently
 
### Fixes
 
**TypeScript v2** — `tsukilspenginev2/index.ts`:
- Add a global scope frame pushed at startup and never popped, so top-level `const`/`var` declarations are tracked
- Fix the `!currentScope()` guard: change to always push a fallback global frame instead of early-returning
- Track top-level const/var usage via `globalDecls: Map<string, VarEntry>` separate from the function-scope stack
- After the walk, emit T0001 for any global decl with `reads === 0 && writes === 0`
 
**Rust checker** — `E:\tsuki\src\error.rs`:
```rust
pub struct DiagNote {
    pub span: Span,
    pub msg:  String,
}
 
// Add to TsukiError variants:
// notes: Vec<DiagNote>
```
 
**`src/checker/mod.rs`:**
- When emitting T0010 (duplicate declaration), attach a note: `"previously declared at line N"`
- When emitting T0006 (undefined identifier), check if it was declared in another file (for project-mode)
 
**`src/error.rs`** — `pretty_error()`:
- Extend to render secondary notes with `note:` prefix and caret under the secondary span
 
**Files affected:**
- `E:\tsuki\ide\src\components\experiments\Lsp\tsukilspenginev2\index.ts`
- `E:\tsuki\src\error.rs`
- `E:\tsuki\src\checker\mod.rs`
 
---
 
## Epic 6 — BottomPanel Output Rendering Fixes
 
### Problems
1. Spinner frames (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) appear as static Unicode — not animated
2. LiveBlock/progress: `\r` overwrites work but the UI doesn't visually separate "live" vs "settled" lines
3. Error lines from tsuki-core/flash aren't visually grouped
4. Box-drawing chars (─ │ ╭ ╮) may not render if font fallback drops them
 
### Fixes in `E:\tsuki\ide\src\components\other\BottomPanel.tsx`:
 
**Spinner animation:**
- Detect when a line contains only spinner chars (`/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/`)
- Replace with a CSS-animated `<span className="animate-spin">⠋</span>` that cycles frames via `useEffect` + `setInterval`
- Spinner lines get a distinct style: slightly dimmed, no cursor
 
**\r overwrite (LiveBlock):**
- Add a `liveLines: Map<number, string>` tracking which output lines are "live" (last updated via `\r`)
- When a `\r` comes in for a line already in the buffer, mark it as `live: true`
- Live lines render with a left border: `borderLeft: '2px solid var(--fg-faint)'`
- Once a `\n` follows, the line is "settled" and border is removed
 
**Error separation:**
- After parsing ANSI, detect semantic line types: `'error' | 'warning' | 'info' | 'step' | 'normal'`
- Error lines get a `background: rgba(239,68,68,0.04)` tint and `borderLeft: '2px solid var(--err)'`
- Warning lines get amber left border
- Consecutive error block: visual gap (`marginTop: 8`) before first error line
- After last error line: summary chip `"N errors"` in red
 
**Box-drawing fix:**
- Force `fontFamily: 'IBM Plex Mono, Fira Code, Consolas, monospace'` on the terminal container — all these fonts include Unicode box-drawing range U+2500–U+257F
 
**Files affected:**
- `E:\tsuki\ide\src\components\other\BottomPanel.tsx`
 
---
 
## Epic 7 — tsuki-core Output Redesign (tsuki-ux)
 
### Problem
`E:\tsuki\src\main.rs` uses plain `eprintln!()`/`println!()` with no styling.
 
### Solution
 
Add `tsuki_ux` Rust crate dependency (same crate tsuki-flash uses):
- `E:\tsuki\Cargo.toml`: Add `tsuki_ux = "1.x"` to `[workspace.dependencies]`
- `E:\tsuki\src\Cargo.toml` (if separate): add dependency
 
**Redesign `src/main.rs` output:**
```
Transpiling  main.go  →  build/main.cpp       [--board uno]
 
 ─── Pass 1  Lexing ────────────────────────── ✓ 42 tokens
 ─── Pass 2  Parsing ──────────────────────── ✓ 18 nodes
 ─── Pass 3  Generating ───────────────────── ✓ 89 lines
 
  artifact   build/main.cpp   (2.1 KB)
```
 
Using: `section()`, `step()`, `artifact()`, `success()`, `fail()` from tsuki_ux.
 
**Interactive mode (disableable):**
Add `--non-interactive` / `-q` flag. When set:
- No `section`/`section_end` box-drawing
- No LiveBlock
- Plain `step()` / `success()` / `fail()` output only
- IDE always passes `--non-interactive`
 
For project-mode (`--project-dir`), use `LiveBlock` showing per-file progress.
 
**Files affected:**
- `E:\tsuki\Cargo.toml`
- `E:\tsuki\src\main.rs`
 
---
 
## Epic 8 — tsuki-flash Output Improvements
 
### Problem
tsuki-flash already uses tsuki-ux but lacks LiveBlock for compilation progress and has plain sequential steps.
 
### Solution in `E:\tsuki\flash\main.rs`:
 
- Wrap compilation step in `LiveBlock` showing `"Compiling… [3/7 files]"` counter
- Wrap flash step in `LiveBlock` showing bytes written / total
- Group compiler error output inside a box: `BOX_TL───── Compiler errors ─────BOX_TR`
- Add `--non-interactive` flag (propagated from IDE via spawn args)
- Improve board-detect output: table with `BOX_V` borders per detected board
 
**Files affected:**
- `E:\tsuki\flash\main.rs`
- `E:\tsuki\flash\compile\mod.rs` (LiveBlock integration points)
 
---
 
## Epic 9 — tsuki-cli LiveBlock
 
### Problem
CLI commands like `tsuki build`, `tsuki check` print flat sequential lines with no live status.
 
### Solution in `E:\tsuki\cli\`:
 
- `cli/internal/ui/ui.go`: Add `LiveBlock` wrapper that delegates to tsuki-ux Go library's LiveBlock
- `cli/internal/cli/build.go`: Wrap build pipeline in LiveBlock `"Building project…"` with sub-steps
- `cli/internal/cli/check.go`: LiveBlock showing `"Checking file N/M: filename.go"`
- `cli/internal/cli/upload.go`: LiveBlock showing flash progress
 
Add `--no-interactive` flag to all commands. IDE passes this flag when spawning CLI.
 
**Files affected:**
- `E:\tsuki\cli\internal\ui\ui.go`
- `E:\tsuki\cli\internal\cli\build.go`
- `E:\tsuki\cli\internal\cli\check.go`
- `E:\tsuki\cli\internal\cli\upload.go`
- `E:\tsuki\cli\go.mod` (verify tsuki-ux Go version)
 
---
 
## Epic 10 — IDE Passes `--non-interactive` to All CLI Calls
 
### Problem
The IDE currently spawns `tsuki build`, `tsuki check`, `tsuki-core`, `tsuki-flash` without any non-interactive flag. Once Epics 7–9 add interactive features, the IDE must suppress them.
 
### Solution
 
In `E:\tsuki\ide\src\lib\tauri.ts`:
- `transpileSource()` → adds `--non-interactive` to underlying spawn
- `emitSimBundle()` → same
- `runSimulator()` → same
 
In Tauri command `transpile_source` → pass `--non-interactive` to tsuki-core invocation.
 
In any `spawnProcess(cmd, args, ...)` calls in the IDE that invoke CLI tools:
- Always append `--no-interactive` to args list
 
**Files affected:**
- `E:\tsuki\ide\src\lib\tauri.ts`
- `E:\tsuki\ide\src-tauri\src\main.rs`
- `E:\tsuki\ide\src\components\other\BottomPanel.tsx` (terminal spawns)
 
> Añadir al plan existente (Epics 1–10) tras Epic 10.
 
---
 
## Epic 11 — Repositorio dedicado `tsuki-pkg`
 
### Problema
 
`/pkg` vive dentro del monorepo principal de tsuki. Esto genera tres fricciones concretas:
 
- Las librerías y boards se versionan junto con el transpiler y el IDE, cuando su ciclo de vida es completamente distinto.
- Contribuir una librería nueva requiere acceso al repo entero.
- El CLI y el pkg_loader tienen que leer de disco local; no hay forma de instalar un paquete sin haber clonado tsuki completo.
 
### Arquitectura
 
**Nuevo repo:** `github.com/tsuki-team/tsuki-pkg`
 
Estructura interna (igual que el `/pkg` actual, pero separado):
 
```
tsuki-pkg/
├── packages.json            ← índice de librerías
├── boards.json              ← índice de boards
├── libs/
│   └── <name>/
│       ├── README.md
│       └── v<semver>/
│           ├── godotinolib.toml
│           └── examples/
│               └── basic/
│                   ├── main.go
│                   ├── tsuki_example.json
│                   └── circuit.tsuki-circuit
└── boards/
    └── <id>/
        ├── README.md
        └── v<semver>/
            ├── tsuki_board.toml
            └── sandbox.json
```
 
**Integración con el monorepo principal:**
 
El repo tsuki referencia tsuki-pkg como **git submodule** en `/pkg`. En desarrollo local funciona igual que hoy (lectura de disco). En CI y releases, el submodule se pinea a un tag semver de tsuki-pkg.
 
**Nuevo campo en config del CLI** — `cli/internal/config/config.go`:
 
```go
type Config struct {
    // ... campos existentes ...
    PkgRegistryURL string `json:"pkg_registry_url"` 
    // default: "https://raw.githubusercontent.com/tsuki-team/tsuki-pkg/main"
}
```
 
**Modo fetch remoto en `pkg_loader.rs`:**
 
Cuando `tsuki pkg install <name>` se ejecuta sin submodule local disponible (distribución binaria del CLI), el pkg_loader descarga directamente desde `PkgRegistryURL`:
 
```
GET {registry_url}/libs/{name}/{version}/godotinolib.toml
GET {registry_url}/libs/{name}/{version}/examples/basic/main.go
```
 
Los archivos descargados se cachean en `~/.cache/tsuki/pkg/<name>/<version>/`.
 
**`tsuki pkg search`** — nuevo subcomando que descarga `packages.json` del registry y filtra por nombre/descripción. Sustituye al actual `tsuki pkg list`.
 
**CI de tsuki-pkg** (GitHub Actions independiente):
 
- Valida que cada entrada en `packages.json` tiene su `godotinolib.toml` y al menos un ejemplo.
- Valida que cada entrada en `boards.json` tiene su `tsuki_board.toml`.
- Ejecuta `scripts/check-invariants.py` del repo principal contra los archivos nuevos/modificados.
- Bloquea el merge si falla cualquier invariante.
 
### Archivos afectados
 
| Acción | Archivo |
|--------|---------|
| **Mover** | `pkg/` → repo `tsuki-pkg` (como submodule en `/pkg`) |
| Modificar | `src/runtime/pkg_loader.rs` — modo fetch remoto + caché |
| Modificar | `cli/internal/config/config.go` — campo `pkg_registry_url` |
| Modificar | `cli/internal/cli/pkg.go` — `search` subcommand, install desde URL |
| Modificar | `tools/package.py` — apuntar a layout de tsuki-pkg |
| Nuevo | `.gitmodules` — entrada para tsuki-pkg |
| Nuevo | `tsuki-pkg/.github/workflows/validate.yml` |
| Actualizar | SKILL.md del agente — sección "Adding a tsukilib package" |
 
### Verificación
 
```bash
# Sin submodule (solo binario del CLI)
tsuki pkg search oled          # lista paquetes que contienen "oled"
tsuki pkg install oled_ssd1306 # descarga de GitHub raw, cachea en ~/.cache/tsuki
 
# Con submodule (desarrollo)
tsuki pkg install oled_ssd1306 # lee de /pkg/libs/ como hoy
```
 
---
 
## Epic 12 — Scaffolding de paquetes y boards (`tsuki pkg scaffold` / `tsuki board scaffold`)
 
### Problema
 
Añadir una librería nueva requiere crear manualmente entre 5 y 8 archivos con estructura precisa:
`godotinolib.toml`, `README.md`, `main.go` de ejemplo, `tsuki_example.json`, `circuit.tsuki-circuit`, y registrar la entrada en `packages.json`. El proceso actual es un shell script de `cat > file << 'EOF'` repetido, como evidencia `docs/WIP.md`. Es lento, error-prone, y no escala.
 
### Solución
 
Nuevo subcomando `scaffold` para `tsuki pkg` y `tsuki board`. Soporta **modo interactivo** (preguntas en terminal) y **modo spec** (desde un archivo YAML para bulk creation).
 
---
 
### Diseño CLI
 
```
tsuki pkg scaffold <name>                    # interactivo
tsuki pkg scaffold --from <spec.yaml>        # headless, un paquete
tsuki pkg scaffold --from <specs-dir/>       # headless, todos los .yaml del directorio
 
tsuki board scaffold <id>                    # interactivo
tsuki board scaffold --from <board-spec.yaml>
```
 
---
 
### Formato del spec file (librerías)
 
`pkg-spec.yaml`:
 
```yaml
name: hcsr04
version: "1.0.0"
description: "HC-SR04 ultrasonic distance sensor"
author: tsuki-team
arduino_lib: "HCSR04"
cpp_header: "HCSR04.h"
cpp_class: "HCSR04"
aliases: ["HCSR04", "Ultrasonic"]
 
functions:
  - go: New
    python: new
    cpp: "HCSR04({0}, {1})"
  - go: Distance
    python: distance
    cpp: "{0}.dist()"
  - go: DistanceCm
    python: distance_cm
    cpp: "{0}.dist(CM)"
 
constants:
  - go: CM
    python: CM
    cpp: "CM"
  - go: INC
    python: INC
    cpp: "INC"
 
example:
  board: uno
  title: "Measure Distance"
  description: "Read distance in cm from an HC-SR04 sensor and print to Serial."
  code: |
    package main
 
    import (
      "arduino"
      "fmt"
      "hcsr04"
    )
 
    var sensor = hcsr04.New(9, 10)
 
    func setup() {
      arduino.Serial.Begin(9600)
    }
 
    func loop() {
      fmt.Print("Distance: ")
      fmt.Print(sensor.DistanceCm())
      fmt.Println(" cm")
      arduino.Delay(500)
    }
  circuit_components:
    - id: uno
      type: arduino_uno
      label: "Arduino Uno"
      x: 40
      y: 20
```
 
---
 
### Formato del spec file (boards)
 
`board-spec.yaml`:
 
```yaml
id: nano_every
name: "Arduino Nano Every"
description: "ATmega4809, 48K flash, 6K RAM, 5V/16MHz — updated Nano with megaAVR architecture"
fqbn: "arduino:megaavr:nanoevery"
variant: nanoevery
version: "1.0.0"
author: tsuki-team
 
toolchain:
  type: avr
  mcu: atmega4809
  f_cpu: 16000000
  voltage: 5
  programmer: arduino
  baud: 115200
 
flash_kb: 48
ram_kb: 6
 
defines:
  - ARDUINO_AVR_NANO_EVERY
  - ARDUINO_ARCH_MEGAAVR
 
pins:
  digital: 14
  pwm: 5
  analog: 8
  uart: 1
  spi: 1
  i2c: 1
 
readme: |
  The Nano Every is the updated Nano with ATmega4809 and more flash/RAM than the classic Nano.
  Same compact DIP form factor, USB-C connector.
```
 
---
 
### Archivos generados por `tsuki pkg scaffold`
 
A partir del spec YAML, el comando genera en tsuki-pkg (o en `/pkg` si es submodule local):
 
```
libs/<name>/
├── README.md                            ← generado desde description + readme
└── v<version>/
    ├── godotinolib.toml                 ← generado desde functions/constants/aliases
    └── examples/
        └── basic/
            ├── main.go                  ← desde example.code
            ├── tsuki_example.json       ← desde example.title/description
            └── circuit.tsuki-circuit    ← desde example.circuit_components
```
 
Además, actualiza automáticamente `packages.json` con la nueva entrada.
 
---
 
### Archivos generados por `tsuki board scaffold`
 
```
boards/<id>/
├── README.md
└── v<version>/
    └── tsuki_board.toml
```
 
Actualiza `boards.json`. Además imprime el **snippet Rust** listo para pegar en `flash/boards.rs`:
 
```
✓ boards/nano_every/v1.0.0/ creado
✓ boards.json actualizado
 
Añade esto a flash/boards.rs:
────────────────────────────────────────
BoardDef {
    id:       "nano_every",
    name:     "Arduino Nano Every",
    fqbn:     "arduino:megaavr:nanoevery",
    flash_kb: 48,
    ram_kb:   6,
    arch:     Arch::Avr(AvrConfig {
        mcu:        "atmega4809",
        f_cpu:      16_000_000,
        programmer: "arduino",
        baud:       115_200,
    }),
    defines: &["ARDUINO_AVR_NANO_EVERY", "ARDUINO_ARCH_MEGAAVR"],
}
────────────────────────────────────────
```
 
---
 
### Implementación
 
Nuevos archivos en `cli/`:
 
```
cli/internal/scaffold/
├── pkg.go          ← renderiza godotinolib.toml, README, ejemplos
├── board.go        ← renderiza tsuki_board.toml, README, snippet Rust
├── spec.go         ← parse de pkg-spec.yaml y board-spec.yaml
├── registry.go     ← actualiza packages.json / boards.json
└── templates/      ← Go embed.FS
    ├── godotinolib.toml.tmpl
    ├── pkg_readme.md.tmpl
    ├── main_go.tmpl
    ├── tsuki_example_json.tmpl
    ├── circuit_tsuki_circuit.tmpl
    ├── tsuki_board_toml.tmpl
    └── board_readme.md.tmpl
```
 
Modificar `cli/internal/cli/pkg.go` — añadir `scaffoldCmd`.
Modificar `cli/internal/cli/boards.go` (o nuevo `cli/internal/cli/board.go`) — añadir `scaffoldCmd`.
 
**Modo bulk (para Epic 3 y futuros):**
 
En lugar del WIP.md actual, la creación de los 10 paquetes nuevos de Epic 3 se hace así:
 
```bash
tsuki pkg scaffold --from specs/libs/      # procesa ds18b20.yaml, max7219.yaml, ...
tsuki board scaffold --from specs/boards/  # procesa nano_every.yaml, stm32_bluepill.yaml, ...
```
 
Los archivos spec de los paquetes de Epic 3 se guardan en `tsuki-pkg/specs/` y sirven como fuente de verdad y documentación.
 
---
 
### Archivos afectados (en monorepo tsuki)
 
| Archivo | Cambio |
|---------|--------|
| `cli/internal/scaffold/` | **NUEVO** — 5 archivos Go + directorio templates |
| `cli/internal/cli/pkg.go` | Añadir subcomando `scaffold` |
| `cli/internal/cli/board.go` | Añadir subcomando `scaffold` |
| `cli/go.mod` | Añadir `gopkg.in/yaml.v3` para parse de specs |
| `docs/WIP.md` | Reemplazar con specs YAML en `tsuki-pkg/specs/` |
| `scripts/new-package.sh` | Deprecar → apunta a `tsuki pkg scaffold` |
| `scripts/new-board.sh` | Deprecar → apunta a `tsuki board scaffold` |
 
---
 
### Verificación
 
```bash
# Crear una librería nueva desde cero (interactivo)
tsuki pkg scaffold hcsr04
# → Pregunta: description, arduino_lib, cpp_header, cpp_class...
# → Genera todos los archivos
# → Actualiza packages.json
 
# Crear en bulk desde specs (headless, para CI o scripting)
tsuki pkg scaffold --from tsuki-pkg/specs/libs/
# → Procesa todos los *.yaml, genera, actualiza packages.json
 
# Crear un board
tsuki board scaffold nano_every
# → Genera tsuki_board.toml, README.md
# → Imprime snippet Rust para flash/boards.rs
```
 
---
 
## Implementation Order (Dependencies)
 
```
Epic 10 (non-interactive flags) — enables Epics 7–9 to be safe to merge
Epic 5  (checker fixes)         — standalone, no dependencies
Epic 6  (BottomPanel fixes)     — standalone
Epic 7  (tsuki-core ux)         — after Epic 10
Epic 8  (tsuki-flash ux)        — after Epic 10
Epic 9  (cli LiveBlock)         — after Epic 10
Epic 3  (boards/libraries)      — standalone
Epic 4  (sim components/shapes) — standalone
Epic 2  (Rust support)          — after Epic 3 (boards share tsuki-core infra)
Epic 1  (multi-file)            — last, depends on Epic 2 infra
```
 
Recommended parallel batches:
- **Batch A** (no deps): Epics 3, 4, 5, 6, 10
- **Batch B** (after A): Epics 7, 8, 9
- **Batch C** (after B): Epic 2 (Rust)
- **Batch D** (after C): Epic 1 (multi-file, largest)
## Orden de implementación
 
Estos dos epics son **independientes entre sí** y del resto del plan. Se pueden meter en el Batch A:
 
| Batch | Epics |
|-------|-------|
| A (sin deps) | 3, 4, 5, 6, 10, **11, 12** |
| B (tras A) | 7, 8, 9 |
| C (tras B) | 2 (Rust) |
| D (tras C) | 1 (multi-file) |
 
**Nota interna:** Epic 12 debe implementarse antes de completar Epic 3 (Boards/Libraries), porque los 10 paquetes nuevos de Epic 3 se crearán usando `tsuki pkg scaffold --from specs/` en lugar del enfoque shell script actual.
 
---
 
## Verification
 
| Epic | How to verify |
|------|--------------|
| 1 Multi-file | Create project with `src/main.go` + `src/sensors.go` (package sensors), import from main, build in IDE → no errors |
| 2 Rust | Create project with `language: rust`, write `fn setup(){}`, transpile → valid C++ |
| 3 Boards/Libs | Open pkg manager in IDE, install `ds18b20`, board dropdown shows `arduino_mega` |
| 4 Sim components | Drop `matrix_8x8` in sandbox, wire to UNO D2, run sim → LED matrix animates |
| 5 Checker | Write `const test = 1` at top level → T0001 warning appears in editor |
| 6 BottomPanel | Run `tsuki build` → spinner animates, error lines have red left border, box chars visible |
| 7 tsuki-core | Run `tsuki-core main.go out.cpp` → colored section/step/artifact output |
| 8 tsuki-flash | Run `tsuki upload` → LiveBlock shows compile progress, errors in box |
| 9 CLI LiveBlock | Run `tsuki check` → LiveBlock shows file-by-file progress |
| 10 Non-interactive | Run build from IDE → no LiveBlock, no interactive prompts in BottomPanel |