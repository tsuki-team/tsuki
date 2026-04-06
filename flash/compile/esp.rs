// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: esp
//
//  Compiles Arduino ESP32 / ESP8266 sketches using the Espressif toolchain.
//
//  Pipeline:
//    1. Compile sketch sources  (parallel, incremental cache)
//    2. Link → firmware.elf
//    3. esptool.py → firmware.bin  +  firmware.hex (for consistency)
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;
use super::cache::{CacheManifest, hash_str, obj_path};
use super::{CompileRequest, CompileResult};

pub fn run(req: &CompileRequest, board: &Board, sdk: &SdkPaths) -> Result<CompileResult> {
    std::fs::create_dir_all(&req.build_dir)?;

    let is_esp32 = matches!(&board.toolchain, Toolchain::Esp32 { .. });

    // ESP32-C3/C6/H2/P4/C5 are RISC-V chips; all other ESP32 variants are Xtensa.
    // RISC-V variants ship a separate "esp-rv32" toolchain package with riscv32-esp-elf-*
    // binaries.  Xtensa variants use the "esp-x32" package with xtensa-esp-elf-* binaries.
    let esp32_variant = if let Toolchain::Esp32 { variant } = &board.toolchain {
        *variant
    } else { "" };
    let is_riscv = is_esp32 && matches!(esp32_variant,
        "esp32c3" | "esp32c6" | "esp32h2" | "esp32p4" | "esp32c5" | "esp32p4_es");

    // ESP32 3.x (IDF 5.x) ships a unified "esp-x32" toolchain with generic binary
    // names (xtensa-esp-elf-gcc) instead of chip-specific names (xtensa-esp32-elf-gcc).
    // Detect which convention to use by checking which binary is present in the bin dir.
    let (cc, cxx) = if is_esp32 {
        if is_riscv {
            // RISC-V ESP32 variants (C3, C6, H2, P4) → riscv32-esp-elf-* from esp-rv32
            (resolve_tool(&sdk.toolchain_bin, "riscv32-esp-elf-gcc"),
             resolve_tool(&sdk.toolchain_bin, "riscv32-esp-elf-g++"))
        } else {
            let chip_gcc    = if cfg!(windows) { "xtensa-esp32-elf-gcc.exe"  } else { "xtensa-esp32-elf-gcc" };
            let generic_gcc = if cfg!(windows) { "xtensa-esp-elf-gcc.exe"    } else { "xtensa-esp-elf-gcc" };
            if !sdk.toolchain_bin.as_os_str().is_empty()
                && !sdk.toolchain_bin.join(chip_gcc).is_file()
                && sdk.toolchain_bin.join(generic_gcc).is_file()
            {
                // Generic layout (tsuki-modules esp-x32 extraction): xtensa-esp-elf-*
                (resolve_tool(&sdk.toolchain_bin, "xtensa-esp-elf-gcc"),
                 resolve_tool(&sdk.toolchain_bin, "xtensa-esp-elf-g++"))
            } else {
                // Chip-specific layout (arduino15 esp-x32 or old 2.x SDK): xtensa-esp32-elf-*
                (resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-gcc"),
                 resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-g++"))
            }
        }
    } else {
        (resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-gcc"),
         resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-g++"))
    };

    // Xtensa-specific arch flags.  RISC-V variants must NOT receive these flags;
    // their -march/-mabi/etc. come from the IDF cpp_flags/c_flags response files.
    let (arch_flags, link_script): (&[&str], &str) = if is_esp32 {
        if is_riscv {
            (&[], "esp32c3.ld")  // link script is supplied via ld_scripts response file anyway
        } else {
            (&["-mlongcalls", "-mtext-section-literals"], "esp32.ld")
        }
    } else {
        (&["-mlongcalls", "-mtext-section-literals", "-falign-functions=4"], "eagle.app.v6.common.ld")
    };

    // Derive the SDK platform root from core_dir:
    //   core_dir  = <sdk_dir>/cores/esp8266/  (or .../cores/esp32/)
    //   sdk_dir   = <sdk_dir>/
    // ESP8266 keeps SDK headers/libs/ld-scripts under tools/sdk/ inside the
    // platform directory — NOT the toolchain tools directory.
    let sdk_dir = sdk.core_dir.parent().and_then(|p| p.parent())
        .map(|p| p.to_owned())
        .unwrap_or_else(|| sdk.core_dir.clone());

    // ESP8266-specific paths under tools/sdk/
    let esp8266_sdk = sdk_dir.join("tools").join("sdk");
    let esp8266_sdk_include = esp8266_sdk.join("include");
    let esp8266_sdk_lwip2   = esp8266_sdk.join("lwip2").join("include");
    let esp8266_sdk_ld      = esp8266_sdk.join("ld");
    let esp8266_sdk_lib     = esp8266_sdk.join("lib");

    // ESP32 3.x (IDF 5.x): use response files from esp32-libs/flags/ for includes,
    // defines, and compiler flags.  The response files contain the exact flags that
    // the official Arduino IDE build system uses, which is required for:
    //   - -iprefix + -iwithprefixbefore include resolution (hundreds of IDF subdirs)
    //   - Correct -std=gnu++2b / -std=gnu17 flags matching what IDF was built with
    //   - Preprocessor defines like CHIP_HAVE_CONFIG_H that IDF headers require
    // Without these, IDF headers that include <cstddef> or other C++ stdlib headers
    // trigger "compilation terminated" because the include chain breaks.
    let idf = sdk.idf_libs_dir.as_deref();

    // ARDUINO_BOARD is a quoted string define used by the Arduino core (e.g.
    // chip-debug-report.cpp) to print the board name.  It's derived from the
    // first board define that starts with ARDUINO_ but is not ARDUINO_ARCH_*.
    // e.g. "ARDUINO_ESP32_DEV" → ARDUINO_BOARD="ESP32_DEV"
    let arduino_board_str = board.defines.iter()
        .find(|d| d.starts_with("ARDUINO_") && !d.starts_with("ARDUINO_ARCH_"))
        .map(|d| d.trim_start_matches("ARDUINO_"))
        .unwrap_or("UNKNOWN");

    let common_flags: Vec<String> = {
        let mut f = vec![
            format!("-DF_CPU={}L", board.f_cpu()),
            "-DARDUINO=10819".into(),
            // ARDUINO_BOARD and ARDUINO_VARIANT are string literals required by
            // the ESP32/ESP8266 Arduino core (chip-debug-report.cpp, version.h…)
            format!("-DARDUINO_BOARD=\"{}\"", arduino_board_str),
            format!("-DARDUINO_VARIANT=\"{}\"", board.variant),
            "-w".into(),
            "-MMD".into(),
            format!("-I{}", sdk.core_dir.display()),
            format!("-I{}", sdk.variant_dir.display()),
        ];

        if let Some(libs) = idf {
            // ESP32 3.x: inject IDF defines and include paths via response files.
            // @flags/defines: -DFOO -DBAR … (one long line, GCC expands it)
            // -iprefix <libs>/include/ : base prefix for all -iwithprefixbefore entries
            // @flags/includes: -iwithprefixbefore subdir1 -iwithprefixbefore subdir2 …
            // -I<libs>/default/include : memory-type-specific headers (default = QIO)
            let defines_rsp  = libs.join("flags").join("defines");
            let includes_rsp = libs.join("flags").join("includes");
            if defines_rsp.is_file() {
                f.push(format!("@{}", defines_rsp.display()));
            }
            // -iprefix MUST end with '/' — GCC concatenates the prefix string
            // directly (no separator added) with the -iwithprefixbefore argument.
            // Without the trailing slash: prefix="…/include" + "freertos/…" →
            // "…/includefreertos/…" (wrong).  Using forward slashes avoids
            // Windows backslash issues with the GCC argument parser.
            let iprefix = format!("{}/",
                libs.join("include").to_string_lossy().replace('\\', "/"));
            f.push(format!("-iprefix{}", iprefix));
            if includes_rsp.is_file() {
                f.push(format!("@{}", includes_rsp.display()));
            }
            // sdkconfig.h lives in the flash-mode specific directory
            // (qio_qspi/include/ or dio_qspi/include/), NOT default/include/.
            // It is NOT reachable via -iwithprefixbefore because those entries
            // use paths relative to include/, while sdkconfig.h is outside include/.
            for mode in &["qio_qspi", "dio_qspi"] {
                let sdkcfg_dir = libs.join(mode).join("include");
                if sdkcfg_dir.is_dir() {
                    f.push(format!("-I{}", sdkcfg_dir.display()));
                    break;
                }
            }
        } else {
            // ESP32 2.x / ESP8266: classic optimisation flag
            // ESP8266 xtensa-lx106-elf-g++ (bundled with core 3.x) has a
            // known ICE in bot_manip/cp/tree.c when -Os is combined with
            // constexpr template instantiation in core_esp8266_version.h.
            // -O2 avoids the buggy shrink-wrap path; size difference is minimal.
            f.push(if is_esp32 { "-Os".to_string() } else { "-O2".to_string() });
            f.push("-ffunction-sections".into());
            f.push("-fdata-sections".into());
            f.push("-Wno-error=narrowing".into());
        }

        // ESP8266 requires tools/sdk/include on the include path.
        // c_types.h, ets_sys.h, and many other SDK headers live there.
        // Without it the very first #include in cores/esp8266/esp8266_peri.h
        // fails with "c_types.h: No such file or directory".
        // Also add lwip2/include for LwIP headers used by the network stack.
        //
        // Additionally, ESP8266 SDK headers gate their content behind mandatory
        // preprocessor defines (from platform.txt's cpreprocessor.flags):
        //   -D__ets__          : ESP8266 SDK marker (always required)
        //   -DICACHE_FLASH     : instruction cache in flash mode (always required)
        //   -D_GNU_SOURCE      : enables POSIX extensions in newlib
        //   -DLWIP_OPEN_SRC    : required by tools/sdk/include/user_interface.h
        //   -DTCP_MSS=536      : lwIP v2 TCP max segment size (536-byte / lower memory)
        //   -DLWIP_FEATURES=1  : lwIP v2 with features enabled
        //   -DLWIP_IPV6=0      : no IPv6 (default board configuration)
        //   -DNONOSDK22x_190703=1 : active SDK version flag (default from platform.txt)
        //
        // The toolchain's own include/ dir (sibling of bin/) must also be on the
        // include path for assembly files that use <xtensa/coreasm.h>.
        // Structure: xtensa-lx106-elf-gcc/<ver>/bin/ (toolchain_bin)
        //            xtensa-lx106-elf-gcc/<ver>/include/xtensa/coreasm.h
        // So we add toolchain_bin/../include to reach these Xtensa-specific headers.
        if !is_esp32 {
            f.push("-D__ets__".into());
            f.push("-DICACHE_FLASH".into());
            f.push("-D_GNU_SOURCE".into());
            f.push("-DLWIP_OPEN_SRC".into());
            f.push("-DTCP_MSS=536".into());
            f.push("-DLWIP_FEATURES=1".into());
            f.push("-DLWIP_IPV6=0".into());
            f.push("-DNONOSDK22x_190703=1".into());
            // Toolchain include dir: xtensa/coreasm.h and other Xtensa headers
            if let Some(tc_root) = sdk.toolchain_bin.parent() {
                let tc_inc = tc_root.join("include");
                if tc_inc.is_dir() {
                    f.push(format!("-I{}", tc_inc.display()));
                }
            }
            if esp8266_sdk_include.is_dir() {
                f.push(format!("-I{}", esp8266_sdk_include.display()));
            }
            if esp8266_sdk_lwip2.is_dir() {
                f.push(format!("-I{}", esp8266_sdk_lwip2.display()));
            }
        }

        for d in board.defines {
            f.push(format!("-D{}", d));
        }

        // ── tsuki annotations: TSUKI_FLAGS env var ────────────────────────────
        // TSUKI_FLAGS is set by the tsuki CLI after parsing // #[flags(...)] in
        // user source.  Format: "KEY=VAL,KEY2=VAL2" — each pair becomes a -D flag.
        if let Ok(raw) = std::env::var("TSUKI_FLAGS") {
            for pair in raw.split(',') {
                let pair = pair.trim();
                if !pair.is_empty() {
                    f.push(format!("-DTSUKI_FLAG_{}", pair.replace('-', "_")));
                }
            }
        }

        // ── tsuki annotations: TSUKI_MODULES env var ─────────────────────────
        // TSUKI_MODULES is set by the tsuki CLI after parsing // #[modules(...)]
        // in user source.  Each active module becomes a -DTSUKI_MODULE_<NAME>=1
        // so user C++ can guard code with #ifdef TSUKI_MODULE_WIFI etc.
        if let Ok(raw) = std::env::var("TSUKI_MODULES") {
            for module in raw.split(',') {
                let module = module.trim().to_uppercase().replace('-', "_");
                if !module.is_empty() {
                    f.push(format!("-DTSUKI_MODULE_{}=1", module));
                }
            }
        }

        for extra in &req.lib_include_dirs {
            f.push(format!("-I{}", extra.display()));
        }
        for bundled in &sdk.bundled_libs_dirs {
            f.push(format!("-I{}", bundled.display()));
        }
        for flag in arch_flags {
            f.push(flag.to_string());
        }
        f
    };

    // C++ flags — for ESP32 3.x read from the IDF response file (contains the
    // exact -std=gnu++2b and other flags matching what IDF was built with).
    // For older SDKs and ESP8266 use the classic hand-coded flags.
    //
    // -fno-tree-vrp: disables Value Range Propagation, which triggers the
    // Xtensa GCC ICE (bot_manip at cp/tree.c:3055) on ESP8266 core 3.1.x.
    // Not needed for ESP32 (different GCC build, no ICE).
    let no_vrp_flag;
    let idf_cpp_rsp_str;
    let cxxflags: Vec<&str> = {
        if let Some(libs) = idf {
            let rsp = libs.join("flags").join("cpp_flags");
            idf_cpp_rsp_str = format!("@{}", rsp.display());
            if rsp.is_file() {
                vec![idf_cpp_rsp_str.as_str()]
            } else {
                no_vrp_flag = String::new();
                vec!["-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics"]
            }
        } else {
            let mut flags = vec![
                "-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics",
            ];
            // ESP8266 core 3.x (xtensa-lx106-elf-g++ 10.3) uses C++17 constexpr
            // lambdas in core_esp8266_version.h.  Compiling them with -std=gnu++11
            // (the tsuki default) causes an internal compiler error in bot_manip at
            // cp/tree.c:3055 because the C++11 constexpr evaluator can't handle the
            // C++17 lambda syntax.  Enforce a minimum of gnu++17 for ESP8266.
            let std_num = req.cpp_std.trim_start_matches("c++").parse::<u32>().unwrap_or(11);
            let eff_std = if !is_esp32 && std_num < 17 { 17 } else { std_num };
            let std_flag = format!("-std=gnu++{}", eff_std);
            no_vrp_flag = std_flag;
            idf_cpp_rsp_str = String::new();
            flags.push(no_vrp_flag.as_str());
            // -fno-rtti: matches the official ESP8266 platform.txt flags; avoids
            // RTTI-related code generation that can interact with the bot_manip ICE.
            // -fno-tree-vrp: disables the Value Range Propagation pass that triggers
            // a separate ICE path in the same GCC 10.3 build.
            if !is_esp32 {
                flags.push("-fno-rtti");
                flags.push("-fno-tree-vrp");
            }
            flags
        }
    };

    // C flags — for ESP32 3.x read from the IDF response file.
    let idf_c_rsp_str = idf.map(|libs| {
        let rsp = libs.join("flags").join("c_flags");
        (rsp.clone(), format!("@{}", rsp.display()))
    });
    let cflags: Vec<&str> = match &idf_c_rsp_str {
        Some((rsp, s)) if rsp.is_file() => vec![s.as_str()],
        _ => vec![],
    };

    // ── Archiver tool ─────────────────────────────────────────────────────────
    let ar = if is_esp32 {
        if is_riscv {
            resolve_tool(&sdk.toolchain_bin, "riscv32-esp-elf-gcc-ar")
        } else {
            let generic_ar = if cfg!(windows) { "xtensa-esp-elf-gcc-ar.exe" } else { "xtensa-esp-elf-gcc-ar" };
            if !sdk.toolchain_bin.as_os_str().is_empty()
                && sdk.toolchain_bin.join(generic_ar).is_file() {
                resolve_tool(&sdk.toolchain_bin, "xtensa-esp-elf-gcc-ar")
            } else {
                resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-gcc-ar")
            }
        }
    } else {
        resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-gcc-ar")
    };

    let flags_sig = hash_str(&format!("{:?}{:?}", common_flags, cxxflags));

    // ── Step 1: Build Arduino core → core.a ───────────────────────────────
    // The Arduino core (Arduino.h, HardwareSerial.cpp, main.cpp, etc.) must be
    // compiled and archived BEFORE linking.  Without core.a the linker has no
    // app_main / setup / loop and every ESP32/ESP8266 link fails with undefined
    // references.  Results are cached with a sentinel so re-builds are instant.
    // Use arch-specific directory/archive names so ESP32/ESP8266/AVR cores
    // don't overwrite each other when boards share the same build_dir.
    let arch_tag = if is_esp32 { esp32_variant } else { "esp8266" };
    let core_obj_dir = req.build_dir.join(format!("core-{}", arch_tag));
    std::fs::create_dir_all(&core_obj_dir)?;
    let core_a = req.build_dir.join(format!("core-{}.a", arch_tag));
    let core_sig = hash_str(&format!("esp{}{}v{}", esp32_variant, is_esp32, sdk.sdk_version));
    build_esp_core(&cc, &cxx, &ar, &sdk.core_dir, &core_obj_dir, &core_a,
                   &common_flags, &cflags, &cxxflags, &core_sig, req.verbose)?;

    // Use arch-specific sketch obj dir so ESP32/ESP8266/AVR objects don't
    // collide when boards share the same build_dir.  Cross-arch ELF objects
    // produce "unknown architecture" linker errors if reused across boards.
    let sketch_obj_dir = req.build_dir.join(format!("sketch-{}", arch_tag));
    std::fs::create_dir_all(&sketch_obj_dir)?;

    // ── Precompiled Header (PCH) for Arduino.h ────────────────────────────
    // Arduino.h on ESP32/ESP8266 transitively pulls in hundreds of SDK/IDF
    // headers.  Without a PCH every source file re-parses all of them —
    // typically 1-5s per file.  With a valid PCH GCC loads the pre-parsed
    // binary representation in milliseconds.
    //
    // Strategy:
    //  1. Copy Arduino.h from the SDK core into pch_dir/ so GCC finds it
    //     there first when searching include paths.
    //  2. Compile pch_dir/Arduino.h → pch_dir/Arduino.h.gch with the exact
    //     same flags used for sketch compilation (GCC validates this).
    //  3. Prepend -I{pch_dir} to every C++ sketch/lib compilation.
    //
    // Cache key: SHA-256 of (common_flags + cxxflags).  Rebuilt only when
    // flags change (new lib added, SDK upgrade, etc.).  Failure is silent —
    // the build continues using normal header parsing.
    let pch_dir      = sketch_obj_dir.join("pch");
    let pch_copy     = pch_dir.join("Arduino.h");
    let pch_gch      = pch_dir.join("Arduino.h.gch");
    let pch_sentinel = pch_dir.join(".pch_sig");
    let pch_sig      = hash_str(&format!("{:?}{:?}", common_flags, cxxflags));

    let pch_valid = pch_gch.exists()
        && std::fs::read_to_string(&pch_sentinel)
            .map(|s| s.trim() == pch_sig.as_str())
            .unwrap_or(false);

    if !pch_valid {
        let sdk_arduino_h = sdk.core_dir.join("Arduino.h");
        if sdk_arduino_h.is_file()
            && std::fs::create_dir_all(&pch_dir).is_ok()
            && std::fs::copy(&sdk_arduino_h, &pch_copy).is_ok()
        {
            if req.verbose { eprintln!("  [pch] compiling Arduino.h precompiled header…"); }
            let mut pch_cmd = Command::new(&cxx);
            pch_cmd.arg(format!("-I{}", pch_dir.display())); // pch_dir searched first
            pch_cmd.args(&common_flags);
            pch_cmd.args(&cxxflags);
            pch_cmd.args(["-x", "c++-header", "-c"]);
            pch_cmd.arg(&pch_copy).arg("-o").arg(&pch_gch);
            match pch_cmd.output() {
                Ok(o) if o.status.success() => {
                    let _ = std::fs::write(&pch_sentinel, &pch_sig);
                }
                Ok(o) => {
                    // Non-fatal: fall back to normal header parsing
                    let _ = std::fs::remove_file(&pch_gch);
                    if req.verbose {
                        let msg = String::from_utf8_lossy(&o.stderr);
                        eprintln!("  [pch warn] PCH build failed, using header parsing: {}",
                            msg.lines().next().unwrap_or("unknown error"));
                    }
                }
                Err(_) => { let _ = std::fs::remove_file(&pch_gch); }
            }
        }
    }

    // Prepend -I{pch_dir} only when the PCH was successfully built.
    let pch_include: Option<String> = if pch_gch.exists() {
        Some(format!("-I{}", pch_dir.display()))
    } else {
        None
    };

    let sources = collect_sources(&req.sketch_dir)?;
    if sources.is_empty() {
        return Err(FlashError::Other("No source files found".into()));
    }

    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let mut manifest = CacheManifest::load(&sketch_obj_dir);

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(&sketch_obj_dir, src);
        if manifest.is_fresh(src, &obj, &flags_sig) {
            return obj;
        }

        let is_c   = src.extension().and_then(|e| e.to_str()) == Some("c");
        let is_ino = src.extension().and_then(|e| e.to_str()) == Some("ino");
        let compiler = if is_c { &cc } else { &cxx };

        let mut cmd = Command::new(compiler);
        // PCH dir first so GCC finds Arduino.h.gch before the SDK original.
        // Only C++ files benefit from the PCH; C files skip it.
        if !is_c {
            if let Some(pch_i) = &pch_include { cmd.arg(pch_i); }
        }
        cmd.args(&common_flags);
        if is_c {
            if !cflags.is_empty() { cmd.args(&cflags); }
        } else {
            cmd.args(&cxxflags);
        }
        if is_ino {
            // GCC does not recognise the .ino extension — without -x c++ the
            // toolchain silently skips the file (exit 0, no .o produced) which
            // causes a "cannot find *.ino.o" linker error.  Force C++ mode.
            cmd.arg("-x").arg("c++");
        }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        let out = cmd.output().expect("compiler spawn failed");
        if !out.status.success() {
            errors.lock().unwrap().push(
                format!("In {}:\n{}", src.display(),
                        String::from_utf8_lossy(&out.stderr))
            );
        }
        obj
    }).collect();

    // Save manifest only on success — saves flags_hash so fresh objects are
    // reused on next run.  Saving on failure would mark stale/wrong-arch objects
    // as fresh, causing them to be reused on the next build unchanged.
    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(FlashError::CompileFailed { output: errs.join("\n\n") });
    }
    for src in &sources {
        let obj = obj_path(&sketch_obj_dir, src);
        if obj.exists() { manifest.record(src, &flags_sig); }
    }
    let _ = manifest.save(&sketch_obj_dir);

    // ── Step 2b: Compile user libraries (lib_source_dirs) → libs.a ───────
    // lib_source_dirs is populated by augment_lib_includes() from installed
    // tsukilib packages (DHT, NeoPixel, etc.).  Without compiling these, the
    // linker has the headers but not the implementations → "undefined reference
    // to DHT::begin" etc.  Same logic as avr.rs Step 3.
    //
    // Cache: a SHA-256 fingerprint of every library source file's content plus
    // the compiler flags is stored in .libs_sig.  If it matches and libs.a
    // exists, the compilation step is skipped entirely — subsequent builds with
    // unchanged libraries complete in milliseconds instead of tens of seconds.
    let libs_a = req.build_dir.join(format!("libs-{}.a", arch_tag));
    let lib_obj_dir = req.build_dir.join(format!("lib_objs-{}", arch_tag));
    std::fs::create_dir_all(&lib_obj_dir)?;

    let libs_sig      = compute_libs_sig(&req.lib_source_dirs, &flags_sig);
    let libs_sentinel = lib_obj_dir.join(".libs_sig");
    let libs_fresh    = libs_a.exists()
        && std::fs::read_to_string(&libs_sentinel)
            .map(|s| s.trim() == libs_sig.as_str())
            .unwrap_or(false);

    if !libs_fresh {
        let mut lib_obj_files: Vec<PathBuf> = Vec::new();
        for src_dir in &req.lib_source_dirs {
            let lib_sources: Vec<PathBuf> = std::fs::read_dir(src_dir)
                .into_iter().flatten().flatten()
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .filter(|e| matches!(
                    e.path().extension().and_then(|x| x.to_str()).unwrap_or(""),
                    "cpp" | "c"
                ))
                .map(|e| e.path())
                .collect();

            for src in lib_sources {
                let obj = obj_path(&lib_obj_dir, &src);
                let is_c = src.extension().and_then(|e| e.to_str()) == Some("c");
                let compiler = if is_c { &cc } else { &cxx };

                let mut cmd = Command::new(compiler);
                if !is_c {
                    if let Some(pch_i) = &pch_include { cmd.arg(pch_i); }
                }
                cmd.args(&common_flags);
                if is_c {
                    if !cflags.is_empty() { cmd.args(&cflags); }
                } else {
                    cmd.args(&cxxflags);
                }
                cmd.arg("-c").arg(&src).arg("-o").arg(&obj);

                if req.verbose { eprintln!("  [lib] {}", src.display()); }
                let out = cmd.output().expect("failed to spawn compiler for library");
                if out.status.success() {
                    lib_obj_files.push(obj);
                } else if req.verbose {
                    eprintln!("  [lib warn] {}: {}",
                        src.display(), String::from_utf8_lossy(&out.stderr).trim());
                }
            }
        }
        if !lib_obj_files.is_empty() {
            let mut ar_cmd = Command::new(&ar);
            ar_cmd.args(["rcs", libs_a.to_str().unwrap()]);
            for obj in &lib_obj_files { ar_cmd.arg(obj); }
            let _ = ar_cmd.output();
        }
        // Write sentinel only after a successful (or empty) libs build.
        if libs_a.exists() || req.lib_source_dirs.is_empty() {
            let _ = std::fs::write(&libs_sentinel, &libs_sig);
        }
    } else if req.verbose {
        eprintln!("  [libs] cache hit — skipping library recompilation");
    }

    // ── Link ──────────────────────────────────────────────────────────────
    let elf = req.build_dir.join(format!("{}.elf", req.project_name));
    let linker = if is_esp32 { &cc } else { &cc }; // cc is always the C compiler (gcc)

    let mut link_cmd = Command::new(linker);
    link_cmd.args(&common_flags);

    if !is_esp32 {
        // ── ESP8266 linker ────────────────────────────────────────────────
        // The Arduino build system preprocesses two linker script templates:
        //   eagle.flash.Xm.ld  (MEMORY map, hardcoded per flash size)
        //   eagle.app.v6.common.ld.h  → local.eagle.app.v6.common.ld
        // We generate the second one ourselves using the C preprocessor, then
        // pass the flash script via -T (it INCLUDEs the generated file).

        // Generate local.eagle.app.v6.common.ld in the build directory.
        // Default MMU = 32KB IRAM / 32KB cache (the first boards.txt menu entry).
        let common_ld_h = esp8266_sdk_ld.join("eagle.app.v6.common.ld.h");
        let local_common_ld = req.build_dir.join("local.eagle.app.v6.common.ld");
        if !local_common_ld.exists() && common_ld_h.is_file() {
            let _ = Command::new(&cc)
                .args(["-CC", "-E", "-P",
                       "-DVTABLES_IN_FLASH",
                       "-DMMU_IRAM_SIZE=0x8000",
                       "-DMMU_ICACHE_SIZE=0x8000"])
                .arg(&common_ld_h)
                .arg("-o").arg(&local_common_ld)
                .output();
        }

        // Select flash-size specific linker script
        let flash_ld = match board.flash_kb {
            0..=512  => "eagle.flash.512k.ld",
            513..=1024 => "eagle.flash.1m.ld",
            1025..=2048 => "eagle.flash.2m1m.ld",
            _ => "eagle.flash.4m2m.ld",  // 4MB (D1 mini default)
        };

        // Linker library subdirectory: try NONOSDK22x_190703 then any NONOSDK* dir
        let nonosdk_dir = ["NONOSDK22x_190703", "NONOSDK305",
                           "NONOSDK22x_191122", "NONOSDK22x_191105",
                           "NONOSDK22x_191024", "NONOSDK22x_190313"]
            .iter()
            .map(|d| esp8266_sdk_lib.join(d))
            .find(|p| p.is_dir());

        // Toolchain's newlib/libc lives in <tc_root>/xtensa-lx106-elf/lib/
        let esp8266_tc_lib = sdk.toolchain_bin.parent()
            .map(|p| p.join("xtensa-lx106-elf").join("lib"))
            .filter(|p| p.is_dir());

        // -L search dirs: sdk/ld, sdk/lib, sdk/lib/NONOSDK*, toolchain libc, build_dir
        if esp8266_sdk_ld.is_dir()  { link_cmd.arg(format!("-L{}", esp8266_sdk_ld.display())); }
        if esp8266_sdk_lib.is_dir() { link_cmd.arg(format!("-L{}", esp8266_sdk_lib.display())); }
        if let Some(ref nd) = nonosdk_dir { link_cmd.arg(format!("-L{}", nd.display())); }
        if let Some(ref tl) = esp8266_tc_lib { link_cmd.arg(format!("-L{}", tl.display())); }
        // Build dir must be on -L so the linker can resolve `INCLUDE "local.eagle.app.v6.common.ld"`
        link_cmd.arg(format!("-L{}", req.build_dir.display()));

        link_cmd
            .arg(format!("-T{}", flash_ld))
            .arg("-Wl,--gc-sections")
            .arg("-nostdlib")
            .arg("-Wl,-static")
            .arg("-Wl,--no-check-sections")
            .arg("-u").arg("app_entry")
            .arg("-Wl,-wrap,system_restart_local")
            .arg("-Wl,-wrap,spi_flash_read");
        for obj in &obj_files { link_cmd.arg(obj); }
        // core.a and user libs INSIDE --start-group so dhcps_stop/settimeofday
        // defined in core (LwipDhcpServer-NonOS.cpp, time.cpp) are visible when
        // lwip2-536-feat.a resolves its references with --gc-sections active.
        link_cmd.arg("-Wl,--start-group");
        if core_a.exists() { link_cmd.arg(&core_a); }
        if libs_a.exists() { link_cmd.arg(&libs_a); }
        // ESP8266 SDK libraries (order matters for static linking)
        link_cmd
            .arg("-lhal").arg("-lphy").arg("-lpp").arg("-lnet80211")
            .arg("-llwip2-536-feat")  // lwIP v2 536-MSS with features (default)
            .arg("-lwpa").arg("-lcrypto").arg("-lmain").arg("-lwps")
            .arg("-lbearssl").arg("-lespnow").arg("-lsmartconfig")
            .arg("-lairkiss").arg("-lwpa2").arg("-lstdc++").arg("-lm")
            .arg("-lc").arg("-lgcc")
            .arg("-Wl,--end-group");
    } else if let Some(libs) = idf {
        // ── ESP32 3.x linker (IDF 5.x) ───────────────────────────────────
        // Matches the official Arduino ESP32 platform.txt recipe:
        //   gcc -L{lib} -L{ld} -L{memory_type} -Wl,--wrap=esp_panic_handler
        //       @ld_flags @ld_scripts
        //       -Wl,--start-group {objs} {core.a} @ld_libs -Wl,--end-group
        //       -Wl,-EL -o firmware.elf
        //
        // CRITICAL: @ld_flags and @ld_scripts must come BEFORE --start-group.
        // ALL objects, core.a, and IDF libraries must be INSIDE --start-group/
        // --end-group so circular dependencies between them are resolved.
        // Without this, IDF libs that reference Arduino symbols (or vice versa)
        // cause undefined reference errors.
        //
        // -L{memory_type}: qio_qspi (or dio_qspi) contains flash-mode-specific
        // prebuilt variants of some libraries.  Must be on the search path.
        // -Wl,-EL: force little-endian output (required for Xtensa ESP32).
        // -Wl,--wrap=esp_panic_handler: required by IDF; redirects panic handler.
        let idf_lib = libs.join("lib");
        let idf_ld  = libs.join("ld");

        // NOTE: do NOT pass common_flags (compile flags) to the linker.
        // The ESP32 IDF linker only needs -L paths, @ld_flags, @ld_scripts,
        // and the objects/libs.  Passing -iprefix/-iwithprefixbefore/-MMD etc.
        // from common_flags to GCC's linker driver is harmless but can confuse
        // newer GCC versions.  Use a clean link command instead.
        let mut link_cmd = Command::new(linker);
        if idf_lib.is_dir() { link_cmd.arg(format!("-L{}", idf_lib.display())); }
        if idf_ld.is_dir()  { link_cmd.arg(format!("-L{}", idf_ld.display())); }

        // Memory-type-specific lib dir (qio_qspi = default / quad I/O)
        for mode in &["qio_qspi", "dio_qspi"] {
            let mem_dir = libs.join(mode);
            if mem_dir.is_dir() {
                link_cmd.arg(format!("-L{}", mem_dir.display()));
                break;
            }
        }

        link_cmd.arg("-Wl,--wrap=esp_panic_handler");

        let ld_flags_rsp   = libs.join("flags").join("ld_flags");
        let ld_scripts_rsp = libs.join("flags").join("ld_scripts");
        let ld_libs_rsp    = libs.join("flags").join("ld_libs");
        if ld_flags_rsp.is_file()   { link_cmd.arg(format!("@{}", ld_flags_rsp.display())); }
        if ld_scripts_rsp.is_file() { link_cmd.arg(format!("@{}", ld_scripts_rsp.display())); }

        // All user objects, Arduino core, user libraries, and IDF static libs
        // inside one group so the linker resolves circular dependencies.
        link_cmd.arg("-Wl,--start-group");
        for obj in &obj_files { link_cmd.arg(obj); }
        if core_a.exists() { link_cmd.arg(&core_a); }
        if libs_a.exists() { link_cmd.arg(&libs_a); }
        if ld_libs_rsp.is_file() { link_cmd.arg(format!("@{}", ld_libs_rsp.display())); }
        link_cmd.arg("-Wl,--end-group");
        link_cmd.arg("-Wl,-EL");

        link_cmd.arg("-o").arg(&elf);
        let link_out = link_cmd.output()?;
        if !link_out.status.success() {
            let raw = String::from_utf8_lossy(&link_out.stderr).to_string();
            // Save full stderr for diagnostics (long paths make UI output unreadable)
            let log = req.build_dir.join("link_error.log");
            let _ = std::fs::write(&log, &raw);
            let clean = clean_linker_output(&raw);
            return Err(FlashError::LinkFailed {
                output: format!("{}\n[full log: {}]", clean, log.display()),
            });
        }

        // ── Generate .bin with elf2image (esptool) ────────────────────────
        let bin = req.build_dir.join(format!("{}.bin", req.project_name));
        let esptool = which_esptool();
        if let Some(tool) = &esptool {
            let chip = esp32_variant;
            let _ = Command::new(tool)
                .args(["--chip", chip, "elf2image", "--output"])
                .arg(&bin)
                .arg(&elf)
                .output();
        }
        return Ok(CompileResult {
            hex_path: None,
            bin_path: if bin.exists() { Some(bin) } else { None },
            elf_path: Some(elf),
            uf2_path: None,
            size_info: String::new(),
        });
    } else {
        // ── ESP32 2.x (legacy) ────────────────────────────────────────────
        link_cmd
            .arg(format!("-Wl,-T{}", link_script))
            .arg("-Wl,--gc-sections")
            .arg("-Wl,-Map,/dev/null");
        for obj in &obj_files { link_cmd.arg(obj); }
        if core_a.exists() { link_cmd.arg(&core_a); }
        link_cmd.arg("-lm");
    }
    link_cmd.arg("-o").arg(&elf);

    let link_out = link_cmd.output()?;
    if !link_out.status.success() {
        let raw = String::from_utf8_lossy(&link_out.stderr).to_string();
        let log = req.build_dir.join("link_error.log");
        let _ = std::fs::write(&log, &raw);
        let clean = clean_linker_output(&raw);
        return Err(FlashError::LinkFailed {
            output: format!("{}\n[full log: {}]", clean, log.display()),
        });
    }

    // ── Generate .bin with elf2image (esptool) ────────────────────────────
    let bin = req.build_dir.join(format!("{}.bin", req.project_name));
    let esptool = which_esptool();

    if let Some(tool) = &esptool {
        let chip = if is_esp32 { "esp32" } else { "esp8266" };
        let _ = Command::new(tool)
            .args(["--chip", chip, "elf2image", "--output"])
            .arg(&bin)
            .arg(&elf)
            .output();
    }

    Ok(CompileResult {
        hex_path: None,
        bin_path: if bin.exists() { Some(bin) } else { None },
        elf_path: Some(elf),
        uf2_path: None,
        size_info: String::new(),
    })
}

