/**
 * boardPackages.ts
 * ─────────────────
 * Type definitions for the board package registry format.
 *
 * All data comes from the registry's packages.json (fetched at runtime).
 * Nothing is hardcoded here — the IDE reads everything from the package
 * files: tsuki_board.toml, sandbox.json, ports.json, README.md.
 *
 * Registry JSON structure:
 * {
 *   "branch":    "main",
 *   "platforms": { [id]: RegistryPlatform },
 *   "packages":  { [id]: RegistryBoard    }
 * }
 */

// ── Registry types (mirror the packages.json schema) ─────────────────────────

/** A platform group (e.g. "esp32", "esp8266"). Groups one or more boards. */
export interface RegistryPlatform {
  display_name: string
  icon:         'wifi' | 'circuit' | 'cpu' | 'box'
  description:  string
  core_package: string          // arduino-cli core identifier, e.g. "esp32:esp32"
  size_mb:      number
  boards:       string[]        // board IDs in this platform
}

/** A single board entry from packages.json */
export interface RegistryBoard {
  type:        'board'
  platform_id: string           // which RegistryPlatform this board belongs to
  description: string
  author:      string
  arch:        string
  category:    string
  latest:      string
  versions:    Record<string, string>  // version → toml URL
}

/** Top-level structure of packages.json */
export interface BoardRegistry {
  branch:    string
  platforms: Record<string, RegistryPlatform>
  packages:  Record<string, RegistryBoard>
}

// ── Derived view used by the IDE sidebar ──────────────────────────────────────

/** A platform with its board list resolved, used by PlatformsSidebar. */
export interface ResolvedPlatform extends RegistryPlatform {
  id:        string
  installed: boolean
  boards_detail: ResolvedBoard[]
}

/** A board with its registry data and install state, used by PlatformsSidebar. */
export interface ResolvedBoard extends RegistryBoard {
  id:        string
  installed: boolean
  toml_url:  string    // URL of latest tsuki_board.toml
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch and parse a registry packages.json. Returns null on fetch failure. */
export async function fetchBoardRegistry(url: string): Promise<BoardRegistry | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as BoardRegistry
  } catch {
    return null
  }
}

/**
 * Build a list of ResolvedPlatform from a BoardRegistry and a set of installed board IDs.
 * Boards that have no matching platform entry are grouped under their arch name.
 */
export function resolvePlatforms(
  registry: BoardRegistry,
  installedBoardIds: string[],
): ResolvedPlatform[] {
  const installed = new Set(installedBoardIds)

  // Platforms explicitly declared in the registry
  const resolved: ResolvedPlatform[] = Object.entries(registry.platforms ?? {}).map(
    ([pid, plat]) => {
      const boards_detail: ResolvedBoard[] = (plat.boards ?? [])
        .map(bid => {
          const board = registry.packages[bid]
          if (!board) return null
          return {
            id:        bid,
            installed: installed.has(bid),
            toml_url:  board.versions[board.latest] ?? '',
            ...board,
          } satisfies ResolvedBoard
        })
        .filter((b): b is ResolvedBoard => b !== null)

      return {
        id:           pid,
        installed:    boards_detail.some(b => installed.has(b.id)),
        boards_detail,
        ...plat,
      } satisfies ResolvedPlatform
    }
  )

  // Any boards not covered by a declared platform → auto-group by arch
  const coveredBoardIds = new Set(resolved.flatMap(p => p.boards))
  const uncovered = Object.entries(registry.packages ?? {}).filter(
    ([bid]) => !coveredBoardIds.has(bid)
  )
  if (uncovered.length > 0) {
    const byArch: Record<string, ResolvedBoard[]> = {}
    for (const [bid, board] of uncovered) {
      const arch = board.platform_id || board.arch || 'unknown'
      if (!byArch[arch]) byArch[arch] = []
      byArch[arch].push({
        id: bid, installed: installed.has(bid),
        toml_url: board.versions[board.latest] ?? '',
        ...board,
      })
    }
    for (const [arch, boards] of Object.entries(byArch)) {
      resolved.push({
        id:           arch,
        display_name: arch.toUpperCase(),
        icon:         arch.includes('esp') ? 'wifi' : 'circuit',
        description:  `${arch} boards`,
        core_package: '',
        size_mb:      0,
        boards:       boards.map(b => b.id),
        installed:    boards.some(b => b.installed),
        boards_detail: boards,
      })
    }
  }

  return resolved
}


