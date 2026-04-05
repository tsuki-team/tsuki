// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash  —  Arduino compile & flash toolchain
// ─────────────────────────────────────────────────────────────────────────────

mod boards;
mod compile;
mod detect;
mod error;
mod flash;
mod lib_manager;
mod cores;
mod platforms;
mod sdk;
mod serial_monitor;

use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;
use std::time::Instant;

use tsuki_ux::color::{color_enabled, C_ERROR, C_WARN, C_MUTED, C_STEP, BOLD, DIM, RESET};
use tsuki_ux::{success, fail, warn, info, step, note, section};

use boards::Board;
use compile::{compile, CompileRequest};
use flash::{flash, FlashRequest};
use error::{FlashError, Result};

// ─────────────────────────────────────────────────────────────────────────────
//  CLI
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name    = "tsuki-flash",
    version = env!("CARGO_PKG_VERSION"),
    about   = "Arduino compile & flash toolchain — no arduino-cli required",
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,

    #[arg(long, global = true)]
    quiet: bool,

    #[arg(long, short = 'v', global = true)]
    verbose: bool,

    /// Print every compiler/linker command verbatim (implies --verbose)
    #[arg(long, short = 'd', global = true)]
    debug: bool,

    #[arg(long, global = true)]
    no_color: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compile a sketch to firmware (.hex / .bin)
    Compile(CompileArgs),
    /// Upload compiled firmware to a connected board
    Upload(UploadArgs),
    /// Compile then immediately upload
    Run(RunArgs),
    /// Detect connected boards / serial ports
    Detect {
        /// Output machine-readable JSON instead of a human table.
        /// Each line is one JSON object: {"port":"COM3","board_id":"nano","vid_pid":"1A86:7523","board_name":"Arduino Nano / clone (CH340)"}
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// List all supported boards
    Boards,
    /// Print SDK discovery paths for a board
    SdkInfo {
        #[arg(default_value = "uno")]
        board: String,
    },
    /// Manage Arduino libraries  (install / search / list / info)
    Lib(LibArgs),
    /// Open an interactive serial port monitor
    Monitor(MonitorArgs),
    /// Manage Arduino SDK cores via tsuki-modules  (no arduino-cli needed)
    Modules(ModulesArgs),
    /// Manage downloadable board platforms (install / list / remove / precompile)
    Platforms(PlatformsArgs),
}

// ── Compile args ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct CompileArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long)]
    sketch: PathBuf,

    #[arg(long)]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    /// Extra include directories
    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,

    /// Source language: go (default), cpp, or ino
    #[arg(long, default_value = "go")]
    language: String,

    /// Use the tsuki-modules SDK store instead of .arduino15
    #[arg(long, default_value_t = false)]
    use_modules: bool,
}

// ── Upload args ───────────────────────────────────────────────────────────────

#[derive(Args)]
struct UploadArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long, short = 'p')]
    port: Option<String>,

    #[arg(long)]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "0")]
    baud: u32,
}

// ── Run args ──────────────────────────────────────────────────────────────────

#[derive(Args)]
struct RunArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long, short = 'p')]
    port: Option<String>,

    #[arg(long)]
    sketch: PathBuf,

    #[arg(long, default_value = "build/.cache")]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,

    /// Source language: go (default), cpp, or ino
    #[arg(long, default_value = "go")]
    language: String,

    #[arg(long, default_value_t = false)]
    use_modules: bool,

    #[arg(long, default_value = "0")]
    baud: u32,
}

// ── Lib args ──────────────────────────────────────────────────────────────────

#[derive(Args)]
struct LibArgs {
    #[command(subcommand)]
    command: LibCmd,
}

#[derive(Subcommand)]
enum LibCmd {
    Install {
        name: String,
        #[arg(long)]
        version: Option<String>,
    },
    Search { query: String },
    List,
    Info { name: String },
    Update,
}

// ── Monitor args ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct MonitorArgs {
    /// Serial port path (e.g. /dev/ttyUSB0, COM3).
    /// When omitted, tsuki-flash auto-detects the first connected Arduino.
    #[arg(long, short = 'p')]
    port: Option<String>,

    /// Baud rate (default: 9600)
    #[arg(long, short = 'b', default_value = "9600")]
    baud: u32,

    /// Board ID — used only for auto-detecting the port when --port is omitted
    #[arg(long)]
    board: Option<String>,

    /// Print raw bytes as hex alongside ASCII
    #[arg(long, default_value_t = false)]
    raw: bool,
}

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

