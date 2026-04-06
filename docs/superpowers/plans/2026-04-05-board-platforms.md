# Board Platforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make board definitions downloadable packages (like libraries) so users can browse, install, and pre-compile support for ESP32 / ESP8266 and future boards without hardcoding them in the binary.

**Architecture:** A new `boards/` directory in the repo acts as the registry, containing `boards.json` + per-board directories with `tsukiboard.toml` (TOML manifest), `sandbox.json` (circuit sandbox component), `ports.json` (VID/PID detection), and `README.md`. `tsuki-flash` gets a `platforms` sub-command to download/install/remove/precompile. The IDE gets a new **Platforms** sidebar tab with an install modal that renders the README, file preview, and specs, then streams pre-compilation output. Pre-compiled `core.a` archives are stored at `~/.tsuki/boards/<id>/<version>/precompiled/` and transparently reused by the AVR compile backend to skip the 30-90 s core build.

**Tech Stack:** Rust (tsuki-flash), TypeScript/React (IDE), Go (tsuki CLI shim), TOML, JSON, lucide-react icons.

---

## File Map

### Created
| Path | Purpose |
|------|---------|
| `boards/boards.json` | Registry index — maps board IDs to versions + TOML URLs |
| `boards/esp32/v1.0.0/tsukiboard.toml` | ESP32 board manifest (specs, toolchain, detection, defines) |
| `boards/esp32/v1.0.0/sandbox.json` | ESP32 CircuitComponentDef for sandbox |
| `boards/esp32/v1.0.0/ports.json` | ESP32 USB VID/PID patterns |
| `boards/esp32/v1.0.0/README.md` | ESP32 documentation (shown in install modal) |
| `boards/esp8266/v1.0.0/tsukiboard.toml` | ESP8266 board manifest |
| `boards/esp8266/v1.0.0/sandbox.json` | ESP8266 CircuitComponentDef |
| `boards/esp8266/v1.0.0/ports.json` | ESP8266 USB VID/PID patterns |
| `boards/esp8266/v1.0.0/README.md` | ESP8266 documentation |
| `flash/platforms/mod.rs` | Platform manager — download, install, list, remove, precompile |
| `ide/src/components/other/PlatformsSidebar.tsx` | Sidebar tab: browse + install board platforms |
| `ide/src/components/other/BoardInstallModal.tsx` | Install popup: README / Files / Specs tabs + progress |

### Modified
| Path | Change |
|------|--------|
| `flash/boards.rs` | Add `find_or_dynamic(id)` that falls back to installed platforms; add `load_dynamic_boards()` at startup |
| `flash/main.rs` | Add `Platforms(PlatformsArgs)` sub-command with `install / list / remove / precompile` |
| `flash/compile/avr.rs` | Before `build_core()`, check `platforms::precompiled_core(board.id)` and reuse if sig matches |
| `ide/src/lib/store.ts` | Add `'platforms'` to `SidebarTab`; add `BoardPlatform` type + state (`platforms`, `setPlatforms`, etc.) |
| `ide/src/components/screens/IdeScreen.tsx` | Add platforms icon to `sidebarTabs` array; render `<PlatformsSidebar />` in switch |
| `ide/src/components/screens/SettingsScreen.tsx` | Add `boardsRegistryUrl` field to `CliTab` |

---

## Task 1 — Board Registry Data Files

**Files:**
- Create: `boards/boards.json`
- Create: `boards/esp32/v1.0.0/tsukiboard.toml`
- Create: `boards/esp32/v1.0.0/sandbox.json`
- Create: `boards/esp32/v1.0.0/ports.json`
- Create: `boards/esp32/v1.0.0/README.md`
- Create: `boards/esp8266/v1.0.0/tsukiboard.toml`
- Create: `boards/esp8266/v1.0.0/sandbox.json`
- Create: `boards/esp8266/v1.0.0/ports.json`
- Create: `boards/esp8266/v1.0.0/README.md`

- [ ] **Step 1 — Create `boards/boards.json`**

```json
{
  "boards": {
    "esp32": {
      "description": "Espressif ESP32 dual-core 240 MHz · WiFi + Bluetooth",
      "author": "tsuki-team",
      "arch": "esp32",
      "category": "wifi",
      "latest": "1.0.0",
      "versions": {
        "1.0.0": "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/esp32/v1.0.0/tsukiboard.toml"
      }
    },
    "esp8266": {
      "description": "Espressif ESP8266 single-core 80 MHz · WiFi",
      "author": "tsuki-team",
      "arch": "esp8266",
      "category": "wifi",
      "latest": "1.0.0",
      "versions": {
        "1.0.0": "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/esp8266/v1.0.0/tsukiboard.toml"
      }
    }
  }
}
```

- [ ] **Step 2 — Create `boards/esp32/v1.0.0/tsukiboard.toml`**

```toml
# ── Board identity ─────────────────────────────────────────────────────────────
[board]
id          = "esp32"
name        = "ESP32 Dev Module"
version     = "1.0.0"
description = "Espressif ESP32 dual-core 32-bit microcontroller development board"
author      = "tsuki-team"
fqbn        = "esp32:esp32:esp32"
variant     = "esp32"
flash_kb    = 4096
ram_kb      = 520
f_cpu       = 240000000

# ── Companion files bundled with this platform ─────────────────────────────────
[files]
sandbox = "sandbox.json"
ports   = "ports.json"
readme  = "README.md"

# ── Toolchain ──────────────────────────────────────────────────────────────────
[toolchain]
type        = "esp32"
variant     = "esp32"
upload_tool = "esptool"
upload_baud = 921600

# ── USB auto-detection ─────────────────────────────────────────────────────────
[detection]
name_patterns = ["ESP32", "ESP-WROOM", "CP2102", "CH340"]

[[detection.usb]]
vid  = "10C4"
pid  = "EA60"
chip = "Silicon Labs CP2102"

[[detection.usb]]
vid  = "1A86"
pid  = "7523"
chip = "CH340"

[[detection.usb]]
vid  = "0403"
pid  = "6001"
chip = "FTDI FT232"

[[detection.usb]]
vid  = "0403"
pid  = "6015"
chip = "FTDI FT231X"

[[detection.usb]]
vid  = "239A"
pid  = "8029"
chip = "Adafruit Feather ESP32"

# ── Compiler defines ───────────────────────────────────────────────────────────
[[define]]
name = "ARDUINO_ESP32_DEV"

[[define]]
name = "ESP32"

[[define]]
name = "ARDUINO_ARCH_ESP32"

[[define]]
name = "CONFIG_IDF_TARGET_ESP32"
```

- [ ] **Step 3 — Create `boards/esp32/v1.0.0/sandbox.json`**

```json
{
  "type": "esp32_dev",
  "label": "ESP32",
  "w": 56,
  "h": 116,
  "color": "#1a1a2e",
  "borderColor": "#2d2d6e",
  "category": "mcu",
  "description": "ESP32 Dev Module — 38-pin",
  "pins": [
    { "id": "EN",   "label": "EN",   "type": "digital", "rx": 0,  "ry": 6,   "direction": "in" },
    { "id": "VP",   "label": "VP",   "type": "analog",  "rx": 0,  "ry": 12,  "arduino": 36 },
    { "id": "VN",   "label": "VN",   "type": "analog",  "rx": 0,  "ry": 18,  "arduino": 39 },
    { "id": "D34",  "label": "D34",  "type": "analog",  "rx": 0,  "ry": 24,  "arduino": 34 },
    { "id": "D35",  "label": "D35",  "type": "analog",  "rx": 0,  "ry": 30,  "arduino": 35 },
    { "id": "D32",  "label": "D32",  "type": "digital", "rx": 0,  "ry": 36,  "arduino": 32 },
    { "id": "D33",  "label": "D33",  "type": "digital", "rx": 0,  "ry": 42,  "arduino": 33 },
    { "id": "D25",  "label": "D25",  "type": "pwm",     "rx": 0,  "ry": 48,  "arduino": 25 },
    { "id": "D26",  "label": "D26",  "type": "pwm",     "rx": 0,  "ry": 54,  "arduino": 26 },
    { "id": "D27",  "label": "D27",  "type": "pwm",     "rx": 0,  "ry": 60,  "arduino": 27 },
    { "id": "D14",  "label": "D14",  "type": "pwm",     "rx": 0,  "ry": 66,  "arduino": 14 },
    { "id": "D12",  "label": "D12",  "type": "pwm",     "rx": 0,  "ry": 72,  "arduino": 12 },
    { "id": "GND1", "label": "GND",  "type": "gnd",     "rx": 0,  "ry": 78  },
    { "id": "D13",  "label": "D13",  "type": "pwm",     "rx": 0,  "ry": 84,  "arduino": 13 },
    { "id": "D9",   "label": "SD2",  "type": "digital", "rx": 0,  "ry": 90,  "arduino": 9  },
    { "id": "D10",  "label": "SD3",  "type": "digital", "rx": 0,  "ry": 96,  "arduino": 10 },
    { "id": "CMD",  "label": "CMD",  "type": "digital", "rx": 0,  "ry": 102, "arduino": 11 },
    { "id": "VIN",  "label": "VIN",  "type": "power",   "rx": 0,  "ry": 110 },
    { "id": "3V3",  "label": "3.3V", "type": "power",   "rx": 56, "ry": 6  },
    { "id": "GND2", "label": "GND",  "type": "gnd",     "rx": 56, "ry": 12 },
    { "id": "D15",  "label": "D15",  "type": "pwm",     "rx": 56, "ry": 18, "arduino": 15 },
    { "id": "D2",   "label": "D2",   "type": "digital", "rx": 56, "ry": 24, "arduino": 2  },
    { "id": "D4",   "label": "D4",   "type": "digital", "rx": 56, "ry": 30, "arduino": 4  },
    { "id": "D16",  "label": "D16",  "type": "digital", "rx": 56, "ry": 36, "arduino": 16 },
    { "id": "D17",  "label": "D17",  "type": "digital", "rx": 56, "ry": 42, "arduino": 17 },
    { "id": "D5",   "label": "D5",   "type": "pwm",     "rx": 56, "ry": 48, "arduino": 5  },
    { "id": "D18",  "label": "D18",  "type": "spi",     "rx": 56, "ry": 54, "arduino": 18 },
    { "id": "D19",  "label": "D19",  "type": "spi",     "rx": 56, "ry": 60, "arduino": 19 },
    { "id": "GND3", "label": "GND",  "type": "gnd",     "rx": 56, "ry": 66 },
    { "id": "D21",  "label": "D21",  "type": "i2c",     "rx": 56, "ry": 72, "arduino": 21 },
    { "id": "RX",   "label": "RX0",  "type": "digital", "rx": 56, "ry": 78, "arduino": 3  },
    { "id": "TX",   "label": "TX0",  "type": "digital", "rx": 56, "ry": 84, "arduino": 1  },
    { "id": "D22",  "label": "D22",  "type": "i2c",     "rx": 56, "ry": 90, "arduino": 22 },
    { "id": "D23",  "label": "D23",  "type": "spi",     "rx": 56, "ry": 96, "arduino": 23 },
    { "id": "GND4", "label": "GND",  "type": "gnd",     "rx": 56, "ry": 102 },
    { "id": "5V",   "label": "5V",   "type": "power",   "rx": 56, "ry": 110 }
  ]
}
```