// ── Legacy static board-package catalogue (used by SettingsScreen) ─────────────
// These represent installable board support packages (toolchain + core bundles).
// The UI in SettingsScreen consumes this directly; the new registry types above
// are used by PlatformsSidebar which fetches data at runtime.

export type BoardPkgIconName = 'CircuitBoard' | 'Wifi' | 'Cpu' | 'Box'

export interface BoardPkg {
  id:               string
  name:             string
  iconName:         BoardPkgIconName
  version:          string
  size:             string
  arch:             string
  desc:             string
  boards:           string[]
  precompileScript: string[]
}

export const BOARD_PACKAGES: BoardPkg[] = [
  {
    id:       'avr',
    name:     'AVR (Arduino)',
    iconName: 'CircuitBoard',
    version:  '7.3.0',
    size:     '~62 MB',
    arch:     'AVR',
    desc:     'GCC toolchain and Arduino core for all ATmega/ATtiny boards: Uno, Nano, Mega, Leonardo, Pro Mini, and more.',
    boards:   ['uno', 'nano', 'nano_old', 'mega', 'leonardo', 'micro', 'pro_mini_5v', 'pro_mini_3v3', 'due'],
    precompileScript: [
      '▶  Descargando avr-gcc 7.3.0 …',
      '✔  avr-gcc extraído en ~/.tsuki/toolchains/avr',
      '▶  Descargando Arduino AVR Core 1.8.6 …',
      '✔  Arduino AVR Core extraído',
      '▶  Precompilando core.a …',
      '✔  core.a listo →',
    ],
  },
  {
    id:       'esp32',
    name:     'ESP32',
    iconName: 'Wifi',
    version:  '5.4.0',
    size:     '~420 MB',
    arch:     'ESP32',
    desc:     'Xtensa GCC toolchain and ESP-IDF Arduino core for all ESP32 variants: ESP32, ESP32-S2, ESP32-C3, and more.',
    boards:   ['esp32', 'esp32s2', 'esp32c3'],
    precompileScript: [
      '▶  Descargando xtensa-esp32-gcc 12.2.0 …',
      '✔  xtensa-esp32-gcc extraído en ~/.tsuki/toolchains/esp32',
      '▶  Descargando ESP32 Arduino Core 3.0.7 …',
      '✔  ESP32 Arduino Core extraído',
      '▶  Precompilando sdk_config …',
      '▶  Precompilando libfreertos.a …',
      '✔  Core ESP32 listo →',
    ],
  },
  {
    id:       'esp8266',
    name:     'ESP8266',
    iconName: 'Wifi',
    version:  '3.1.2',
    size:     '~180 MB',
    arch:     'ESP8266',
    desc:     'Tensilica L106 toolchain and ESP8266 Arduino core for NodeMCU, Wemos D1 Mini, and other ESP8266 boards.',
    boards:   ['esp8266', 'nodemcu', 'd1_mini', 'lolin_d1_mini'],
    precompileScript: [
      '▶  Descargando xtensa-lx106-gcc 10.3.0 …',
      '✔  xtensa-lx106-gcc extraído en ~/.tsuki/toolchains/esp8266',
      '▶  Descargando ESP8266 Arduino Core 3.1.2 …',
      '✔  ESP8266 Arduino Core extraído',
      '▶  Precompilando core.a …',
      '✔  Core ESP8266 listo →',
    ],
  },
  {
    id:       'rp2040',
    name:     'RP2040 (Pico)',
    iconName: 'Cpu',
    version:  '4.0.1',
    size:     '~290 MB',
    arch:     'RP2040',
    desc:     'ARM GCC toolchain and Raspberry Pi Pico Arduino core for the RP2040 microcontroller.',
    boards:   ['pico'],
    precompileScript: [
      '▶  Descargando arm-none-eabi-gcc 13.2.1 …',
      '✔  arm-none-eabi-gcc extraído en ~/.tsuki/toolchains/rp2040',
      '▶  Descargando Pico Arduino Core 4.0.1 …',
      '✔  Pico Arduino Core extraído',
      '▶  Precompilando core.a …',
      '✔  Core RP2040 listo →',
    ],
  },
]