// ── Modules args ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct ModulesArgs {
    #[command(subcommand)]
    command: ModulesCmd,
}

#[derive(Subcommand)]
enum ModulesCmd {
    /// Download + install an Arduino SDK core (avr | esp32 | esp8266 | sam | rp2040)
    ///
    /// Examples:
    ///   tsuki-flash modules install avr
    ///   tsuki-flash modules install esp32
    ///   tsuki-flash modules install rp2040
    Install {
        /// Architecture: avr, esp32, esp8266, sam, rp2040
        arch: String,
    },
    /// List installed cores
    List,
    /// Force-refresh the package index cache
    Update,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    // Load installed board platforms into the dynamic board registry.
    platforms::load_installed_platforms();

    // Honour --no-color by setting NO_COLOR before the OnceLock initialises.
    if cli.no_color {
        // SAFETY: single-threaded at this point (no other threads spawned yet).
        unsafe { std::env::set_var("NO_COLOR", "1"); }
    }

    let result = match cli.command {
        Cmd::Compile(a)        => cmd_compile(a, cli.verbose, cli.debug, cli.quiet),
        Cmd::Upload(a)         => cmd_upload(a, cli.verbose, cli.quiet),
        Cmd::Run(a)            => cmd_run(a, cli.verbose, cli.debug, cli.quiet),
        Cmd::Detect { json }     => cmd_detect(json),
        Cmd::Boards            => { cmd_boards(); Ok(()) }
        Cmd::SdkInfo { board } => cmd_sdk_info(&board),
        Cmd::Lib(a)            => cmd_lib(a, cli.verbose),
        Cmd::Modules(a)        => cmd_modules(a, cli.verbose),
        Cmd::Platforms(a)      => cmd_platforms(a, cli.verbose),
        Cmd::Monitor(a)        => cmd_monitor(a, cli.quiet),
    };

    if let Err(e) = result {
        fail(&e.to_string());
        std::process::exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Handlers
// ─────────────────────────────────────────────────────────────────────────────

fn cmd_compile(args: CompileArgs, verbose: bool, debug: bool, quiet: bool) -> Result<()> {
    let verbose = verbose || debug;   // --debug implies --verbose
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    ensure_modules_ready(args.use_modules, board.arch())?;

    if !quiet {
        step(&format!(
            "Compiling  [board: {}]  [{}]  [lang: {}]  {}",
            board.id, board.name, args.language,
            sdk_label(args.use_modules, board.arch()),
        ));
    }

    let t0 = Instant::now();
    let req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir,
        project_name:     name,
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        lib_source_dirs:  vec![],
        language:         compile::Language::from_str(&args.language),
        use_modules:      args.use_modules,
        verbose,
        debug,
    };

    let res = compile_with_auto_install(&req, board, verbose)?;
    if !quiet {
        success(&format!("compiled in {:.2}s", t0.elapsed().as_secs_f64()));
        print_firmware_info(&res);
    }
    Ok(())
}

fn cmd_upload(args: UploadArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| "firmware".into());
    let port  = resolve_port(args.port, quiet)?;

    if !quiet {
        step(&format!("Uploading  [board: {}]  [port: {}]", board.id, port));
    }

    let req = FlashRequest {
        build_dir:     args.build_dir,
        project_name:  name,
        port:          port.clone(),
        baud_override: args.baud,
        verbose,
    };

    flash(&req, board)
        .map_err(|e| { render_flash_error(&e, &port); e })
        .map(|()| {
            if !quiet {
                success(&format!("firmware uploaded to {}", port));
            }
        })
}

