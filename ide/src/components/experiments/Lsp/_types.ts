/**
 * _types.ts — shared type definitions for the tsuki LSP engine.
 * Imported by LspEngine.ts, tsukilspenginev1, and tsukilspenginev2.
 * LspEngine.ts re-exports everything, so external consumers are unaffected.
 */
import type { Problem } from '@/lib/store'

// ─── LSP mode ──────────────────────────────────────────────────────────────────

/**
 * Controls which diagnostic backend runs in the editor.
 *
 * - `none`    No diagnostics. Default when all LSP toggles are off.
 * - `v1`      Fast regex-based engine (battle-tested, Arduino domain rules).
 * - `v2`      Token-stream engine with scope tracking, unreachable code,
 *             all-paths-return, and unused-symbol detection.
 * - `checker` Delegates to tsuki-core's Rust type checker via the Tauri API.
 *             Most precise; requires the build toolchain to be available.
 * - `hybrid`  v2 for semantic checks + v1 for Arduino-domain-specific rules.
 *             Best balance of precision and coverage. Default when LSP is on.
 */
export type LspMode = 'none' | 'v1' | 'v2' | 'checker' | 'hybrid'

// ─── Tsuki error codes ─────────────────────────────────────────────────────────

/**
 * Tsuki diagnostic error codes, styled after Rust's E#### system.
 * Prefix T = type/semantic checker, prefix S = syntax.
 *
 * Range T0001–T0099: symbol & scope
 * Range T0100–T0199: control flow
 * Range T0200–T0299: type / signature
 * Range T0300–T0399: Arduino domain
 * Range S0001–S0099: syntax
 */
export type TsukiErrorCode =
  | 'T0001'   // variable declared and not used
  | 'T0002'   // import declared and not used
  | 'T0003'   // function defined but never called
  | 'T0004'   // unreachable code
  | 'T0005'   // not all code paths return a value
  | 'T0006'   // undefined symbol / undeclared identifier
  | 'T0007'   // wrong number of arguments
  | 'T0008'   // type mismatch
  | 'T0009'   // variable shadowed in inner scope
  | 'T0010'   // duplicate declaration in same scope
  | 'T0011'   // write-only variable (assigned but never read)
  | 'T0100'   // division by zero
  | 'T0101'   // infinite loop without break or delay
  | 'T0102'   // code after return/break/continue (unreachable)
  | 'T0200'   // missing package declaration
  | 'T0201'   // wrong package name (expected main)
  | 'T0202'   // missing setup() function
  | 'T0203'   // missing loop() function
  | 'T0300'   // Serial used without Serial.Begin
  | 'T0301'   // arduino method arity error
  | 'T0302'   // PWM on non-PWM pin
  | 'T0303'   // delay() inside ISR
  | 'T0304'   // large delay constant
  | 'S0001'   // unbalanced braces
  | 'S0002'   // unbalanced parentheses
  | 'S0003'   // unterminated string literal
  | 'S0004'   // duplicate import
  | 'S0005'   // missing semicolon (C++)
  | 'S0006'   // missing colon (Python)

// ─── Library registry ──────────────────────────────────────────────────────────

export interface LibraryInfo {
  displayName: string
  packageId:   string
  knownBuiltin: boolean
  description: string
  version?: string
}