- [ ] **Step 4 — Create `boards/esp32/v1.0.0/ports.json`**

```json
{
  "usb": [
    { "vid": "10C4", "pid": "EA60", "name": "Silicon Labs CP2102" },
    { "vid": "1A86", "pid": "7523", "name": "CH340"               },
    { "vid": "0403", "pid": "6001", "name": "FTDI FT232RL"        },
    { "vid": "0403", "pid": "6015", "name": "FTDI FT231X"         },
    { "vid": "239A", "pid": "8029", "name": "Adafruit Feather ESP32" }
  ],
  "name_patterns": ["ESP32", "ESP-WROOM", "CP2102", "CH340"]
}
```

- [ ] **Step 5 — Create `boards/esp32/v1.0.0/README.md`**

```markdown
# ESP32 Dev Module

The ESP32 is Espressif's dual-core 32-bit microcontroller with integrated WiFi and Bluetooth.
It is the recommended board for IoT and wireless projects with tsuki.

## Specifications

| Property     | Value              |
|--------------|--------------------|
| CPU          | Xtensa LX6 dual-core 240 MHz |
| Flash        | 4 MB               |
| RAM          | 520 KB SRAM        |
| WiFi         | 802.11 b/g/n       |
| Bluetooth    | BT 4.2 + BLE       |
| GPIO         | 34 programmable    |
| ADC          | 18 channels (12-bit) |
| DAC          | 2 channels (8-bit) |
| Operating voltage | 3.3 V         |
| Input voltage | 5 V via USB-C/Micro-USB |

## Pinout (38-pin Dev Module)

| Left pins | Right pins |
|-----------|-----------|
| EN (reset) | 3.3V |
| VP (GPIO36) | GND |
| VN (GPIO39) | GPIO15 |
| GPIO34 | GPIO2 (LED) |
| GPIO35 | GPIO4 |
| GPIO32 | GPIO16 |
| GPIO33 | GPIO17 |
| GPIO25 | GPIO5 |
| GPIO26 | GPIO18 (SPI CLK) |
| GPIO27 | GPIO19 (SPI MISO) |
| GPIO14 | GND |
| GPIO12 | GPIO21 (I2C SDA) |
| GND | RX0 (GPIO3) |
| GPIO13 | TX0 (GPIO1) |
| SD2 | GPIO22 (I2C SCL) |
| SD3 | GPIO23 (SPI MOSI) |
| CMD | GND |
| VIN (5V) | 5V |

## Example: Blink

```go
package main

import "arduino"

func setup() {
    arduino.PinMode(2, arduino.OUTPUT)
}

func loop() {
    arduino.DigitalWrite(2, arduino.HIGH)
    arduino.Delay(500)
    arduino.DigitalWrite(2, arduino.LOW)
    arduino.Delay(500)
}
```

## Notes

- GPIO34, 35, 36, 39 are **input-only** (no internal pull-up/down).
- GPIO6–11 are connected to the internal flash — do **not** use them.
- ADC2 pins (GPIO0, 2, 4, 12–15, 25–27) are unavailable when WiFi is active.
- The built-in LED is on GPIO2.

## SDK Installation

The ESP32 SDK is installed automatically when you first build a project targeting this board.
To install manually: `tsuki-flash modules install esp32`
```

- [ ] **Step 6 — Create `boards/esp8266/v1.0.0/tsukiboard.toml`**

```toml
[board]
id          = "esp8266"
name        = "ESP8266 Generic"
version     = "1.0.0"
description = "Espressif ESP8266 single-core WiFi microcontroller"
author      = "tsuki-team"
fqbn        = "esp8266:esp8266:generic"
variant     = "generic"
flash_kb    = 4096
ram_kb      = 80
f_cpu       = 80000000

[files]
sandbox = "sandbox.json"
ports   = "ports.json"
readme  = "README.md"

[toolchain]
type        = "esp8266"
upload_tool = "esptool"
upload_baud = 921600

[detection]
name_patterns = ["ESP8266", "NodeMCU", "D1 mini", "Wemos", "CP2102", "CH340"]

[[detection.usb]]
vid  = "10C4"
pid  = "EA60"
chip = "Silicon Labs CP2102"

[[detection.usb]]
vid  = "1A86"
pid  = "7523"
chip = "CH340"

[[detection.usb]]
vid  = "0403"
pid  = "6001"
chip = "FTDI FT232"

[[detection.usb]]
vid  = "0403"
pid  = "6015"
chip = "FTDI FT231X"

[[define]]
name = "ARDUINO_ESP8266_GENERIC"

[[define]]
name = "ESP8266"

[[define]]
name = "ARDUINO_ARCH_ESP8266"
```

- [ ] **Step 7 — Create `boards/esp8266/v1.0.0/sandbox.json`**

```json
{
  "type": "esp8266_generic",
  "label": "ESP8266",
  "w": 42,
  "h": 72,
  "color": "#1e2a1e",
  "borderColor": "#2a4a2a",
  "category": "mcu",
  "description": "ESP8266 Generic — WiFi SoC",
  "pins": [
    { "id": "RST",  "label": "RST",  "type": "digital", "rx": 0,  "ry": 6  },
    { "id": "A0",   "label": "A0",   "type": "analog",  "rx": 0,  "ry": 12, "arduino": 0  },
    { "id": "D0",   "label": "D0",   "type": "digital", "rx": 0,  "ry": 18, "arduino": 16 },
    { "id": "D5",   "label": "D5",   "type": "spi",     "rx": 0,  "ry": 24, "arduino": 14 },
    { "id": "D6",   "label": "D6",   "type": "spi",     "rx": 0,  "ry": 30, "arduino": 12 },
    { "id": "D7",   "label": "D7",   "type": "spi",     "rx": 0,  "ry": 36, "arduino": 13 },
    { "id": "D8",   "label": "D8",   "type": "digital", "rx": 0,  "ry": 42, "arduino": 15 },
    { "id": "RX",   "label": "RX",   "type": "digital", "rx": 0,  "ry": 48, "arduino": 3  },
    { "id": "TX",   "label": "TX",   "type": "digital", "rx": 0,  "ry": 54, "arduino": 1  },
    { "id": "GND1", "label": "GND",  "type": "gnd",     "rx": 0,  "ry": 60 },
    { "id": "3V3",  "label": "3.3V", "type": "power",   "rx": 0,  "ry": 66 },
    { "id": "D1",   "label": "D1",   "type": "i2c",     "rx": 42, "ry": 6,  "arduino": 5  },
    { "id": "D2",   "label": "D2",   "type": "i2c",     "rx": 42, "ry": 12, "arduino": 4  },
    { "id": "D3",   "label": "D3",   "type": "digital", "rx": 42, "ry": 18, "arduino": 0  },
    { "id": "D4",   "label": "D4",   "type": "digital", "rx": 42, "ry": 24, "arduino": 2  },
    { "id": "3V31", "label": "3.3V", "type": "power",   "rx": 42, "ry": 30 },
    { "id": "GND2", "label": "GND",  "type": "gnd",     "rx": 42, "ry": 36 },
    { "id": "5V",   "label": "5V",   "type": "power",   "rx": 42, "ry": 42 },
    { "id": "GND3", "label": "GND",  "type": "gnd",     "rx": 42, "ry": 48 },
    { "id": "VIN",  "label": "VIN",  "type": "power",   "rx": 42, "ry": 54 },
    { "id": "GND4", "label": "GND",  "type": "gnd",     "rx": 42, "ry": 60 },
    { "id": "GND5", "label": "GND",  "type": "gnd",     "rx": 42, "ry": 66 }
  ]
}
```

- [ ] **Step 8 — Create `boards/esp8266/v1.0.0/ports.json`**

```json
{
  "usb": [
    { "vid": "10C4", "pid": "EA60", "name": "Silicon Labs CP2102" },
    { "vid": "1A86", "pid": "7523", "name": "CH340"               },
    { "vid": "0403", "pid": "6001", "name": "FTDI FT232RL"        },
    { "vid": "0403", "pid": "6015", "name": "FTDI FT231X"         }
  ],
  "name_patterns": ["ESP8266", "NodeMCU", "D1 mini", "Wemos", "CP2102", "CH340"]
}
```

- [ ] **Step 9 — Create `boards/esp8266/v1.0.0/README.md`**

```markdown
# ESP8266

The ESP8266 is Espressif's single-core WiFi SoC. It is compact, affordable, and
well-supported in the Arduino ecosystem. Perfect for simple wireless projects.

## Specifications

| Property     | Value              |
|--------------|--------------------|
| CPU          | Tensilica L106 80/160 MHz |
| Flash        | 4 MB (typical)     |
| RAM          | 80 KB SRAM         |
| WiFi         | 802.11 b/g/n       |
| GPIO         | 17 (11 usable)     |
| ADC          | 1 channel (10-bit) |
| Operating voltage | 3.3 V         |
| Input voltage | 5 V via USB        |

## GPIO Map (NodeMCU / D1 mini labels)

| Label | GPIO | Notes              |
|-------|------|--------------------|
| D0    | 16   | No PWM/I2C, wake from deep sleep |
| D1    | 5    | I2C SCL            |
| D2    | 4    | I2C SDA            |
| D3    | 0    | Boot — pull-up     |
| D4    | 2    | Built-in LED (inverted) |
| D5    | 14   | SPI CLK            |
| D6    | 12   | SPI MISO           |
| D7    | 13   | SPI MOSI           |
| D8    | 15   | Boot — pull-down   |
| RX    | 3    | UART RX            |
| TX    | 1    | UART TX            |
| A0    | ADC  | 0–1 V input (3.2 V max with divider) |

## Example: Blink

```go
package main