/// Compile all Arduino core files (.c / .cpp / .S) in `core_src` into `core.a`.
///
/// The Arduino core provides app_main(), setup()/loop() dispatch, HardwareSerial,
/// delay(), millis(), and all other runtime functions that ESP32/ESP8266 firmware
/// requires.  Without a compiled core the linker fails with undefined references
/// for every board.  Results are cached using a sentinel file so repeated builds
/// are instant.
fn build_esp_core(
    cc: &str, cxx: &str, ar: &str,
    core_src: &Path, core_obj_dir: &Path, core_a: &Path,
    common_flags: &[String],
    cflags: &[&str], cxxflags: &[&str],
    core_sig: &str,
    verbose: bool,
) -> Result<()> {
    let sentinel = core_obj_dir.join(".core_sig");
    if let Ok(cached) = std::fs::read_to_string(&sentinel) {
        if cached.trim() == core_sig && core_a.exists() {
            return Ok(());
        }
    }
    if verbose { eprintln!("  [core] building Arduino core…"); }

    // Collect all compilable sources, including subdirectories (apps/, libb64/, etc.)
    let core_sources: Vec<PathBuf> = WalkDir::new(core_src)
        .max_depth(3)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| matches!(
            e.path().extension().and_then(|x| x.to_str()).unwrap_or(""),
            "c" | "cpp" | "S"
        ))
        .map(|e| e.path().to_owned())
        .collect();

    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    let obj_files: Vec<PathBuf> = core_sources.par_iter().map(|src| {
        let obj = obj_path(core_obj_dir, src);
        let _ = std::fs::create_dir_all(obj.parent().unwrap_or(core_obj_dir));

        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let is_c   = ext == "c";
        let is_asm = ext == "S";
        let compiler = if is_c || is_asm { cc } else { cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(common_flags);
        if is_asm {
            cmd.arg("-x").arg("assembler-with-cpp");
        } else if is_c {
            if !cflags.is_empty() { cmd.args(cflags); }
        } else {
            cmd.args(cxxflags);
        }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        let out = cmd.output().expect("compiler spawn failed");
        if !out.status.success() {
            errors.lock().unwrap().push(
                format!("In {}:\n{}", src.display(), String::from_utf8_lossy(&out.stderr))
            );
        }
        obj
    }).collect();

    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(FlashError::CompileFailed { output: errs.join("\n\n") });
    }

    // Archive all compiled objects into core.a
    let mut ar_cmd = Command::new(ar);
    ar_cmd.args(["rcs", core_a.to_str().unwrap()]);
    for obj in &obj_files {
        if obj.exists() { ar_cmd.arg(obj); }
    }
    let ar_out = ar_cmd.output()?;
    if !ar_out.status.success() {
        return Err(FlashError::CompileFailed {
            output: String::from_utf8_lossy(&ar_out.stderr).to_string(),
        });
    }

    let _ = std::fs::write(&sentinel, core_sig);
    Ok(())
}

