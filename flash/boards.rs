// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: boards  —  supported board database
//
//  The Arduino Uno is the only board built into tsuki-flash.
//  All other boards are distributed as board packages (tsuki_board.toml)
//  and loaded at runtime from the user's boards directory.
//
//  Board packages live at:
//    Linux/macOS: ~/.local/share/tsuki/boards/<id>/<version>/tsuki_board.toml
//    Windows:     %APPDATA%\tsuki\boards\<id>\<version>\tsuki_board.toml
//
//  Install a board package with: tsuki boards install <id>
// ─────────────────────────────────────────────────────────────────────────────

use std::fmt;
use std::path::Path;

/// Which compiler/programmer family to use.
#[derive(Debug, Clone, PartialEq)]
pub enum Toolchain {
    /// AVR microcontrollers — avr-gcc + avrdude
    Avr {
        mcu:        &'static str,   // e.g. "atmega328p"
        f_cpu:      u32,            // e.g. 16_000_000
        programmer: &'static str,   // e.g. "arduino"
        baud:       u32,
    },
    /// Atmel SAM ARM — arm-none-eabi-gcc + bossac
    Sam {
        mcu:   &'static str,
        f_cpu: u32,
    },
    /// Raspberry Pi RP2040 — arm-none-eabi-gcc + picotool/uf2
    Rp2040,
    /// Espressif ESP32 — xtensa-esp32-elf-gcc + esptool.py
    Esp32 {
        variant: &'static str,  // e.g. "esp32", "esp32s2", "esp32c3"
    },
    /// Espressif ESP8266 — xtensa-lx106-elf-gcc + esptool.py
    Esp8266,
}

/// A dynamic toolchain parsed from a tsuki_board.toml.
#[derive(Debug, Clone)]
pub enum DynToolchain {
    Avr   { mcu: String, f_cpu: u32, programmer: String, baud: u32 },
    Sam   { mcu: String, f_cpu: u32 },
    Rp2040,
    Esp32 { variant: String },
    Esp8266,
}

#[derive(Debug, Clone)]
pub struct Board {
    pub id:        &'static str,
    pub name:      &'static str,
    pub fqbn:      &'static str,
    pub variant:   &'static str,   // pins_arduino.h variant folder
    pub flash_kb:  u32,
    pub ram_kb:    u32,
    pub toolchain: Toolchain,
    /// Compile-time defines specific to this board
    pub defines:   &'static [&'static str],
}

/// A board loaded from a `tsuki_board.toml` package file.
#[derive(Debug, Clone)]
pub struct DynBoard {
    pub id:        String,
    pub name:      String,
    pub fqbn:      String,
    pub variant:   String,
    pub flash_kb:  u32,
    pub ram_kb:    u32,
    pub toolchain: DynToolchain,
    pub defines:   Vec<String>,
}

impl fmt::Display for Board {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.name, self.fqbn)
    }
}

impl fmt::Display for DynBoard {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.name, self.fqbn)
    }
}

impl Board {
    /// Return the built-in board catalog (Arduino Uno only).
    pub fn catalog() -> &'static [Board] {
        &BOARDS
    }

    /// Find a built-in board by its short ID (case-insensitive).
    pub fn find(id: &str) -> Option<&'static Board> {
        let id_lower = id.to_lowercase();
        BOARDS.iter().find(|b| b.id.eq_ignore_ascii_case(&id_lower))
    }

    /// Find a board by ID, checking user boards directory first, then built-in catalog.
    /// Pass the boards_dir from tsuki config (packages.boards_dir).
    pub fn find_with_boards_dir<'a>(id: &str, boards_dir: Option<&Path>) -> BoardLookup {
        // 1. Check user-installed board packages first
        if let Some(dir) = boards_dir {
            if let Some(b) = DynBoard::load_from_dir(id, dir) {
                return BoardLookup::Dynamic(b);
            }
        }
        // 2. Fall back to built-in catalog
        if let Some(b) = Board::find(id) {
            return BoardLookup::Static(b);
        }
        BoardLookup::NotFound
    }

    pub fn avr_mcu(&self) -> Option<&'static str> {
        if let Toolchain::Avr { mcu, .. } = &self.toolchain {
            Some(mcu)
        } else {
            None
        }
    }

    pub fn f_cpu(&self) -> u32 {
        match &self.toolchain {
            Toolchain::Avr { f_cpu, .. }  => *f_cpu,
            Toolchain::Sam { f_cpu, .. }  => *f_cpu,
            Toolchain::Rp2040             => 133_000_000,
            Toolchain::Esp32 { .. }       => 240_000_000,
            Toolchain::Esp8266            => 80_000_000,
        }
    }

    pub fn avrdude_programmer(&self) -> Option<(&'static str, u32)> {
        if let Toolchain::Avr { programmer, baud, .. } = &self.toolchain {
            Some((programmer, *baud))
        } else {
            None
        }
    }

    pub fn arch(&self) -> &'static str {
        match &self.toolchain {
            Toolchain::Avr { .. }   => "avr",
            Toolchain::Sam { .. }   => "sam",
            Toolchain::Rp2040       => "rp2040",
            Toolchain::Esp32 { .. } => "esp32",
            Toolchain::Esp8266      => "esp8266",
        }
    }
}