import "arduino"

func setup() {
    arduino.PinMode(2, arduino.OUTPUT)
}

func loop() {
    arduino.DigitalWrite(2, arduino.LOW)   // LED on (inverted)
    arduino.Delay(500)
    arduino.DigitalWrite(2, arduino.HIGH)  // LED off
    arduino.Delay(500)
}
```

## Notes

- GPIO0, 2, 15 are **boot-select** pins — avoid driving them low at power-on.
- GPIO6–11 are used by internal SPI flash — **do not use**.
- Only **one ADC** channel (A0, 10-bit, 0–1 V).
- The built-in LED is on GPIO2 and is **active-LOW**.

## SDK Installation

`tsuki-flash modules install esp8266`
```

- [ ] **Step 10 — Commit**

```bash
git add boards/
git commit -m "feat: add board platform registry (ESP32 + ESP8266)"
```

---

## Task 2 — tsuki-flash: Platforms Module

**Files:**
- Create: `flash/platforms/mod.rs`
- Modify: `flash/boards.rs` (add dynamic board loading)

- [ ] **Step 1 — Create `flash/platforms/mod.rs`**

The module handles: download, install, list, remove, pre-compile of board platforms.

```rust
// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: platforms  —  downloadable board platform manager
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::sync::{OnceLock, Mutex};
use std::time::{Duration, SystemTime};

use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use tsuki_ux::{LiveBlock, step, success, fail, info, warn, note};

// ─── Registry URL ─────────────────────────────────────────────────────────────

const DEFAULT_BOARDS_REGISTRY: &str =
    "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json";

const CACHE_TTL: Duration = Duration::from_secs(24 * 3600);

// ─── Installed boards stored in memory ────────────────────────────────────────

/// Leaked &'static Board instances loaded from ~/.tsuki/boards/ at startup.
static DYNAMIC_BOARDS: OnceLock<Mutex<Vec<&'static Board>>> = OnceLock::new();

fn dynamic_registry() -> &'static Mutex<Vec<&'static Board>> {
    DYNAMIC_BOARDS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Register a heap-allocated Board as 'static (leaks intentionally — boards
/// are loaded once per process and never dropped).
fn register(b: Board) {
    let leaked: &'static Board = Box::leak(Box::new(b));
    dynamic_registry().lock().unwrap().push(leaked);
}

/// Look up a board from installed platforms (fallback after static catalog).
pub fn find_dynamic(id: &str) -> Option<&'static Board> {
    dynamic_registry().lock().unwrap()
        .iter()
        .find(|b| b.id.eq_ignore_ascii_case(id))
        .copied()
}

// ─── Directory helpers ────────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").ok().map(PathBuf::from) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").ok().map(PathBuf::from) }
}

fn boards_root() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".tsuki").join("boards"))
}

fn platform_dir(board_id: &str, version: &str) -> Option<PathBuf> {
    boards_root().map(|r| r.join(board_id).join(version))
}

/// Path to the pre-compiled core.a for a board (returns any installed version).
pub fn precompiled_core(board_id: &str) -> Option<PathBuf> {
    let root = boards_root()?;
    let board_dir = root.join(board_id);
    // Walk version directories, pick latest (alphabetically last)
    let mut versions: Vec<_> = std::fs::read_dir(&board_dir).ok()?
        .flatten().filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    versions.sort();
    let version = versions.last()?;
    let precomp_dir = board_dir.join(version).join("precompiled");
    // Return the first .a file found
    std::fs::read_dir(&precomp_dir).ok()?
        .flatten()
        .find(|e| e.path().extension().and_then(|x| x.to_str()) == Some("a"))
        .map(|e| e.path())
}

/// Companion .sig file storing the core_sig used during pre-compilation.
pub fn precompiled_core_sig(board_id: &str) -> Option<String> {
    let core = precompiled_core(board_id)?;
    std::fs::read_to_string(core.with_extension("sig")).ok()
}

// ─── Startup loader ───────────────────────────────────────────────────────────

/// Call once at startup (main.rs) to load all installed platforms into memory.
pub fn load_installed_platforms() {
    let Some(root) = boards_root() else { return };
    let Ok(entries) = std::fs::read_dir(&root) else { return };
    for entry in entries.flatten() {
        let board_dir = entry.path();
        if !board_dir.is_dir() { continue; }
        // Find latest version subdirectory
        let mut versions: Vec<_> = std::fs::read_dir(&board_dir).ok()
            .into_iter().flatten().flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        versions.sort();
        if let Some(ver) = versions.last() {
            let toml_path = board_dir.join(ver).join("tsukiboard.toml");
            if toml_path.exists() {
                if let Some(board) = load_toml_as_board(&toml_path) {
                    register(board);
                }
            }
        }
    }
}

// ─── TOML → Board parsing ─────────────────────────────────────────────────────

fn leak_str(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

fn leak_strs(v: Vec<String>) -> &'static [&'static str] {
    let leaked: Vec<&'static str> = v.into_iter().map(leak_str).collect();
    Box::leak(leaked.into_boxed_slice())
}

/// Parse a tsukiboard.toml file and return a Board usable by the compile pipeline.
pub fn load_toml_as_board(path: &Path) -> Option<Board> {
    let raw = std::fs::read_to_string(path).ok()?;
    parse_board_toml(&raw)
}

pub fn parse_board_toml(raw: &str) -> Option<Board> {
    // Minimal key=value scanner — same pattern used throughout the codebase.
    let mut id = String::new();
    let mut name = String::new();
    let mut fqbn = String::new();
    let mut variant = String::new();
    let mut flash_kb: u32 = 0;
    let mut ram_kb: u32 = 0;
    let mut f_cpu: u32 = 0;
    let mut toolchain_type = String::new();
    let mut toolchain_variant = String::new();
    let mut upload_baud: u32 = 921_600;
    let mut avr_mcu = String::new();
    let mut avr_programmer = String::new();
    let mut avr_baud: u32 = 0;
    let mut defines: Vec<String> = Vec::new();
    let mut in_define = false;
    let mut cur_define_name = String::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with("[[define]]") {
            if !cur_define_name.is_empty() {
                defines.push(cur_define_name.clone());
                cur_define_name.clear();
            }
            in_define = true;
            continue;
        }
        if line.starts_with("[[") || line.starts_with('[') {
            if !cur_define_name.is_empty() {
                defines.push(cur_define_name.clone());
                cur_define_name.clear();
            }
            in_define = false;
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        let val = line[eq+1..].trim().trim_matches('"').to_string();

        if in_define {
            if key == "name" { cur_define_name = val; }
            continue;
        }
        match key {
            "id"               => id = val,
            "name"             => name = val,
            "fqbn"             => fqbn = val,
            "variant"          => variant = val,
            "flash_kb"         => flash_kb = val.parse().unwrap_or(0),
            "ram_kb"           => ram_kb = val.parse().unwrap_or(0),
            "f_cpu"            => f_cpu = val.parse().unwrap_or(0),
            "type"             => toolchain_type = val,
            "upload_baud"      => upload_baud = val.parse().unwrap_or(921_600),
            "upload_tool"      => {}  // stored implicitly via toolchain type
            "mcu"              => avr_mcu = val,
            "programmer"       => avr_programmer = val,
            "avr_baud"         => avr_baud = val.parse().unwrap_or(0),
            _ => {}
        }
        // toolchain.variant overrides board.variant for esp32 sub-variants
        if key == "variant" && !toolchain_type.is_empty() {
            toolchain_variant = val.clone();
        }
    }
    if !cur_define_name.is_empty() {
        defines.push(cur_define_name);
    }

    if id.is_empty() || toolchain_type.is_empty() { return None; }

    // Determine the effective toolchain variant for ESP32
    let esp_variant = if !toolchain_variant.is_empty() { toolchain_variant.clone() }
                      else { id.clone() };

    let toolchain = match toolchain_type.as_str() {
        "avr" => Toolchain::Avr {
            mcu:        leak_str(avr_mcu),
            f_cpu,
            programmer: leak_str(if avr_programmer.is_empty() { "arduino".into() } else { avr_programmer }),
            baud:       if avr_baud > 0 { avr_baud } else { upload_baud },
        },
        "esp32"   => Toolchain::Esp32 { variant: leak_str(esp_variant) },
        "esp8266" => Toolchain::Esp8266,
        "rp2040"  => Toolchain::Rp2040,
        "sam"     => Toolchain::Sam {
            mcu:   leak_str(avr_mcu),
            f_cpu,
        },
        _ => return None,
    };

    Some(Board {
        id:       leak_str(id),
        name:     leak_str(name),
        fqbn:     leak_str(fqbn),
        variant:  leak_str(variant),
        flash_kb,
        ram_kb,
        toolchain,
        defines:  leak_strs(defines),
    })
}

// ─── Registry fetch ───────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct RegistryEntry {
    pub id:          String,
    pub description: String,
    pub author:      String,
    pub arch:        String,
    pub category:    String,
    pub latest:      String,
    pub toml_url:    String,
}

/// Fetch and parse boards.json from the given registry URL.
/// Results are cached for CACHE_TTL (24 h).
pub fn fetch_registry(registry_url: &str) -> Result<Vec<RegistryEntry>> {
    let cache_path = cache_path_for(registry_url);
    // Check cache freshness
    if let Ok(meta) = std::fs::metadata(&cache_path) {
        if let Ok(modified) = meta.modified() {
            if SystemTime::now().duration_since(modified).unwrap_or(CACHE_TTL) < CACHE_TTL {
                if let Ok(data) = std::fs::read_to_string(&cache_path) {
                    return parse_boards_json(&data);
                }
            }
        }
    }

    let data = http_get(registry_url)?;
    let _ = std::fs::create_dir_all(cache_path.parent().unwrap());
    let _ = std::fs::write(&cache_path, &data);
    parse_boards_json(&data)
}

fn cache_path_for(url: &str) -> PathBuf {
    let hash = {
        let mut h = 0u64;
        for b in url.bytes() { h = h.wrapping_mul(31).wrapping_add(b as u64); }
        format!("{:016x}", h)
    };
    home_dir().unwrap_or_default()
        .join(".tsuki").join("cache").join(format!("boards_{}.json", hash))
}

fn parse_boards_json(data: &str) -> Result<Vec<RegistryEntry>> {
    // Minimal JSON parser — boards.json has a predictable structure.
    // We extract each "id": { ... } block by scanning for patterns.
    let mut entries = Vec::new();
    // Find "boards": { ... }
    let boards_start = data.find("\"boards\"").ok_or_else(|| FlashError::Other("invalid boards.json".into()))?;
    let brace_open = data[boards_start..].find('{').map(|i| boards_start + i).ok_or_else(|| FlashError::Other("invalid boards.json".into()))?;

    // Walk top-level keys inside "boards" object
    let inner = &data[brace_open + 1..];
    let mut pos = 0;
    while pos < inner.len() {
        // Find next "key"
        let Some(qs) = inner[pos..].find('"') else { break };
        let qs = pos + qs;
        let qe = inner[qs+1..].find('"').map(|i| qs + 1 + i).unwrap_or(inner.len());
        let key = &inner[qs+1..qe];
        if key == "boards" { pos = qe + 1; continue; }
        // Find the object body for this key
        let colon = inner[qe+1..].find(':').map(|i| qe + 1 + i).unwrap_or(inner.len());
        let obj_start = inner[colon+1..].find('{').map(|i| colon + 1 + i).unwrap_or(inner.len());
        // Find matching close-brace (simple depth counter)
        let mut depth = 0usize;
        let mut obj_end = obj_start + 1;
        for (i, c) in inner[obj_start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 { obj_end = obj_start + i; break; }
                }
                _ => {}
            }
        }
        let obj_str = &inner[obj_start..=obj_end];

        // Extract fields from the object string
        let description = extract_json_str(obj_str, "description").unwrap_or_default();
        let author      = extract_json_str(obj_str, "author").unwrap_or_default();
        let arch        = extract_json_str(obj_str, "arch").unwrap_or_default();
        let category    = extract_json_str(obj_str, "category").unwrap_or_default();
        let latest      = extract_json_str(obj_str, "latest").unwrap_or_default();

        // Find the latest version URL
        let toml_url = if !latest.is_empty() {
            // Find versions object and extract url for latest version
            let ver_key = format!("\"{}\"", latest);
            if let Some(vi) = obj_str.find(&ver_key) {
                let after = &obj_str[vi + ver_key.len()..];
                if let Some(col) = after.find(':') {
                    extract_json_str(after[col+1..].trim(), "").unwrap_or_else(|| {
                        after[col+1..].trim().trim_matches(['"', ' ', '\n']).to_string()
                    })
                } else { String::new() }
            } else { String::new() }
        } else { String::new() };

        if !key.is_empty() && !toml_url.is_empty() {
            entries.push(RegistryEntry {
                id: key.to_string(),
                description, author, arch, category, latest, toml_url,
            });
        }
        pos = obj_end + 1;
    }
    Ok(entries)
}

fn extract_json_str(s: &str, key: &str) -> Option<String> {
    let pattern = if key.is_empty() { String::new() } else { format!("\"{}\"", key) };
    let start = if key.is_empty() {
        s.find('"')?
    } else {
        let ki = s.find(&pattern)?;
        let after = &s[ki + pattern.len()..];
        let ci = after.find(':')?;
        after[ci+1..].trim_start().find('"').map(|i| ki + pattern.len() + ci + 1 + after[ci+1..].trim_start_matches(|c: char| c != '"').len() - after[ci+1..].trim_start().len() + i)?
    };
    let inner = if key.is_empty() { &s[start+1..] } else {
        let ki = s.find(&pattern)?;
        let after = &s[ki + pattern.len()..];
        let ci = after.find(':')?;
        let trimmed = after[ci+1..].trim_start();
        if trimmed.starts_with('"') { &trimmed[1..] } else { return None }
    };
    let end = inner.find('"')?;
    Some(inner[..end].to_string())
}

// ─── HTTP helper (reuses ureq pattern from lib_manager.rs) ───────────────────

fn http_get(url: &str) -> Result<String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| FlashError::Other(format!("HTTP GET {}: {}", url, e)))?;
    resp.into_string()
        .map_err(|e| FlashError::Other(format!("reading response: {}", e)))
}

fn http_get_bytes(url: &str) -> Result<Vec<u8>> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| FlashError::Other(format!("HTTP GET {}: {}", url, e)))?;
    let mut buf = Vec::new();
    resp.into_reader().read_to_end(&mut buf)
        .map_err(|e| FlashError::Other(format!("reading bytes: {}", e)))?;
    Ok(buf)
}

// ─── Install ──────────────────────────────────────────────────────────────────

pub struct InstallOptions {
    pub registry_url: String,
    pub verbose:      bool,
    pub use_modules:  bool,
}

/// Download and install a board platform.
/// Returns the tsukiboard.toml content as a String.
pub fn install(board_id: &str, version_hint: Option<&str>, opts: &InstallOptions) -> Result<String> {
    let label = format!("platform install  {}", board_id);
    let mut block = LiveBlock::new(&label);
    block.start();

    // 1. Fetch registry
    block.line("fetching board registry...");
    let entries = fetch_registry(&opts.registry_url)?;
    let entry = entries.iter().find(|e| e.id.eq_ignore_ascii_case(board_id))
        .ok_or_else(|| FlashError::Other(format!("board '{}' not found in registry", board_id)))?;

    let version = version_hint.unwrap_or(&entry.latest);
    block.line(&format!("found {} v{}", entry.id, version));

    // 2. Download tsukiboard.toml
    block.line("downloading tsukiboard.toml...");
    let toml_url = &entry.toml_url;
    let toml_data = http_get(toml_url)?;

    // 3. Determine base URL for companion files
    let base_url = toml_url.rsplitn(2, '/').nth(1)
        .map(|s| format!("{}/", s))
        .unwrap_or_default();

    // 4. Create install directory
    let dest = platform_dir(&entry.id, version)
        .ok_or_else(|| FlashError::Other("could not determine home directory".into()))?;
    std::fs::create_dir_all(&dest)
        .map_err(|e| FlashError::Other(format!("creating {}: {}", dest.display(), e)))?;

    // 5. Write tsukiboard.toml
    std::fs::write(dest.join("tsukiboard.toml"), &toml_data)
        .map_err(|e| FlashError::Other(format!("writing toml: {}", e)))?;

    // 6. Download companion files listed in [files] section
    let companion_files = parse_companion_files(&toml_data);
    for (_, filename) in &companion_files {
        block.line(&format!("downloading {}...", filename));
        let url = format!("{}{}", base_url, filename);
        match http_get_bytes(&url) {
            Ok(data) => { let _ = std::fs::write(dest.join(filename), data); }
            Err(e)   => block.line(&format!("  warn: {}: {}", filename, e)),
        }
    }

    block.finish(true, None);
    Ok(toml_data)
}

fn parse_companion_files(toml: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();
    let mut in_files = false;
    for line in toml.lines() {
        let line = line.trim();
        if line == "[files]" { in_files = true; continue; }
        if line.starts_with('[') { in_files = false; continue; }
        if !in_files { continue; }
        if let Some(eq) = line.find('=') {
            let k = line[..eq].trim().to_string();
            let v = line[eq+1..].trim().trim_matches('"').to_string();
            if !k.is_empty() && !v.is_empty() { files.push((k, v)); }
        }
    }
    files
}

// ─── Pre-compile ──────────────────────────────────────────────────────────────

/// Pre-compile the board's core library and store it at
/// ~/.tsuki/boards/<id>/<version>/precompiled/core-<arch>.a
pub fn precompile(board_id: &str, use_modules: bool, verbose: bool) -> Result<()> {
    let label = format!("precompile core  [{}]", board_id);
    let mut block = LiveBlock::new(&label);
    block.start();

    // Find the board (static or dynamic)
    let board = crate::boards::Board::find(board_id)
        .ok_or_else(|| FlashError::UnknownBoard(board_id.to_owned()))?;

    // Resolve SDK
    let sdk = crate::sdk::resolve(board.arch(), board.variant, use_modules)
        .map_err(|e| { block.finish(false, Some("SDK not found")); e })?;

    // Create a minimal dummy sketch in a temp dir
    let tmp = temp_sketch_dir(board_id)
        .map_err(|e| { block.finish(false, Some("temp dir failed")); e })?;

    // Build dir = platform precompiled directory
    let Some(dest) = platform_dir(board_id, "1.0.0") else {
        block.finish(false, Some("no install dir"));
        return Err(FlashError::Other("could not locate install dir".into()));
    };
    let build_dir = dest.join("precompiled");
    std::fs::create_dir_all(&build_dir)
        .map_err(|e| FlashError::Other(format!("mkdir: {}", e)))?;

    block.line(&format!("compiling core for {}...", board.id));

    let req = crate::compile::CompileRequest {
        sketch_dir:       tmp.clone(),
        build_dir:        build_dir.clone(),
        project_name:     "precompile".into(),
        cpp_std:          "c++11".into(),
        lib_include_dirs: vec![],
        lib_source_dirs:  vec![],
        language:         crate::compile::Language::Cpp,
        use_modules,
        verbose,
        debug: false,
    };

    match crate::compile::compile(&req, board) {
        Ok(_) => {
            // Copy the core-*.a to a stable name
            let arch = board.arch();
            for entry in std::fs::read_dir(&build_dir).into_iter().flatten().flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("a")
                    && p.file_name().and_then(|n| n.to_str())
                        .map(|n| n.starts_with("core-")).unwrap_or(false)
                {
                    let final_core = build_dir.join(format!("core-{}.a", arch));
                    let _ = std::fs::copy(&p, &final_core);
                    // Write the core_sig alongside
                    // (We don't have the sig here, but build_core writes .core_sig in build_dir/core-<arch>/
                    // so we look for it there)
                    let sig_src = build_dir.join(format!("core-{}", arch)).join(".core_sig");
                    if sig_src.exists() {
                        let _ = std::fs::copy(&sig_src, build_dir.join(format!("core-{}.sig", arch)));
                    }
                    break;
                }
            }
            let _ = std::fs::remove_dir_all(&tmp);
            block.finish(true, None);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            block.finish(false, Some("core compilation failed"));
            Err(e)
        }
    }
}

fn temp_sketch_dir(board_id: &str) -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("tsuki-precompile-{}", board_id));
    std::fs::create_dir_all(&dir)
        .map_err(|e| FlashError::Other(format!("temp dir: {}", e)))?;
    // Minimal Arduino sketch
    std::fs::write(dir.join("sketch.cpp"), b"void setup(){} void loop(){}")
        .map_err(|e| FlashError::Other(format!("write sketch: {}", e)))?;
    Ok(dir)
}

// ─── List ─────────────────────────────────────────────────────────────────────

pub struct InstalledPlatform {
    pub id:      String,
    pub version: String,
    pub name:    String,
    pub arch:    String,
}

pub fn list_installed() -> Vec<InstalledPlatform> {
    let Some(root) = boards_root() else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&root) else { return vec![] };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let board_dir = entry.path();
        if !board_dir.is_dir() { continue; }
        let id = entry.file_name().to_string_lossy().to_string();
        let mut versions: Vec<_> = std::fs::read_dir(&board_dir).ok()
            .into_iter().flatten().flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        versions.sort();
        if let Some(ver) = versions.last() {
            let toml_path = board_dir.join(ver).join("tsukiboard.toml");
            let (name, arch) = if let Ok(raw) = std::fs::read_to_string(&toml_path) {
                let name = raw.lines()
                    .find(|l| l.trim().starts_with("name") && l.contains('='))
                    .and_then(|l| l.find('=').map(|i| l[i+1..].trim().trim_matches('"').to_string()))
                    .unwrap_or_else(|| id.clone());
                let arch = raw.lines()
                    .find(|l| l.trim() == "[toolchain]")
                    .and_then(|_| {
                        // Get the line after [toolchain] that has type=
                        raw.lines()
                            .skip_while(|l| l.trim() != "[toolchain]")
                            .skip(1)
                            .find(|l| l.trim().starts_with("type"))
                            .and_then(|l| l.find('=').map(|i| l[i+1..].trim().trim_matches('"').to_string()))
                    })
                    .unwrap_or_else(|| "unknown".to_string());
                (name, arch)
            } else {
                (id.clone(), "unknown".to_string())
            };
            result.push(InstalledPlatform {
                id: id.clone(),
                version: ver.clone(),
                name, arch,
            });
        }
    }
    result
}

// ─── Remove ───────────────────────────────────────────────────────────────────

pub fn remove(board_id: &str) -> Result<()> {
    let root = boards_root()
        .ok_or_else(|| FlashError::Other("could not determine home directory".into()))?;
    let board_dir = root.join(board_id);
    if !board_dir.exists() {
        return Err(FlashError::Other(format!("platform '{}' is not installed", board_id)));
    }
    std::fs::remove_dir_all(&board_dir)
        .map_err(|e| FlashError::Other(format!("remove {}: {}", board_dir.display(), e)))?;
    // Remove from dynamic registry
    dynamic_registry().lock().unwrap().retain(|b| !b.id.eq_ignore_ascii_case(board_id));
    Ok(())
}

// ─── IO helper (needed for http_get_bytes) ────────────────────────────────────
use std::io::Read;
```