export const KNOWN_LIBS: Record<string, LibraryInfo> = {
  'arduino':            { displayName: 'arduino',            packageId: 'arduino',            knownBuiltin: true,  description: 'Core Arduino runtime.' },
  'fmt':                { displayName: 'fmt',                packageId: 'fmt',                knownBuiltin: true,  description: 'Standard Go fmt package.' },
  'math':               { displayName: 'math',               packageId: 'math',               knownBuiltin: true,  description: 'Standard Go math package.' },
  'strings':            { displayName: 'strings',            packageId: 'strings',            knownBuiltin: true,  description: 'Standard Go strings package.' },
  'strconv':            { displayName: 'strconv',            packageId: 'strconv',            knownBuiltin: true,  description: 'Standard Go strconv package.' },
  'time':               { displayName: 'time',               packageId: 'time',               knownBuiltin: true,  description: 'Standard Go time package.' },
  'sort':               { displayName: 'sort',               packageId: 'sort',               knownBuiltin: true,  description: 'Standard Go sort package.' },
  'sync':               { displayName: 'sync',               packageId: 'sync',               knownBuiltin: true,  description: 'Standard Go sync package.' },
  'Servo':              { displayName: 'Servo',              packageId: 'Servo',              knownBuiltin: false, description: 'Servo motor control.',                      version: '1.2.1'  },
  'Wire':               { displayName: 'Wire',               packageId: 'Wire',               knownBuiltin: false, description: 'I²C / TWI communication.',                 version: '1.0.0'  },
  'SPI':                { displayName: 'SPI',                packageId: 'SPI',                knownBuiltin: false, description: 'Serial Peripheral Interface.',              version: '1.0.0'  },
  'EEPROM':             { displayName: 'EEPROM',             packageId: 'EEPROM',             knownBuiltin: false, description: 'Read/write onboard EEPROM.',                version: '2.0.0'  },
  'SD':                 { displayName: 'SD',                 packageId: 'SD',                 knownBuiltin: false, description: 'SD card file I/O.',                        version: '1.2.4'  },
  'Ethernet':           { displayName: 'Ethernet',           packageId: 'Ethernet',           knownBuiltin: false, description: 'Ethernet shield.',                          version: '2.0.0'  },
  'LiquidCrystal':      { displayName: 'LiquidCrystal',      packageId: 'LiquidCrystal',      knownBuiltin: false, description: 'HD44780 LCD driver.',                      version: '1.0.7'  },
  'Adafruit_NeoPixel':  { displayName: 'Adafruit NeoPixel',  packageId: 'Adafruit_NeoPixel',  knownBuiltin: false, description: 'WS2812 RGB LED strips.',                   version: '1.12.0' },
  'DHT':                { displayName: 'DHT sensor',         packageId: 'DHT',                knownBuiltin: false, description: 'DHT11/DHT22 sensors.',                     version: '1.4.6'  },
  'IRremote':           { displayName: 'IRremote',           packageId: 'IRremote',           knownBuiltin: false, description: 'Infrared protocol.',                       version: '4.4.0'  },
  'Stepper':            { displayName: 'Stepper',            packageId: 'Stepper',            knownBuiltin: false, description: 'Stepper motor control.',                   version: '1.1.3'  },
  'WiFi':               { displayName: 'WiFi',               packageId: 'WiFi',               knownBuiltin: false, description: 'Arduino WiFi shield.',                     version: '1.2.7'  },
  'WiFiNINA':           { displayName: 'WiFiNINA',           packageId: 'WiFiNINA',           knownBuiltin: false, description: 'u-blox NINA-W10 WiFi.',                    version: '1.8.14' },
  'ESP8266WiFi':        { displayName: 'ESP8266WiFi',        packageId: 'ESP8266WiFi',        knownBuiltin: false, description: 'WiFi for ESP8266.',                        version: '1.0.0'  },
  'FastLED':            { displayName: 'FastLED',            packageId: 'FastLED',            knownBuiltin: false, description: 'High-performance LED control.',            version: '3.7.0'  },
  'U8g2':               { displayName: 'U8g2',               packageId: 'U8g2',               knownBuiltin: false, description: 'OLED/LCD/e-ink driver.',                   version: '2.35.9' },
  'Adafruit_SSD1306':   { displayName: 'Adafruit SSD1306',   packageId: 'Adafruit_SSD1306',   knownBuiltin: false, description: 'SSD1306 OLED display.',                    version: '2.5.10' },
  'Adafruit_GFX':       { displayName: 'Adafruit GFX',       packageId: 'Adafruit_GFX',       knownBuiltin: false, description: 'Core graphics library.',                   version: '1.11.9' },
  'ArduinoJson':        { displayName: 'ArduinoJson',        packageId: 'ArduinoJson',        knownBuiltin: false, description: 'JSON parsing and serialization.',          version: '7.1.0'  },
  'PubSubClient':       { displayName: 'PubSubClient',       packageId: 'PubSubClient',       knownBuiltin: false, description: 'MQTT messaging client.',                   version: '2.8.0'  },
  'Bounce2':            { displayName: 'Bounce2',            packageId: 'Bounce2',            knownBuiltin: false, description: 'Button debounce.',                         version: '2.71.0' },
  'OneWire':            { displayName: 'OneWire',            packageId: 'OneWire',            knownBuiltin: false, description: '1-Wire protocol.',                         version: '2.3.7'  },
  'DallasTemperature':  { displayName: 'DallasTemperature',  packageId: 'DallasTemperature',  knownBuiltin: false, description: 'DS18B20 temperature sensors.',             version: '3.9.0'  },
  'Keypad':             { displayName: 'Keypad',             packageId: 'Keypad',             knownBuiltin: false, description: 'Matrix keypad scanning.',                  version: '3.1.1'  },
  'TaskScheduler':      { displayName: 'TaskScheduler',      packageId: 'TaskScheduler',      knownBuiltin: false, description: 'Cooperative multitasking.',                version: '3.7.0'  },
  'TinyGPSPlus':        { displayName: 'TinyGPS++',          packageId: 'TinyGPSPlus',        knownBuiltin: false, description: 'NMEA GPS parser.',                         version: '1.0.3'  },
  'AsyncTCP':           { displayName: 'AsyncTCP',           packageId: 'AsyncTCP',           knownBuiltin: false, description: 'Async TCP for ESP32.',                     version: '1.1.4'  },
  'ESP_AsyncWebServer': { displayName: 'ESPAsyncWebServer',  packageId: 'ESP_AsyncWebServer', knownBuiltin: false, description: 'Async web server for ESP.',                version: '1.2.3'  },
  'BluetoothSerial':    { displayName: 'BluetoothSerial',    packageId: 'BluetoothSerial',    knownBuiltin: false, description: 'Bluetooth Serial for ESP32.',              version: '2.0.0'  },
}