fn cmd_run(args: RunArgs, verbose: bool, debug: bool, quiet: bool) -> Result<()> {
    let verbose = verbose || debug;
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    ensure_modules_ready(args.use_modules, board.arch())?;

    if !quiet {
        step(&format!(
            "Compiling  [board: {}]  {}",
            board.id,
            sdk_label(args.use_modules, board.arch()),
        ));
    }

    let t0 = Instant::now();
    let compile_req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir.clone(),
        project_name:     name.clone(),
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        lib_source_dirs:  vec![],
        language:         compile::Language::from_str(&args.language),
        use_modules:      args.use_modules,
        verbose,
        debug,
    };

    let res = compile_with_auto_install(&compile_req, board, verbose)?;

    if !quiet {
        success(&format!("compiled in {:.2}s", t0.elapsed().as_secs_f64()));
    }

    let port = resolve_port(args.port, quiet)?;

    if !quiet {
        step(&format!("Uploading  [port: {}]", port));
    }

    let flash_req = FlashRequest {
        build_dir:     args.build_dir,
        project_name:  name,
        port:          port.clone(),
        baud_override: args.baud,
        verbose,
    };

    flash(&flash_req, board)
        .map_err(|e| { render_flash_error(&e, &port); e })?;

    if !quiet {
        success(&format!("firmware uploaded to {}", port));
        print_firmware_info(&res);
    }
    Ok(())
}

fn cmd_detect(json: bool) -> Result<()> {
    let ports = detect::detect_all();
    if ports.is_empty() {
        if json {
            // Empty JSON array so callers don't need to handle missing output.
            println!("[]");
        } else {
            warn("No serial ports found");
        }
        return Ok(());
    }

    if json {
        // One JSON object per line (newline-delimited JSON / NDJSON).
        // Avoids any human-table ambiguity when parsed by the IDE or scripts.
        // Format:
        //   {"port":"COM3","board_id":"nano","vid_pid":"1A86:7523","board_name":"Arduino Nano / clone (CH340)"}
        for p in &ports {
            let board_id   = p.board_id  .unwrap_or("unknown");
            let board_name = p.board_name.unwrap_or("—");
            let vid_pid    = p.vid_pid
                .map(|(v, pid)| format!("{:04X}:{:04X}", v, pid))
                .unwrap_or_else(|| "—".into());
            // Manual JSON serialisation — keeps the binary dependency-free.
            // All values are escaped minimally (no control chars in port names).
            fn esc(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }
            println!(r#"{{"port":"{}","board_id":"{}","vid_pid":"{}","board_name":"{}"}}"#,
                esc(&p.port), esc(board_id), esc(&vid_pid), esc(board_name));
        }
        return Ok(());
    }

    let (b, d, r) = ansi_bdr();
    println!("  {}{:<20}  {:<15}  {:<8}  {}{}", b, "PORT", "BOARD", "VID:PID", "NAME", r);
    println!("  {}{}{}", d, "─".repeat(66), r);
    for p in &ports {
        let vid_pid = p.vid_pid
            .map(|(v, pid)| format!("{:04X}:{:04X}", v, pid))
            .unwrap_or_else(|| "—".into());
        println!("  {:<20}  {:<15}  {:<8}  {}",
            p.port,
            p.board_id.unwrap_or("unknown"),
            vid_pid,
            p.board_name.unwrap_or("—"));
    }
    Ok(())
}

fn cmd_boards() {
    let (b, d, r) = ansi_bdr();
    println!("  {}{:<15}  {:<32}  {:<15}  {:>7}  {:>6}  {}{}", b, "ID", "NAME", "CPU / ARCH", "FLASH", "RAM", "FQBN", r);
    println!("  {}{}{}", d, "─".repeat(91), r);
    for brd in Board::catalog() {
        let (cpu, arch) = match &brd.toolchain {
            boards::Toolchain::Avr { mcu, .. }   => (mcu.to_string(), "avr"),
            boards::Toolchain::Sam { mcu, .. }    => (mcu.to_string(), "sam"),
            boards::Toolchain::Rp2040             => ("cortex-m0+".into(), "rp2040"),
            boards::Toolchain::Esp32 { variant }  => (variant.to_string(), "esp32"),
            boards::Toolchain::Esp8266            => ("lx106".into(), "esp8266"),
        };
        println!("  {}{:<15}{}  {:<32}  {:<7} ({:<6})  {:>5}K  {:>4}K  {}{}{}",
            b, brd.id, r,
            brd.name,
            cpu, arch,
            brd.flash_kb, brd.ram_kb,
            d, brd.fqbn, r);
    }
}

