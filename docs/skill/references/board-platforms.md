# Board Platforms — Downloadable Board Support

**Goal:** Make board definitions downloadable packages so users can install ESP32/ESP8266/future boards without hardcoding them in the binary.

---

## Architecture overview

```
boards/                          ← Git-tracked registry
  boards.json                    ← Registry index
  esp32/v1.0.0/
    tsukiboard.toml              ← Board manifest → parsed into Board struct
    sandbox.json                 ← Circuit sandbox component def
    ports.json                   ← USB VID/PID detection
    README.md                    ← Shown in IDE install modal

~/.tsuki/boards/                 ← Per-user install location
  esp32/1.0.0/
    tsukiboard.toml
    sandbox.json
    ports.json
    README.md
    precompiled/
      core-esp32.a               ← Pre-compiled core library
      core-esp32.sig             ← Signature for cache invalidation
```

---

## tsukiboard.toml format

```toml
[board]
id          = "esp32"
name        = "ESP32 Dev Module"
version     = "1.0.0"
description = "Espressif ESP32 dual-core 32-bit microcontroller"
author      = "tsuki-team"
fqbn        = "esp32:esp32:esp32"
variant     = "esp32"
flash_kb    = 4096
ram_kb      = 520
f_cpu       = 240000000

[files]
sandbox = "sandbox.json"
ports   = "ports.json"
readme  = "README.md"

[toolchain]
type        = "esp32"      # avr | esp32 | esp8266 | rp2040 | sam
variant     = "esp32"
upload_tool = "esptool"
upload_baud = 921600

[detection]
name_patterns = ["ESP32", "ESP-WROOM", "CP2102", "CH340"]

[[detection.usb]]
vid  = "10C4"
pid  = "EA60"
chip = "Silicon Labs CP2102"

[[define]]
name = "ARDUINO_ESP32_DEV"

[[define]]
name = "ESP32"
```

`platforms::parse_board_toml(raw)` parses this into a `Board` struct usable by the compile pipeline.

---

## Key Rust API (flash/platforms/mod.rs)

```rust
// Called once at main() startup
pub fn load_installed_platforms()

// Fallback in Board::find() after static catalog
pub fn find_dynamic(id: &str) -> Option<&'static Board>

// Download + install a platform
pub fn install(board_id: &str, version_hint: Option<&str>, opts: &InstallOptions) -> Result<String>

// Pre-compile core library (saves 30-90s on first project build)
pub fn precompile(board_id: &str, use_modules: bool, verbose: bool) -> Result<()>

// Get path to pre-compiled core.a (returns None if not installed)
pub fn precompiled_core(board_id: &str) -> Option<PathBuf>

// Signature stored alongside core.a for cache validation
pub fn precompiled_core_sig(board_id: &str) -> Option<String>

// List all locally installed platforms
pub fn list_installed() -> Vec<InstalledPlatform>

// Remove an installed platform
pub fn remove(board_id: &str) -> Result<()>

// Fetch boards.json from registry (cached 24h)
pub fn fetch_registry(registry_url: &str) -> Result<Vec<RegistryEntry>>

// Parse a tsukiboard.toml string into a Board struct
pub fn parse_board_toml(raw: &str) -> Option<Board>
```

---

## Board lookup chain

```rust
// flash/boards.rs — Board::find() must follow this order:
pub fn find(id: &str) -> Option<&'static Board> {
    BOARDS.iter()
        .find(|b| b.id.eq_ignore_ascii_case(id))
        .or_else(|| crate::platforms::find_dynamic(id))
}
```

---

## CLI subcommand: `tsuki-flash platforms`

```
tsuki-flash platforms install <board>  [--version] [--registry] [--precompile] [--use-modules]
tsuki-flash platforms list
tsuki-flash platforms remove <board>
tsuki-flash platforms precompile <board>
tsuki-flash platforms search  [--registry]
```

Default registry URL: `https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json`

Override with env var: `TSUKI_BOARDS_REGISTRY`

---

## Pre-compiled core reuse (flash/compile/avr.rs)

Add this block **before** the `build_core(...)` call:

```rust
// Pre-compiled core shortcut
if !core_a.exists() {
    if let (Some(precomp), Some(precomp_sig)) = (
        crate::platforms::precompiled_core(board.id),
        crate::platforms::precompiled_core_sig(board.id),
    ) {
        if precomp_sig.trim() == core_sig {
            if let Ok(()) = std::fs::copy(&precomp, &core_a).map(|_| ()) {
                let _ = std::fs::write(&core_dir.join(".core_sig"), &core_sig);
            }
        }
    }
}
```

---

## IDE integration

### Store additions (ide/src/lib/store.ts)

```typescript
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples' | 'platforms' | 'explorer'

export interface BoardPlatform {
  id: string; name: string; version: string; description: string
  author: string; arch: string; category: string
  installed: boolean; installing?: boolean; url?: string
}

// Store state fields:
platforms:                  BoardPlatform[]
platformsLoaded:            boolean
setPlatforms:               (p: BoardPlatform[]) => void
setBoardPlatformInstalling: (id: string, installing: boolean) => void
addInstalledPlatform:       (p: BoardPlatform) => void
removeInstalledPlatform:    (id: string) => void
// Settings:
boardsRegistryUrl:          string
```

### IDE components

| Component | Location | Purpose |
|-----------|----------|---------|
| `PlatformsSidebar` | `ide/src/components/other/PlatformsSidebar.tsx` | Browse + install sidebar |
| `BoardInstallModal` | `ide/src/components/other/BoardInstallModal.tsx` | Install popup with README / Files / Specs tabs + progress stream |

### IdeScreen wiring

```tsx
// sidebarTabs array:
{ id: 'platforms', icon: <Cpu size={15} />, label: 'Platforms' },

// Sidebar switch:
case 'platforms': return <PlatformsSidebar />
```

### Settings (SettingsScreen.tsx — CliTab)

Add a `boardsRegistryUrl` field after the registryUrl field.

---

## File map summary

### Created

| Path | Purpose |
|------|---------|
| `boards/boards.json` | Registry index |
| `boards/esp32/v1.0.0/tsukiboard.toml` | ESP32 manifest |
| `boards/esp32/v1.0.0/sandbox.json` | ESP32 circuit component |
| `boards/esp32/v1.0.0/ports.json` | ESP32 USB detection |
| `boards/esp32/v1.0.0/README.md` | ESP32 docs |
| `boards/esp8266/v1.0.0/…` | Same four files for ESP8266 |
| `flash/platforms/mod.rs` | Platform manager |
| `ide/src/components/other/PlatformsSidebar.tsx` | Sidebar |
| `ide/src/components/other/BoardInstallModal.tsx` | Install modal |

### Modified

| Path | Change |
|------|--------|
| `flash/boards.rs` | `find()` fallback to dynamic |
| `flash/main.rs` | `platforms` subcommand |
| `flash/compile/avr.rs` | Pre-compiled core reuse |
| `ide/src/lib/store.ts` | `BoardPlatform` type + state |
| `ide/src/components/screens/IdeScreen.tsx` | Platforms tab |
| `ide/src/components/screens/SettingsScreen.tsx` | `boardsRegistryUrl` setting |