fn collect_sources(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(WalkDir::new(dir).max_depth(3).into_iter().flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| matches!(
            e.path().extension().and_then(|x| x.to_str()).unwrap_or(""),
            "cpp" | "c" | "ino"
        ))
        .map(|e| e.path().to_owned())
        .collect())
}

fn resolve_tool(bin_dir: &Path, name: &str) -> String {
    if bin_dir.as_os_str().is_empty() { return name.to_owned(); }
    for candidate in &[name, &format!("{}.exe", name)] {
        let p = bin_dir.join(candidate);
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    name.to_owned()
}

/// Compute a stable cache key for the libs.a archive.
///
/// The key covers both the compiler flags (so a flag change invalidates the
/// cache) and the content of every library source file (so editing a library
/// invalidates the cache).  Paths are sorted before hashing so that directory
/// iteration order differences across platforms don't produce spurious misses.
fn compute_libs_sig(lib_source_dirs: &[PathBuf], flags_sig: &str) -> String {
    let mut sig = flags_sig.to_owned();
    let mut all_sources: Vec<PathBuf> = lib_source_dirs.iter()
        .flat_map(|d| {
            std::fs::read_dir(d)
                .into_iter().flatten().flatten()
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .filter(|e| matches!(
                    e.path().extension().and_then(|x| x.to_str()).unwrap_or(""),
                    "cpp" | "c"
                ))
                .map(|e| e.path())
        })
        .collect();
    all_sources.sort();
    for src in &all_sources {
        sig.push_str(&src.to_string_lossy());
        if let Some(h) = super::cache::hash_file(src) {
            sig.push_str(&h);
        }
    }
    super::cache::hash_str(&sig)
}

fn which_esptool() -> Option<String> {
    for candidate in &["esptool.py", "esptool"] {
        if Command::new(candidate).arg("version").output().is_ok() {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Strip the long toolchain binary path that GNU ld/collect2 prepends to every
/// error line.  On Windows with long Arduino/tsuki install paths, the path alone
/// can exceed the terminal line width, hiding the actual diagnostic message.
///
/// Input:  C:/Users/.../xtensa-esp-elf/bin/../lib/gcc/.../bin/ld: cannot find -lfoo
/// Output: ld: cannot find -lfoo
fn clean_linker_output(raw: &str) -> String {
    raw.lines()
        .map(|line| {
            // GNU ld reports its own path at the start of error lines, like:
            //   /long/path/to/bin/ld: <message>
            // We want to keep only the "ld: <message>" part.
            // Strategy: find the last '/' or '\' before the first ': ' and trim.
            if let Some(colon_pos) = line.find(": ") {
                let prefix = &line[..colon_pos];
                // Only strip if the prefix looks like a filesystem path
                if prefix.contains('/') || prefix.contains('\\') {
                    let short = prefix
                        .rsplit(|c| c == '/' || c == '\\')
                        .next()
                        .unwrap_or(prefix);
                    return format!("{}: {}", short, &line[colon_pos + 2..]);
                }
            }
            line.to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}