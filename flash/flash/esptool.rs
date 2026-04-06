// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: flash :: esptool  —  ESP32 / ESP8266 programmer
// ─────────────────────────────────────────────────────────────────────────────

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use tsuki_ux::LiveBlock;
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};

pub fn flash(firmware: &Path, port: &str, board: &Board, baud: u32, verbose: bool) -> Result<()> {
    let esptool = find_esptool()
        .ok_or_else(|| FlashError::ToolchainNotFound(
            "esptool not found — install with: pip install esptool".into()
        ))?;

    let chip = match &board.toolchain {
        Toolchain::Esp32 { variant } => variant.as_ref(),
        Toolchain::Esp8266           => "esp8266",
        _ => return Err(FlashError::Other("Not an ESP board".into())),
    };

    // Flash offsets differ between chips:
    //   ESP32:   app binary lives at 0x10000 (bootloader=0x1000, partition=0x8000)
    //   ESP8266: app binary lives at 0x0000
    // Using 0x1000 for ESP32 overwrites the bootloader — hard brick.
    let offset = match &board.toolchain {
        Toolchain::Esp32 { .. } => "0x10000",
        _                       => "0x0000",
    };
    let write_cmd = "write_flash";

    let mut cmd = Command::new(&esptool);
    cmd.args([
        "--chip", chip,
        "--port", port,
        "--baud", &baud.to_string(),
        "--before", "default_reset",
        "--after",  "hard_reset",
        write_cmd,
        "-z",
        "--flash_mode", "dio",
        "--flash_freq", "80m",
        "--flash_size", "detect",
        offset,
        firmware.to_str().unwrap(),
    ]);

    if verbose {
        cmd.arg("--trace");
    }

    let label = format!("esptool  [{}]  →  {}", board.id, port);
    let mut block = LiveBlock::new(&label);
    block.start();

    let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => {
            block.finish(false, Some("could not start esptool"));
            return Err(FlashError::ToolchainNotFound(
                format!("failed to spawn esptool: {}", e)
            ));
        }
    };

    // Drain stdout in a background thread to prevent pipe buffer deadlock.
    // esptool writes progress to stderr; stdout is usually empty.
    let stdout_drain = child.stdout.take().map(|stdout| {
        thread::spawn(move || { BufReader::new(stdout).lines().for_each(drop); })
    });

    let mut captured: Vec<String> = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().filter_map(|l| l.ok()) {
            if !line.trim().is_empty() {
                block.line(&line);
                captured.push(line);
            }
        }
    }

    if let Some(h) = stdout_drain { let _ = h.join(); }

    let status = match child.wait() {
        Ok(s) => s,
        Err(e) => {
            block.finish(false, Some("wait failed"));
            return Err(FlashError::Other(format!("esptool wait failed: {}", e)));
        }
    };

    if status.success() {
        block.finish(true, None);
        Ok(())
    } else {
        block.finish(false, Some("upload failed"));
        Err(FlashError::FlashFailed {
            port:   port.to_owned(),
            output: captured.join("\n").trim().to_owned(),
        })
    }
}

fn find_esptool() -> Option<String> {
    for candidate in &["esptool.py", "esptool"] {
        if Command::new(candidate).arg("version").output()
            .map(|o| o.status.success()).unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}