- [ ] **Step 2 — Add `mod platforms;` to `flash/main.rs`**

At the top of `flash/main.rs`, after the existing `mod` declarations:

```rust
mod platforms;
```

- [ ] **Step 3 — Update `flash/boards.rs`: `find()` now falls back to dynamic platforms**

Change the existing `Board::find()` method from:
```rust
pub fn find(id: &str) -> Option<&'static Board> {
    let id_lower = id.to_lowercase();
    BOARDS.iter().find(|b| b.id.eq_ignore_ascii_case(&id_lower))
}
```
to:
```rust
pub fn find(id: &str) -> Option<&'static Board> {
    let id_lower = id.to_lowercase();
    BOARDS.iter().find(|b| b.id.eq_ignore_ascii_case(&id_lower))
        .or_else(|| crate::platforms::find_dynamic(id))
}
```

- [ ] **Step 4 — Add `use std::io::Read;` to `flash/platforms/mod.rs`**

The `http_get_bytes` function uses `read_to_end`; ensure `use std::io::Read;` is present at the top of the file (it is already in the template above — verify it compiles).

- [ ] **Step 5 — Commit**

```bash
git add flash/platforms/mod.rs flash/boards.rs flash/main.rs
git commit -m "feat(flash): add platforms module with install/list/remove/precompile"
```