// ─── Core diagnostic type ─────────────────────────────────────────────────────

export interface Diagnostic extends Problem {
  source: 'lsp' | 'lint' | 'checker'
  endCol?: number
  /** Tsuki/Rust-style error code, e.g. "T0001". Present on v2 and checker diagnostics. */
  code?: TsukiErrorCode
  /**
   * Full Rust-style multi-line diagnostic block, e.g.:
   *   error[T0001]: variable `x` declared and not used
   *     --> main.go:5:4
   *      |
   *    5 |     x := 42
   *      |     ^
   * If present, the BottomPanel renders this verbatim in a mono block.
   */
  rustFormatted?: string
  missingLib?: LibraryInfo & { importName: string }
  quickFix?: { label: string; newText: string }
}

// ─── Engine options ───────────────────────────────────────────────────────────

export interface LspEngineOptions {
  lspGoEnabled:  boolean
  lspCppEnabled: boolean
  lspInoEnabled: boolean
  /** Names of packages already installed in tsuki_package.json (lowercase). */
  installedPackages?: Set<string>
  /**
   * Which diagnostic backend to use.
   * Defaults to 'none' when all lsp*Enabled flags are false,
   * otherwise defaults to 'hybrid'.
   */
  mode?: LspMode
  /** API endpoint for 'checker' mode (e.g. '/api/check'). */
  checkerEndpoint?: string
}

// ─── Supplemental types ───────────────────────────────────────────────────────

export interface WebkitRecommendation {
  importName: string
  line:       number
  message:    string
}

export interface JsxDiagnostic {
  line:     number
  message:  string
  severity: 'error' | 'warning' | 'info'
}

// ─── Rust-style formatter ─────────────────────────────────────────────────────

/**
 * Produces a Rust-compiler-style diagnostic block.
 *
 * error[T0001]: variable `x` declared and not used
 *   --> main.go:5:4
 *    |
 *  5 |     x := 42
 *    |     ^
 */
export function formatRustDiagnostic(
  severity: 'error' | 'warning' | 'info',
  code: TsukiErrorCode,
  message: string,
  file: string,
  line: number,
  col: number,
  sourceLines: string[],
  endCol?: number,
): string {
  const label  = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note'
  const header = `${label}[${code}]: ${message}`
  const arrow  = `  --> ${file}:${line}:${col}`
  const lineStr = String(line)
  const pad     = lineStr.length
  const sep     = ' '.repeat(pad) + ' |'
  const codeLine = sourceLines[line - 1] ?? ''
  const lineDisplay = `${lineStr.padStart(pad)} | ${codeLine}`
  const caretLen = endCol != null ? Math.max(1, endCol - col) : 1
  const caretOff = ' '.repeat(col - 1) + '^'.repeat(caretLen)
  const caretLine = sep + ' ' + caretOff

  return [header, arrow, sep, lineDisplay, caretLine].join('\n')
}