/// Result of a board lookup across built-in + user-installed boards.
pub enum BoardLookup {
    Static(&'static Board),
    Dynamic(DynBoard),
    NotFound,
}

impl DynBoard {
    /// Attempt to load a board from the boards dir: <dir>/<id>/<version>/tsuki_board.toml
    /// Uses the newest (lexicographically last) version found.
    pub fn load_from_dir(id: &str, boards_dir: &Path) -> Option<DynBoard> {
        let board_dir = boards_dir.join(id);
        if !board_dir.exists() {
            return None;
        }
        // Find the latest version directory
        let mut versions: Vec<String> = std::fs::read_dir(&board_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        versions.sort();
        let version = versions.last()?;
        let toml_path = board_dir.join(version).join("tsuki_board.toml");
        Self::load_from_toml(&toml_path)
    }

    /// Parse a `tsuki_board.toml` file into a DynBoard.
    pub fn load_from_toml(path: &Path) -> Option<DynBoard> {
        let content = std::fs::read_to_string(path).ok()?;
        Self::parse_toml(&content)
    }

    /// Minimal TOML parser for tsuki_board.toml format.
    pub fn parse_toml(content: &str) -> Option<DynBoard> {
        let mut section = "";
        let mut id = String::new();
        let mut name = String::new();
        let mut fqbn = String::new();
        let mut variant = String::new();
        let mut flash_kb: u32 = 0;
        let mut ram_kb: u32 = 0;
        let mut tc_type = String::new();
        let mut tc_mcu = String::new();
        let mut tc_f_cpu: u32 = 0;
        let mut tc_programmer = String::new();
        let mut tc_baud: u32 = 0;
        let mut tc_variant = String::new();
        let mut defines: Vec<String> = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                section = if line == "[board]" { "board" }
                           else if line == "[toolchain]" { "toolchain" }
                           else if line == "[defines]" { "defines" }
                           else { "" };
                continue;
            }
            if line.starts_with('#') || line.is_empty() {
                continue;
            }

            // Parse values array: values = ["A", "B"]
            if section == "defines" && line.starts_with("values") {
                let start = line.find('[').unwrap_or(0) + 1;
                let end = line.rfind(']').unwrap_or(line.len());
                let inner = &line[start..end];
                defines = inner
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                continue;
            }

            let mut parts = line.splitn(2, '=');
            let key = parts.next()?.trim();
            let val = parts.next()?.trim().trim_matches('"').to_string();

            match (section, key) {
                ("board", "id")       => id = val,
                ("board", "name")     => name = val,
                ("board", "fqbn")     => fqbn = val,
                ("board", "variant")  => variant = val,
                ("board", "flash_kb") => flash_kb = val.parse().unwrap_or(0),
                ("board", "ram_kb")   => ram_kb = val.parse().unwrap_or(0),
                ("toolchain", "type")       => tc_type = val,
                ("toolchain", "mcu")        => tc_mcu = val,
                ("toolchain", "f_cpu")      => tc_f_cpu = val.parse().unwrap_or(0),
                ("toolchain", "programmer") => tc_programmer = val,
                ("toolchain", "baud")       => tc_baud = val.parse().unwrap_or(0),
                ("toolchain", "variant")    => tc_variant = val,
                _ => {}
            }
        }

        if id.is_empty() || fqbn.is_empty() {
            return None;
        }

        let toolchain = match tc_type.as_str() {
            "avr" => DynToolchain::Avr {
                mcu: tc_mcu,
                f_cpu: tc_f_cpu,
                programmer: tc_programmer,
                baud: tc_baud,
            },
            "sam"    => DynToolchain::Sam { mcu: tc_mcu, f_cpu: tc_f_cpu },
            "rp2040" => DynToolchain::Rp2040,
            "esp32"  => DynToolchain::Esp32 { variant: tc_variant },
            _        => DynToolchain::Esp8266,
        };

        Some(DynBoard { id, name, fqbn, variant, flash_kb, ram_kb, toolchain, defines })
    }

    pub fn f_cpu(&self) -> u32 {
        match &self.toolchain {
            DynToolchain::Avr { f_cpu, .. }  => *f_cpu,
            DynToolchain::Sam { f_cpu, .. }  => *f_cpu,
            DynToolchain::Rp2040             => 133_000_000,
            DynToolchain::Esp32 { .. }       => 240_000_000,
            DynToolchain::Esp8266            => 80_000_000,
        }
    }

    pub fn arch(&self) -> &str {
        match &self.toolchain {
            DynToolchain::Avr { .. }   => "avr",
            DynToolchain::Sam { .. }   => "sam",
            DynToolchain::Rp2040       => "rp2040",
            DynToolchain::Esp32 { .. } => "esp32",
            DynToolchain::Esp8266      => "esp8266",
        }
    }

    pub fn avrdude_programmer(&self) -> Option<(String, u32)> {
        if let DynToolchain::Avr { programmer, baud, .. } = &self.toolchain {
            Some((programmer.clone(), *baud))
        } else {
            None
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Static board table — Arduino Uno only.
//  All other boards are board packages installed via `tsuki boards install`.
// ─────────────────────────────────────────────────────────────────────────────

static BOARDS: &[Board] = &[
    Board {
        id: "uno", name: "Arduino Uno",
        fqbn: "arduino:avr:uno",
        variant: "standard",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 16_000_000,
            programmer: "arduino", baud: 115200,
        },
        defines: &["ARDUINO_AVR_UNO", "ARDUINO_ARCH_AVR"],
    },
];