fn cmd_sdk_info(board_id: &str) -> Result<()> {
    let board = find_board(board_id)?;
    match sdk::resolve(board.arch(), board.variant, true) {
        Ok(paths) => {
            success(&format!("SDK found  ({})", paths.sdk_version));
            note(&format!("core:      {}", paths.core_dir.display()));
            note(&format!("variant:   {}", paths.variant_dir.display()));
            note(&format!("toolchain: {}", paths.toolchain_bin.display()));
            if let Some(ld) = &paths.libraries_dir {
                note(&format!("libraries: {}", ld.display()));
            }
            if paths.bundled_libs_dirs.is_empty() {
                note("bundled include dirs: (none)");
            } else {
                note(&format!("bundled include dirs ({}):", paths.bundled_libs_dirs.len()));
                for d in &paths.bundled_libs_dirs {
                    note(&format!("  -I {}", d.display()));
                }
            }
            Ok(())
        }
        Err(e) => { fail(&e.to_string()); Err(e) }
    }
}

fn cmd_monitor(args: MonitorArgs, quiet: bool) -> Result<()> {
    let port = match args.port {
        Some(p) => p,
        None    => resolve_port(None, quiet)?,
    };

    let cfg = serial_monitor::MonitorConfig {
        port,
        baud:  args.baud,
        raw:   args.raw,
        quiet,
    };

    serial_monitor::run(&cfg)
}

fn cmd_lib(args: LibArgs, verbose: bool) -> Result<()> {
    match args.command {
        LibCmd::Install { name, version } => {
            lib_manager::install(&name, version.as_deref(), verbose)?;
            if let Ok(root) = lib_manager::libs_root() {
                let p = root.join(&name);
                if p.exists() {
                    note(&format!("path:         {}", p.display()));
                    note(&format!("include hint: --include {}", p.display()));
                }
            }
            Ok(())
        }
        LibCmd::Search { query } => lib_manager::search(&query, verbose),
        LibCmd::List              => lib_manager::list(),
        LibCmd::Info { name }     => lib_manager::info(&name, verbose),
        LibCmd::Update => {
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                let cache = PathBuf::from(home)
                    .join(".arduino15")
                    .join(".tsuki_lib_index.json");
                if cache.exists() { let _ = std::fs::remove_file(&cache); }
            }
            info("Refreshing library index…");
            lib_manager::search("", verbose)?;
            success("Library index updated.");
            Ok(())
        }
    }
}

fn cmd_modules(args: ModulesArgs, verbose: bool) -> Result<()> {
    match args.command {
        ModulesCmd::Install { arch } => cores::install(&arch, verbose),
        ModulesCmd::List             => cores::list(),
        ModulesCmd::Update           => cores::update(verbose),
    }
}

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
            let _toml = platforms::install(&board, version.as_deref(), &opts)?;

            success(&format!("board platform '{}' installed", board));

            if precompile {
                info(&format!("Pre-compiling core for '{}' (this may take 1-2 min)…", board));
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
            println!("  {:<20}  {:<10}  {:<10}  {}", "BOARD", "VERSION", "ARCH", "NAME");
            println!("  {}", "─".repeat(60));
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
            info(&format!("Pre-compiling core for '{}' (this may take 1-2 min)…", board));
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
            println!("  {:<16}  {:<8}  {}", "BOARD", "ARCH", "DESCRIPTION");
            println!("  {}", "─".repeat(70));
            for e in &entries {
                println!("  {:<16}  {:<8}  {}", e.id, e.arch, e.description);
            }
            Ok(())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn find_board(id: &str) -> Result<&'static Board> {
    Board::find(id).ok_or_else(|| FlashError::UnknownBoard(id.to_owned()))
}

fn resolve_port(explicit: Option<String>, quiet: bool) -> Result<String> {
    if let Some(p) = explicit { return Ok(p); }
    if !quiet { info("auto-detecting board…"); }
    match detect::best_port() {
        Some(p) => {
            if !quiet { success(&format!("port: {}", p)); }
            Ok(p)
        }
        None => Err(FlashError::NoBoardDetected),
    }
}

fn dir_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "firmware".into())
}