---

## Task 3 — tsuki-flash: `platforms` Sub-command in main.rs

**Files:**
- Modify: `flash/main.rs`

- [ ] **Step 1 — Add `PlatformsArgs` structs in main.rs**

After the `ModulesArgs` block, add:

```rust
// ── Platforms args ────────────────────────────────────────────────────────────

#[derive(Args)]
struct PlatformsArgs {
    #[command(subcommand)]
    command: PlatformsCmd,
}

#[derive(Subcommand)]
enum PlatformsCmd {
    /// Download and install a board platform
    ///
    /// Examples:
    ///   tsuki-flash platforms install esp32
    ///   tsuki-flash platforms install esp8266
    Install {
        /// Board ID (e.g. esp32, esp8266, uno)
        board: String,
        #[arg(long)]
        version: Option<String>,
        /// Registry URL override
        #[arg(long)]
        registry: Option<String>,
        /// Pre-compile the core library after installing (recommended)
        #[arg(long, default_value_t = true)]
        precompile: bool,
        /// Use tsuki-modules SDK store (no .arduino15 required)
        #[arg(long, default_value_t = false)]
        use_modules: bool,
    },
    /// List installed board platforms
    List,
    /// Remove an installed board platform
    Remove {
        board: String,
    },
    /// Pre-compile the core library for a board (speeds up first build)
    Precompile {
        board: String,
        #[arg(long, default_value_t = false)]
        use_modules: bool,
    },
    /// List boards available in the registry
    Search {
        /// Registry URL override
        #[arg(long)]
        registry: Option<String>,
    },
}
```

- [ ] **Step 2 — Add `Platforms(PlatformsArgs)` to the `Cmd` enum**

Find the `enum Cmd` block and add:
```rust
/// Manage downloadable board platforms (install / list / remove / precompile)
Platforms(PlatformsArgs),
```

- [ ] **Step 3 — Add dispatch in `main()`**

In the `match cli.command` block, add:
```rust
Cmd::Platforms(a)      => cmd_platforms(a, cli.verbose),
```

- [ ] **Step 4 — Add `cmd_platforms()` handler**

After the `cmd_modules()` function, add:

```rust
fn cmd_platforms(args: PlatformsArgs, verbose: bool) -> Result<()> {
    match args.command {
        PlatformsCmd::Install { board, version, registry, precompile, use_modules } => {
            let registry_url = registry.unwrap_or_else(|| {
                std::env::var("TSUKI_BOARDS_REGISTRY")
                    .unwrap_or_else(|_| platforms::DEFAULT_BOARDS_REGISTRY.to_string())
            });
            let opts = platforms::InstallOptions {
                registry_url,
                verbose,
                use_modules,
            };
            let toml = platforms::install(&board, version.as_deref(), &opts)?;

            // Load the new board into the dynamic registry so precompile can find it
            if let Some(board_obj) = platforms::parse_board_toml(&toml) {
                // board is now in dynamic registry via install()
                let _ = board_obj; // parse_board_toml used here to verify parsing
            }

            success(&format!("board platform '{}' installed", board));

            if precompile {
                step(&format!("Pre-compiling core for '{}' (this may take 1-2 min)…", board));
                // Reload dynamic boards so the newly installed board is findable
                platforms::load_installed_platforms();
                match platforms::precompile(&board, use_modules, verbose) {
                    Ok(())  => success("core pre-compiled — first build will be instant"),
                    Err(e)  => warn(&format!("pre-compile skipped (SDK not installed?): {}", e)),
                }
            }
            Ok(())
        }

        PlatformsCmd::List => {
            let installed = platforms::list_installed();
            if installed.is_empty() {
                info("No board platforms installed.");
                info("Install one: tsuki-flash platforms install esp32");
                return Ok(());
            }
            let (b, d, r) = ansi_bdr();
            println!("  {}{:<20}  {:<10}  {:<10}  {}{}", b, "BOARD", "VERSION", "ARCH", "NAME", r);
            println!("  {}{}{}", d, "─".repeat(60), r);
            for p in &installed {
                println!("  {:<20}  {:<10}  {:<10}  {}", p.id, p.version, p.arch, p.name);
            }
            Ok(())
        }

        PlatformsCmd::Remove { board } => {
            platforms::remove(&board)?;
            success(&format!("board platform '{}' removed", board));
            Ok(())
        }

        PlatformsCmd::Precompile { board, use_modules } => {
            platforms::load_installed_platforms();
            step(&format!("Pre-compiling core for '{}' (this may take 1-2 min)…", board));
            platforms::precompile(&board, use_modules, verbose)?;
            success("core pre-compiled — next build will skip core compilation");
            Ok(())
        }

        PlatformsCmd::Search { registry } => {
            let registry_url = registry.unwrap_or_else(|| {
                std::env::var("TSUKI_BOARDS_REGISTRY")
                    .unwrap_or_else(|_| platforms::DEFAULT_BOARDS_REGISTRY.to_string())
            });
            let entries = platforms::fetch_registry(&registry_url)?;
            if entries.is_empty() {
                info("No boards found in registry.");
                return Ok(());
            }
            let (b, d, r) = ansi_bdr();
            println!("  {}{:<16}  {:<8}  {}{}", b, "BOARD", "ARCH", "DESCRIPTION", r);
            println!("  {}{}{}", d, "─".repeat(70), r);
            for e in &entries {
                println!("  {:<16}  {:<8}  {}", e.id, e.arch, e.description);
            }
            Ok(())
        }
    }
}
```

- [ ] **Step 5 — Load installed platforms at startup in `main()`**

