# Agent Guide: tsuki-flash (compile backends / SDK / board platforms)

Use this guide when your task involves:
- `flash/compile/` — per-architecture compile backends
- `flash/flash/` — flash tool backends (avrdude, esptool)
- `flash/boards.rs` — static board definitions
- `flash/platforms/` — downloadable board platform manager
- `flash/sdk.rs` — toolchain download & resolution
- `flash/lib_manager.rs` — Arduino library resolver
- `flash/detect.rs` — USB board auto-detection
- `flash/main.rs` — CLI entry (clap subcommands)

---

## Board lookup chain

When `tsuki-flash` needs to resolve a board ID:

```
1. Board::find(id)  →  checks static BOARDS array in flash/boards.rs
2.                  →  falls back to platforms::find_dynamic(id)
                        (loaded from ~/.tsuki/boards/ at startup)
```

**Never bypass `Board::find()`.** All dynamic boards must go through `platforms::load_installed_platforms()` called at `main()` startup.

---

## Adding a new static board

Edit `flash/boards.rs`. Each entry is a `Board` struct literal:

```rust
Board {
    id:       "myboard",
    name:     "My Custom Board",
    fqbn:     "myvendor:myarch:myboard",
    variant:  "myboard",
    flash_kb: 256,
    ram_kb:   32,
    toolchain: Toolchain::Avr {
        mcu:        "atmega2560",
        f_cpu:      16_000_000,
        programmer: "arduino",
        baud:       115_200,
    },
    defines: &["ARDUINO_MY_BOARD", "ARDUINO_ARCH_AVR"],
}
```

Toolchain variants: `Toolchain::Avr { .. }`, `Toolchain::Esp32 { variant }`, `Toolchain::Esp8266`, `Toolchain::Rp2040`, `Toolchain::Sam { mcu, f_cpu }`.

---

## Adding a new compile architecture

1. Create `flash/compile/<arch>.rs` with a `pub fn compile(req: &CompileRequest, board: &Board) -> Result<()>` function.
2. Register it in `flash/compile/mod.rs` by adding a match arm in the main `compile()` dispatcher.
3. The function must:
   - Resolve the SDK via `sdk::resolve(arch, variant, req.use_modules)`
   - Build the core library (`build_core()`) with cache check
   - Compile sketch sources
   - Link into `.hex` / `.bin` / `.uf2`
4. For AVR specifically: check `platforms::precompiled_core(board.id)` before calling `build_core()` to reuse pre-compiled archives. See `references/board-platforms.md` Task 4.

---

## Board platforms (downloadable)

Full spec: `references/board-platforms.md`

Quick reference:

| File | Purpose |
|------|---------|
| `flash/platforms/mod.rs` | download, install, list, remove, precompile |
| `boards/<id>/v<ver>/tsukiboard.toml` | board manifest (parsed into `Board` struct) |
| `boards/<id>/v<ver>/sandbox.json` | circuit sandbox component def |
| `boards/<id>/v<ver>/ports.json` | USB VID/PID patterns |
| `boards/<id>/v<ver>/README.md` | shown in IDE install modal |

**Key functions in `platforms/mod.rs`:**

```rust
pub fn load_installed_platforms()          // call at main() startup
pub fn find_dynamic(id: &str) -> Option<&'static Board>
pub fn install(id, version, opts) -> Result<String>
pub fn precompile(id, use_modules, verbose) -> Result<()>
pub fn precompiled_core(id) -> Option<PathBuf>
pub fn precompiled_core_sig(id) -> Option<String>
pub fn list_installed() -> Vec<InstalledPlatform>
pub fn remove(id) -> Result<()>
pub fn fetch_registry(url) -> Result<Vec<RegistryEntry>>
pub fn parse_board_toml(raw: &str) -> Option<Board>
```

**Pre-compiled core reuse** (AVR): if `platforms::precompiled_core(board.id)` returns a path and its `.sig` matches `core_sig`, copy the `.a` directly instead of rebuilding. This skips the 30–90 s core compilation on first project build.

---

## CLI subcommands (flash/main.rs)

Current subcommand tree:

```
tsuki-flash
  compile  <sketch> [--board] [--output] [--verbose] ...
  upload   <hex>    [--board] [--port]   ...
  detect              # USB board detection
  modules
    install <sdk>
    list
    remove  <sdk>
  platforms
    install <board>  [--version] [--registry] [--precompile] [--use-modules]
    list
    remove  <board>
    precompile <board>
    search  [--registry]
```

When adding a new subcommand:
1. Add `Args` struct with `#[derive(Args)]`
2. Add variant to `enum Cmd`
3. Add dispatch in `match cli.command`
4. Add `fn cmd_<name>()` handler

---

## SDK resolution

`sdk::resolve(arch, variant, use_modules)` returns an `Sdk` struct with:
- `toolchain_bin` — path to compiler executables
- `core_dir` — Arduino core source directory
- `include_dirs` — standard include paths

If `use_modules` is true, the SDK is stored under `~/.tsuki/modules/` (tsuki's own store). Otherwise it falls back to `~/.arduino15/` (arduino-cli compatibility).

---

## Windows-specific notes

- **MAX_PATH:** All toolchain executable paths are short-circuited through `\\?\` prefix on Windows when the path exceeds 260 chars. Use `sdk::normalize_path()` before passing paths to `Command`.
- **Process spawning:** Never use `CREATE_NO_WINDOW` with piped stdio simultaneously — it causes hangs. Use `CREATE_NO_WINDOW` only when stdio is inherited or discarded.
- **Toolchain naming:** ESP32 toolchain executables may use `xtensa-esp32-elf-gcc` or `xtensa-esp32-elf-gcc.exe`. Use `sdk::find_tool()` which tries both.

---

## Build

```bash
cargo build --bin tsuki-flash
cargo build --bin tsuki-flash --release

# Smoke test
./target/debug/tsuki-flash platforms list
./target/debug/tsuki-flash detect
```