fn sdk_label(use_modules: bool, arch: &str) -> String {
    if use_modules {
        format!("[sdk: {} via tsuki-modules]", arch)
    } else {
        format!("[sdk: {}]", arch)
    }
}

/// If --use-modules is requested, ensure the SDK for this arch is present
/// (auto-downloads on first use via cores::ensure_arch).
fn ensure_modules_ready(use_modules: bool, arch: &str) -> Result<()> {
    if !use_modules { return Ok(()); }
    cores::ensure_arch(arch, "standard", false).map(|_| ())
}

fn print_firmware_info(res: &compile::CompileResult) {
    if let Some(hex) = &res.hex_path { note(&format!("hex: {}", hex.display())); }
    if let Some(bin) = &res.bin_path { note(&format!("bin: {}", bin.display())); }
    if let Some(uf2) = &res.uf2_path { note(&format!("uf2: {}", uf2.display())); }
    if !res.size_info.is_empty()     { note(&res.size_info); }
}

/// Returns (bold, dim, reset) escape codes when color is enabled.
fn ansi_bdr() -> (&'static str, &'static str, &'static str) {
    if color_enabled() { (BOLD, DIM, RESET) } else { ("", "", "") }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Error rendering
// ─────────────────────────────────────────────────────────────────────────────

fn render_compile_error(e: &FlashError) {
    match e {
        FlashError::CompileFailed { output } | FlashError::LinkFailed { output } => {
            for line in output.lines() {
                if line.contains("error:") {
                    eprintln!("  {}", C_ERROR.paint(line));
                } else if line.contains("warning:") {
                    eprintln!("  {}", C_WARN.paint(line));
                } else if !line.trim().is_empty() {
                    eprintln!("  {}", C_MUTED.paint(line));
                }
            }
        }
        FlashError::SdkNotFound { arch, path, pkg } => {
            fail(&format!("SDK not found for arch '{}'", arch));
            note(&format!("Expected at: {}", path));
            note(&format!("Install with: tsuki-flash modules install {}  (or via Arduino IDE Board Manager: {})", arch, pkg));
        }
        FlashError::ToolchainNotFound(msg) => fail(msg),
        FlashError::Other(msg) => {
            for line in msg.lines() {
                eprintln!("  {}", line);
            }
        }
        _ => fail(&e.to_string()),
    }

    eprintln!("  {}", C_MUTED.paint(&"─".repeat(58)));
}

fn render_flash_error(e: &FlashError, port: &str) {
    match e {
        FlashError::FlashFailed { output, .. } => {
            for line in output.lines() {
                if line.to_lowercase().contains("error") {
                    eprintln!("  {}", C_ERROR.paint(line));
                } else if !line.trim().is_empty() {
                    eprintln!("  {}", C_MUTED.paint(line));
                }
            }
            note("Ensure the board is in bootloader mode");
            note("Try a different USB cable / port");
            note("Pass --port explicitly: tsuki-flash upload --port /dev/ttyUSB0 …");
        }
        FlashError::NoBoardDetected => {
            fail("No board detected on any serial port");
            note("Connect the board and retry, or pass --port /dev/ttyUSBx");
        }
        _ => fail(&e.to_string()),
    }

    eprintln!("  {}", C_MUTED.paint(&"─".repeat(58)));
}

/// Compile a sketch; if the SDK is missing, install it automatically and retry.
///
/// Returns the `CompileResult` on success so callers can print firmware info.
fn compile_with_auto_install(
    req:     &CompileRequest,
    board:   &Board,
    verbose: bool,
) -> Result<compile::CompileResult> {
    match compile(req, board) {
        Ok(res) => Ok(res),

        // SDK not installed → auto-install via cores, then retry once.
        Err(FlashError::SdkNotFound { ref arch, .. }) => {
            let arch = arch.clone();
            warn(&format!(
                "SDK not found for '{}' — installing automatically via tsuki-modules…", arch
            ));
            cores::install(&arch, verbose).map_err(|e| {
                fail(&format!("Auto-install failed: {}", e));
                e
            })?;

            info("Retrying compilation…");
            compile(req, board).map_err(|e| { render_compile_error(&e); e })
        }

        Err(e) => { render_compile_error(&e); Err(e) }
    }
}