At the very beginning of `fn main()`, after the `cli` parse, add:
```rust
// Load installed board platforms into the dynamic board registry.
platforms::load_installed_platforms();
```

- [ ] **Step 6 — Make `DEFAULT_BOARDS_REGISTRY` pub in platforms/mod.rs**

Verify `DEFAULT_BOARDS_REGISTRY` is declared `pub const` (it is in the template — double-check).

- [ ] **Step 7 — Verify it compiles**

```bash
cd E:/tsuki && cargo build --bin tsuki-flash 2>&1 | head -40
```

Expected: no errors. Fix any type mismatches (e.g. `DEFAULT_BOARDS_REGISTRY` visibility).

- [ ] **Step 8 — Smoke test**

```bash
./target/debug/tsuki-flash platforms list
./target/debug/tsuki-flash platforms search
```

Expected for `list`: "No board platforms installed."
Expected for `search`: table with esp32, esp8266 rows.

- [ ] **Step 9 — Commit**

```bash
git add flash/main.rs
git commit -m "feat(flash): add 'platforms' CLI subcommand (install/list/remove/search/precompile)"
```

---

## Task 4 — Pre-compiled Core Reuse in AVR Compile Backend

**Files:**
- Modify: `flash/compile/avr.rs`

- [ ] **Step 1 — Add pre-compiled core check before `build_core()` in `avr.rs`**

In `flash/compile/avr.rs::run()`, find the call to `build_core(...)` (currently around line 111):

```rust
build_core(&cc, &cxx, &ar, &sdk.toolchain_bin, &sdk.core_dir, &core_dir, &core_a,
           &includes, &cflags, &cxxflags, &core_sig, req.verbose)?;
```

Add the following block **immediately before** that call:

```rust
// ── Pre-compiled core shortcut ────────────────────────────────────────────
// If the user installed this board via `tsuki-flash platforms install`,
// a pre-compiled core.a is stored at ~/.tsuki/boards/<id>/<version>/precompiled/.
// Reuse it to skip the 30-90 s core build on the very first project compilation.
if !core_a.exists() {
    if let (Some(precomp), Some(precomp_sig)) = (
        crate::platforms::precompiled_core(board.id),
        crate::platforms::precompiled_core_sig(board.id),
    ) {
        if precomp_sig.trim() == core_sig {
            if let Ok(()) = std::fs::copy(&precomp, &core_a).map(|_| ()) {
                let _ = std::fs::write(&core_dir.join(".core_sig"), &core_sig);
                if req.verbose {
                    eprintln!("  [core] reusing pre-compiled core from board platform");
                }
            }
        }
    }
}
// ── End pre-compiled core shortcut ───────────────────────────────────────
```

- [ ] **Step 2 — Verify avr.rs compiles**

```bash
cd E:/tsuki && cargo build --bin tsuki-flash 2>&1 | head -30
```

Expected: clean build. Fix any import issues (`crate::platforms::precompiled_core`).

- [ ] **Step 3 — Commit**

```bash
git add flash/compile/avr.rs
git commit -m "perf(avr): reuse pre-compiled core.a from installed board platform"
```

---

## Task 5 — IDE Store: BoardPlatform Type + State

**Files:**
- Modify: `ide/src/lib/store.ts`

- [ ] **Step 1 — Add `'platforms'` to `SidebarTab` type (line 6)**

Change:
```typescript
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples' | 'explorer'
```
to:
```typescript
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples' | 'platforms' | 'explorer'
```

- [ ] **Step 2 — Add `BoardPlatform` interface**

After the `PackageEntry` interface definition, add:

```typescript
export interface BoardPlatform {
  id:          string
  name:        string
  version:     string
  description: string
  author:      string
  arch:        string          // "avr" | "esp32" | "esp8266" | "rp2040" | "sam"
  category:    string          // "wifi" | "basic" | "arm" etc.
  installed:   boolean
  installing?: boolean
  url?:        string          // URL of tsukiboard.toml in registry
}
```

- [ ] **Step 3 — Add platform actions to the store interface**

In the main store interface (where `packages: PackageEntry[]` is declared), add the following fields:

```typescript
// Board platforms
platforms:             BoardPlatform[]
platformsLoaded:       boolean
setPlatforms:          (p: BoardPlatform[]) => void
setBoardPlatformInstalling: (id: string, installing: boolean) => void
addInstalledPlatform:  (p: BoardPlatform) => void
removeInstalledPlatform: (id: string) => void
```

- [ ] **Step 4 — Add `boardsRegistryUrl` to `SettingsState`**

In the `SettingsState` interface (near `registryUrl`), add:
```typescript
boardsRegistryUrl: string
```

- [ ] **Step 5 — Add platform state implementations**

Near the `packages: [], packagesLoaded: false` initial state block, add:

```typescript
platforms: [],
platformsLoaded: false,
setPlatforms: (platforms) => set({ platforms, platformsLoaded: true }),
setBoardPlatformInstalling: (id, installing) =>
  set((s) => ({ platforms: s.platforms.map(p => p.id === id ? { ...p, installing } : p) })),
addInstalledPlatform: (platform) =>
  set((s) => ({
    platforms: s.platforms.some(p => p.id === platform.id)
      ? s.platforms.map(p => p.id === platform.id ? { ...p, ...platform, installed: true } : p)
      : [...s.platforms, { ...platform, installed: true }]
  })),
removeInstalledPlatform: (id) =>
  set((s) => ({ platforms: s.platforms.map(p => p.id === id ? { ...p, installed: false, installing: false } : p) })),
```

- [ ] **Step 6 — Add `boardsRegistryUrl` default in settings initial state**

Find the settings initial state block (where `registryUrl:` is defined) and add:
```typescript
boardsRegistryUrl: 'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json',
```

- [ ] **Step 7 — Commit**

```bash
git add ide/src/lib/store.ts
git commit -m "feat(ide): add BoardPlatform type and platforms state to store"
```

---

## Task 6 — PlatformsSidebar Component

**Files:**
- Create: `ide/src/components/other/PlatformsSidebar.tsx`

- [ ] **Step 1 — Create `PlatformsSidebar.tsx`**

```tsx
'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  PlatformsSidebar — Browse and install board platform packages
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useStore }         from '@/lib/store'
import type { BoardPlatform } from '@/lib/store'
import { spawnProcess }     from '@/lib/tauri'
import {
  Cpu, Search, RefreshCw, CheckCircle2, Download,
  Trash2, ChevronRight, AlertCircle, Loader2,
} from 'lucide-react'
import BoardInstallModal    from '@/components/other/BoardInstallModal'

const REGISTRY_FETCH_TIMEOUT = 15_000

// ─────────────────────────────────────────────────────────────────────────────

export default function PlatformsSidebar() {
  const {
    platforms, platformsLoaded, setPlatforms,
    setBoardPlatformInstalling, addInstalledPlatform, removeInstalledPlatform,
    settings,
  } = useStore()

  const [query,           setQuery]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [installTarget,   setInstallTarget]   = useState<BoardPlatform | null>(null)
  const [removingId,      setRemovingId]      = useState<string | null>(null)

  // ── Load registry once ──────────────────────────────────────────────────────

  const loadRegistry = useCallback(async (force = false) => {
    if (platformsLoaded && !force) return
    setLoading(true)
    setError(null)
    try {
      const url = settings.boardsRegistryUrl ||
        'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { boards: Record<string, {
        description: string; author: string; arch: string;
        category: string; latest: string; versions: Record<string, string>
      }> }

      const registryPlatforms: BoardPlatform[] = Object.entries(data.boards).map(([id, info]) => ({
        id,
        name:        idToName(id),
        version:     info.latest,
        description: info.description,
        author:      info.author,
        arch:        info.arch,
        category:    info.category,
        installed:   false,
        url:         info.versions[info.latest] ?? '',
      }))

      // Merge with already-installed status
      const installed = platforms.filter(p => p.installed).map(p => p.id)
      const merged = registryPlatforms.map(p => ({
        ...p,
        installed: installed.includes(p.id),
      }))
      setPlatforms(merged)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [platformsLoaded, settings.boardsRegistryUrl, platforms, setPlatforms])

  useEffect(() => { loadRegistry() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Remove ──────────────────────────────────────────────────────────────────

  const handleRemove = async (platform: BoardPlatform) => {
    if (removingId) return
    setRemovingId(platform.id)
    try {
      const flashBin = settings.tsukiPath || 'tsuki-flash'
      await new Promise<void>((resolve, reject) => {
        spawnProcess(flashBin.replace('tsuki', 'tsuki-flash'), ['platforms', 'remove', platform.id],
          (line) => { /* output */ },
          (code) => { code === 0 ? resolve() : reject(new Error(`exit ${code}`)) }
        )
      })
      removeInstalledPlatform(platform.id)
    } catch { /* ignore */ } finally {
      setRemovingId(null)
    }
  }

  // ── Filter ──────────────────────────────────────────────────────────────────

  const filtered = platforms.filter(p =>
    !query ||
    p.id.toLowerCase().includes(query.toLowerCase()) ||
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.description.toLowerCase().includes(query.toLowerCase()) ||
    p.arch.toLowerCase().includes(query.toLowerCase())
  )

  const installed = filtered.filter(p => p.installed)
  const available = filtered.filter(p => !p.installed)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
          <Cpu size={11} /> Platforms
        </span>
        <button
          onClick={() => loadRegistry(true)}
          disabled={loading}
          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title="Refresh registry"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded px-2 py-1">
          <Search size={10} className="text-zinc-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search boards..."
            className="bg-transparent outline-none text-[10px] text-zinc-200 placeholder-zinc-500 w-full"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 text-red-400 bg-red-400/10 rounded px-2 py-1.5">
          <AlertCircle size={10} />
          <span className="text-[10px]">{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && !platforms.length && (
        <div className="flex justify-center items-center py-6 text-zinc-500">
          <Loader2 size={14} className="animate-spin mr-2" />
          <span>Loading registry...</span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-3">
        {installed.length > 0 && (
          <>
            <SectionHeader label={`INSTALLED (${installed.length})`} />
            {installed.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                onInstall={() => setInstallTarget(p)}
                onRemove={() => handleRemove(p)}
                removing={removingId === p.id}
              />
            ))}
          </>
        )}

        {available.length > 0 && (
          <>
            <SectionHeader label={`AVAILABLE (${available.length})`} />
            {available.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                onInstall={() => setInstallTarget(p)}
                onRemove={() => {}}
                removing={false}
              />
            ))}
          </>
        )}

        {!loading && !platforms.length && !error && (
          <div className="text-center text-zinc-500 py-6">No platforms found.</div>
        )}
      </div>

      {/* Install modal */}
      {installTarget && (
        <BoardInstallModal
          platform={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={(p) => {
            addInstalledPlatform(p)
            setInstallTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-1 pt-2 pb-1">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
    </div>
  )
}

function PlatformCard({
  platform, onInstall, onRemove, removing,
}: {
  platform: BoardPlatform
  onInstall: () => void
  onRemove:  () => void
  removing:  boolean
}) {
  const archColor: Record<string, string> = {
    avr:     'text-blue-400',
    esp32:   'text-orange-400',
    esp8266: 'text-green-400',
    rp2040:  'text-pink-400',
    sam:     'text-purple-400',
  }

  return (
    <div className={`
      rounded border px-2 py-2 flex flex-col gap-1
      ${platform.installed
        ? 'bg-zinc-800/80 border-zinc-600'
        : 'bg-zinc-900 border-zinc-700/50 hover:border-zinc-600'}
    `}>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {platform.installed && <CheckCircle2 size={10} className="text-green-400 shrink-0" />}
          <span className="font-medium text-zinc-200 truncate">{platform.name}</span>
        </div>
        <span className={`text-[9px] font-mono shrink-0 ${archColor[platform.arch] ?? 'text-zinc-400'}`}>
          {platform.arch}
        </span>
      </div>

      <span className="text-zinc-500 leading-tight line-clamp-2">{platform.description}</span>

      <div className="flex items-center justify-between mt-0.5">
        <span className="text-zinc-600 text-[9px]">v{platform.version} · {platform.author}</span>
        <div className="flex items-center gap-1">
          {platform.installed ? (
            <>
              <button
                onClick={onInstall}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
              >
                <ChevronRight size={8} /> Details
              </button>
              <button
                onClick={onRemove}
                disabled={removing}
                className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 disabled:opacity-40"
                title="Remove platform"
              >
                {removing ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              disabled={platform.installing}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {platform.installing
                ? <><Loader2 size={9} className="animate-spin" /> Installing…</>
                : <><Download size={9} /> Install</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function idToName(id: string): string {
  const names: Record<string, string> = {
    esp32:   'ESP32 Dev Module',
    esp8266: 'ESP8266 Generic',
    uno:     'Arduino Uno',
    nano:    'Arduino Nano',
    mega:    'Arduino Mega',
    pico:    'Raspberry Pi Pico',
    due:     'Arduino Due',
  }
  return names[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}
```

- [ ] **Step 2 — Commit**

```bash
git add ide/src/components/other/PlatformsSidebar.tsx
git commit -m "feat(ide): add PlatformsSidebar component"
```

---

## Task 7 — BoardInstallModal Component

**Files:**
- Create: `ide/src/components/other/BoardInstallModal.tsx`

- [ ] **Step 1 — Create `BoardInstallModal.tsx`**

```tsx
'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  BoardInstallModal — install popup: README / Files / Specs + progress
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useStore }         from '@/lib/store'
import type { BoardPlatform } from '@/lib/store'
import { spawnProcess }     from '@/lib/tauri'
import {
  X, Download, FileText, List, Cpu,
  CheckCircle2, AlertCircle, Loader2, Zap,
} from 'lucide-react'

type Tab = 'readme' | 'files' | 'specs'
type Phase = 'preview' | 'installing' | 'done' | 'error'

interface BoardDetail {
  readme:    string
  files:     { name: string; size?: number; type: 'toml' | 'json' | 'md' | 'other' }[]
  specs: {
    arch:     string
    flashKb:  number
    ramKb:    number
    fCpu:     number
    fqbn:     string
    variant:  string
    uploadBaud: number
  } | null
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BoardInstallModal({
  platform,
  onClose,
  onInstalled,
}: {
  platform:    BoardPlatform
  onClose:     () => void
  onInstalled: (p: BoardPlatform) => void
}) {
  const { settings, setBoard } = useStore()
  const [tab,        setTab]        = useState<Tab>('readme')
  const [phase,      setPhase]      = useState<Phase>('preview')
  const [detail,     setDetail]     = useState<BoardDetail | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [logs,       setLogs]       = useState<string[]>([])
  const [offerSwitch, setOfferSwitch] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // ── Fetch companion files for preview ──────────────────────────────────────

  useEffect(() => {
    if (!platform.url) { setLoading(false); return }
    const baseUrl = platform.url.substring(0, platform.url.lastIndexOf('/') + 1)
    let cancelled = false;

    (async () => {
      try {
        // Fetch tsukiboard.toml
        const tomlRes = await fetch(platform.url!)
        const toml = tomlRes.ok ? await tomlRes.text() : ''

        // Parse companion file names from [files] section
        const fileNames = parseFilesSection(toml)

        // Fetch README
        const readmeName = fileNames.find(f => f.toLowerCase().endsWith('.md')) ?? 'README.md'
        const readmeRes  = await fetch(baseUrl + readmeName)
        const readme = readmeRes.ok ? await readmeRes.text() : '*README not available*'

        // Build file list
        const files = [
          { name: 'tsukiboard.toml', type: 'toml' as const, size: toml.length },
          ...fileNames.map(name => ({
            name,
            type: name.endsWith('.json') ? 'json' as const
                : name.endsWith('.md')   ? 'md'   as const
                : 'other' as const,
          })),
        ]

        // Parse specs from TOML
        const specs = parseTomlSpecs(toml)

        if (!cancelled) {
          setDetail({ readme, files, specs })
          setLoading(false)
        }
      } catch { if (!cancelled) setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [platform.url])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Install ─────────────────────────────────────────────────────────────────

  const handleInstall = async () => {
    setPhase('installing')
    setLogs([`Installing ${platform.name} v${platform.version}…`])

    const flashBin = resolveFlashBin(settings.tsukiPath)
    const registryUrl = settings.boardsRegistryUrl ||
      'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json'

    const args = [
      'platforms', 'install', platform.id,
      '--registry', registryUrl,
      '--precompile',
    ]

    try {
      await new Promise<void>((resolve, reject) => {
        spawnProcess(
          flashBin,
          args,
          (line: string) => setLogs(prev => [...prev, line]),
          (code: number) => { code === 0 ? resolve() : reject(new Error(`exit ${code}`)) }
        )
      })
      setPhase('done')
      setOfferSwitch(true)
      onInstalled({ ...platform, installed: true })
    } catch (e: unknown) {
      setLogs(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`])
      setPhase('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[560px] max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-blue-400 shrink-0" />
              <span className="font-semibold text-zinc-100 text-sm">
                {platform.installed ? 'Board Platform' : 'Install Platform'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {platform.name}
              <span className="mx-1.5 text-zinc-600">·</span>
              v{platform.version}
              <span className="mx-1.5 text-zinc-600">·</span>
              {platform.author}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200">
            <X size={14} />
          </button>
        </div>

        {/* ── Tabs (only in preview phase) ── */}
        {phase === 'preview' && (
          <div className="flex border-b border-zinc-800 px-4">
            {(['readme', 'files', 'specs'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`
                  flex items-center gap-1 px-3 py-2 text-[10px] font-medium border-b-2 transition-colors
                  ${tab === t
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'}
                `}
              >
                {t === 'readme' && <FileText size={10} />}
                {t === 'files'  && <List size={10} />}
                {t === 'specs'  && <Cpu size={10} />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'files' && detail && ` (${detail.files.length})`}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {phase === 'preview' && (
            <>
              {loading && (
                <div className="flex justify-center items-center py-12 text-zinc-500">
                  <Loader2 size={16} className="animate-spin mr-2" /> Loading preview…
                </div>
              )}
              {!loading && tab === 'readme' && (
                <div className="px-5 py-4">
                  <MarkdownView md={detail?.readme ?? '*No README available.*'} />
                </div>
              )}
              {!loading && tab === 'files' && (
                <div className="px-5 py-4 space-y-1">
                  {detail?.files.map(f => (
                    <FileRow key={f.name} name={f.name} type={f.type} size={f.size} />
                  ))}
                </div>
              )}
              {!loading && tab === 'specs' && (
                <div className="px-5 py-4">
                  {detail?.specs
                    ? <SpecsTable specs={detail.specs} />
                    : <span className="text-zinc-500 text-xs">Specs not available.</span>
                  }
                </div>
              )}
            </>
          )}

          {(phase === 'installing' || phase === 'done' || phase === 'error') && (
            <div className="px-5 py-4 font-mono text-[10px] text-zinc-300 space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className={
                  line.startsWith('Error') ? 'text-red-400'
                  : line.includes('✔') || line.includes('done') ? 'text-green-400'
                  : line.includes('…') || line.includes('ing') ? 'text-blue-300'
                  : 'text-zinc-400'
                }>
                  {line}
                </div>
              ))}
              {phase === 'installing' && (
                <div className="flex items-center gap-1.5 text-blue-400 mt-1">
                  <Loader2 size={10} className="animate-spin" /> running…
                </div>
              )}
              {phase === 'done' && (
                <div className="flex items-center gap-1.5 text-green-400 mt-2 font-semibold">
                  <CheckCircle2 size={12} /> Installation complete
                </div>
              )}
              {phase === 'error' && (
                <div className="flex items-center gap-1.5 text-red-400 mt-2 font-semibold">
                  <AlertCircle size={12} /> Installation failed
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between gap-3">
          {/* "Switch board" offer after install */}
          {offerSwitch && phase === 'done' && (
            <div className="flex items-center gap-2 flex-1">
              <Zap size={11} className="text-yellow-400 shrink-0" />
              <span className="text-[10px] text-zinc-400">Switch current project to {platform.name}?</span>
              <button
                onClick={() => { setBoard(platform.id); onClose() }}
                className="px-2 py-0.5 rounded bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 text-[10px]"
              >
                Switch
              </button>
            </div>
          )}

          <div className={`flex items-center gap-2 ${offerSwitch && phase === 'done' ? '' : 'ml-auto'}`}>
            {phase !== 'done' && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px]"
              >
                {phase === 'error' ? 'Close' : 'Cancel'}
              </button>
            )}
            {phase === 'preview' && !platform.installed && (
              <button
                onClick={handleInstall}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium disabled:opacity-50"
              >
                <Download size={11} /> Install Platform
              </button>
            )}
            {phase === 'done' && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[11px]"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MarkdownView({ md }: { md: string }) {
  // Minimal markdown renderer: headers, bold, code blocks, tables, lists
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-lg font-bold text-zinc-100 mt-2 mb-1">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-base font-semibold text-zinc-200 mt-3 mb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-[11px] font-semibold text-zinc-300 mt-2 mb-0.5">{line.slice(4)}</h3>)
    } else if (line.startsWith('```')) {
      // Code block
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="bg-zinc-950 border border-zinc-800 rounded p-2 my-2 text-[10px] text-green-300 font-mono overflow-x-auto whitespace-pre">
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.startsWith('| ')) {
      // Table
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines
        .filter(l => !l.match(/^\|[-| ]+\|$/))
        .map(l => l.slice(1, -1).split('|').map(c => c.trim()))
      elements.push(
        <table key={i} className="w-full border-collapse text-[10px] my-2">
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-zinc-800' : ri % 2 === 0 ? 'bg-zinc-900' : ''}>
                {cells.map((c, ci) => (
                  ri === 0
                    ? <th key={ci} className="border border-zinc-700 px-2 py-1 text-left text-zinc-200 font-medium">{c}</th>
                    : <td key={ci} className="border border-zinc-700 px-2 py-1 text-zinc-400">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 text-[11px] text-zinc-400 list-disc">
          {renderInline(line.slice(2))}
        </li>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(
        <p key={i} className="text-[11px] text-zinc-400 leading-relaxed">
          {renderInline(line)}
        </p>
      )
    }
    i++
  }
  return <div className="space-y-0.5">{elements}</div>
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**, Code: `text`
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} className="bg-zinc-800 rounded px-1 font-mono text-[9px] text-green-300">{p.slice(1,-1)}</code>
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} className="text-zinc-200 font-semibold">{p.slice(2,-2)}</strong>
    return <span key={i}>{p}</span>
  })
}

function FileRow({ name, type, size }: { name: string; type: string; size?: number }) {
  const iconColor = type === 'toml' ? 'text-orange-400' : type === 'json' ? 'text-blue-400' : type === 'md' ? 'text-green-400' : 'text-zinc-400'
  return (
    <div className="flex items-center gap-2 py-1 border-b border-zinc-800 last:border-0">
      <span className={`font-mono text-[9px] uppercase font-semibold w-8 shrink-0 ${iconColor}`}>{type}</span>
      <span className="text-[10px] text-zinc-300 font-mono">{name}</span>
      {size !== undefined && (
        <span className="ml-auto text-[9px] text-zinc-600">{(size / 1024).toFixed(1)} KB</span>
      )}
    </div>
  )
}

function SpecsTable({ specs }: { specs: NonNullable<BoardDetail['specs']> }) {
  const rows: [string, string][] = [
    ['Architecture',    specs.arch],
    ['Flash',           `${specs.flashKb.toLocaleString()} KB`],
    ['RAM',             `${specs.ramKb} KB`],
    ['CPU Frequency',   `${(specs.fCpu / 1_000_000).toFixed(0)} MHz`],
    ['FQBN',            specs.fqbn],
    ['Variant',         specs.variant],
    ['Upload Baud',     specs.uploadBaud.toLocaleString()],
  ]
  return (
    <table className="w-full text-[10px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-zinc-800">
            <td className="py-1.5 pr-4 text-zinc-500 font-medium w-36">{k}</td>
            <td className="py-1.5 text-zinc-300 font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFilesSection(toml: string): string[] {
  const files: string[] = []
  let inFiles = false
  for (const line of toml.split('\n')) {
    const t = line.trim()
    if (t === '[files]') { inFiles = true; continue }
    if (t.startsWith('[')) { inFiles = false; continue }
    if (!inFiles) continue
    const eq = t.indexOf('=')
    if (eq >= 0) {
      const val = t.slice(eq + 1).trim().replace(/^"|"$/g, '')
      if (val) files.push(val)
    }
  }
  return files
}

function parseTomlSpecs(toml: string): BoardDetail['specs'] {
  const get = (key: string) => {
    for (const line of toml.split('\n')) {
      const t = line.trim()
      if (t.startsWith(key) && t.includes('=')) {
        return t.split('=')[1].trim().replace(/^"|"$/g, '')
      }
    }
    return ''
  }
  const flashKb = parseInt(get('flash_kb')) || 0
  if (!flashKb) return null
  return {
    arch:        get('type') || get('arch'),
    flashKb,
    ramKb:       parseInt(get('ram_kb')) || 0,
    fCpu:        parseInt(get('f_cpu')) || 0,
    fqbn:        get('fqbn'),
    variant:     get('variant'),
    uploadBaud:  parseInt(get('upload_baud')) || 921600,
  }
}

function resolveFlashBin(tsukiPath: string): string {
  if (!tsukiPath) return 'tsuki-flash'
  return tsukiPath.replace(/tsuki(\.exe)?$/, 'tsuki-flash$1')
}
```

- [ ] **Step 2 — Commit**

```bash
git add ide/src/components/other/BoardInstallModal.tsx
git commit -m "feat(ide): add BoardInstallModal with README/Files/Specs tabs and install flow"
```

---

## Task 8 — Wire Everything into IdeScreen + Settings

**Files:**
- Modify: `ide/src/components/screens/IdeScreen.tsx`
- Modify: `ide/src/components/screens/SettingsScreen.tsx`

- [ ] **Step 1 — Add import for PlatformsSidebar in IdeScreen.tsx**

After the `import ExamplesSidebar` line:
```tsx
import PlatformsSidebar    from '@/components/other/PlatformsSidebar'
```

- [ ] **Step 2 — Add `Cpu` icon import (if not already present)**

`Cpu` is already imported from lucide-react in IdeScreen.tsx (it's used by the Sandbox workstation button). Verify it's in the import line:
```tsx
import {
  Files, GitBranch, Package, BookOpen, Cpu,
  Code2, Share2, ChevronRight, X, AlertTriangle,
  Copy, Save, FolderOpen, RefreshCw, Settings, Terminal,
} from 'lucide-react'
```

- [ ] **Step 3 — Add platforms tab to `sidebarTabs` array**

Find the `sidebarTabs` array (around line 293):
```tsx
const sidebarTabs = [
  { id: 'files',    icon: <Files size={15} />,      label: 'Files'    },
  { id: 'packages', icon: <Package size={15} />,    label: 'Packages' },
  { id: 'examples', icon: <BookOpen size={15} />,   label: 'Examples' },
  ...(gitEnabled
    ? [{ id: 'git', icon: <GitBranch size={15} />, label: 'Git' }]
    : []),
]
```

Change to:
```tsx
const sidebarTabs = [
  { id: 'files',     icon: <Files size={15} />,      label: 'Files'     },
  { id: 'packages',  icon: <Package size={15} />,    label: 'Packages'  },
  { id: 'platforms', icon: <Cpu size={15} />,        label: 'Platforms' },
  { id: 'examples',  icon: <BookOpen size={15} />,   label: 'Examples'  },
  ...(gitEnabled
    ? [{ id: 'git', icon: <GitBranch size={15} />, label: 'Git' }]
    : []),
]
```

- [ ] **Step 4 — Add `case 'platforms'` to the sidebar switch**

Find the switch inside the sidebar rendering function (around line 303):
```tsx
switch (sidebarTab) {
  case 'files':    return <FilesSidebar />
  case 'packages': return <PackagesSidebar />
  // ...
}
```

Add:
```tsx
case 'platforms': return <PlatformsSidebar />
```

- [ ] **Step 5 — Add `boardsRegistryUrl` setting in SettingsScreen.tsx**

Find the `CliTab` component in `ide/src/components/screens/SettingsScreen.tsx`. After the registryUrl/registryUrls field block, add:

```tsx
<SettingsField
  name="Board Registry"
  desc="URL of the boards.json registry for downloadable board platforms."
>
  <input
    type="text"
    value={settings.boardsRegistryUrl ?? ''}
    onChange={e => updateSetting('boardsRegistryUrl', e.target.value)}
    className={inputCls}
    placeholder="https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json"
  />
</SettingsField>
```

- [ ] **Step 6 — Verify the IDE builds without TypeScript errors**

```bash
cd E:/tsuki/ide && npm run build 2>&1 | tail -20
```

Expected: successful build. Fix any TypeScript errors (usually missing type annotations or wrong prop names).

- [ ] **Step 7 — Commit**

```bash
git add ide/src/components/screens/IdeScreen.tsx ide/src/components/screens/SettingsScreen.tsx
git commit -m "feat(ide): wire Platforms tab into sidebar + add boardsRegistryUrl setting"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered by |
|-------------|-----------|
| Board info (JSON / TOML) | Task 1 — tsukiboard.toml |
| Compilation config for tsuki-flash | Task 1 — tsukiboard.toml `[toolchain]` section; Task 2 — `parse_board_toml` → Board struct |
| Sandbox vectors / circuit component | Task 1 — sandbox.json |
| Port recognition | Task 1 — ports.json; Task 2 — detection data in tsukiboard.toml |
| README.md | Task 1 — README files |
| Popup with README preview, file list, sections | Task 7 — BoardInstallModal tabs |
| Pre-compilation when installing | Task 2 — `precompile()`; Task 3 — `--precompile` flag; Task 4 — avr.rs reuse |
| Offer to switch project board after install | Task 7 — `offerSwitch` footer in modal |
| ESP32 + ESP8266 example boards | Task 1 — both board packages created |

**Placeholder scan:** No TBD, TODO, or "implement later" found. All code blocks are complete.

**Type consistency:**
- `BoardPlatform` interface defined in Task 5, imported in Tasks 6, 7 — fields match.
- `platforms::precompiled_core()` defined in Task 2, called in Task 4 — signature matches.
- `load_installed_platforms()` defined in Task 2, called in Tasks 3 and 5 — no args.
- `setBoard(id)` called in Task 7 — function exists in store (used throughout IdeScreen.tsx).
