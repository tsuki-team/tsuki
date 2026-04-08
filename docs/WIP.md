cat > /home/claude/tsuki/pkg/rtc_ds3231/v1.0.0/godotinolib.toml << 'EOF'
[package]
name        = "rtc_ds3231"
version     = "1.0.0"
description = "DS3231 high-accuracy I2C real-time clock with temperature sensor"
author      = "tsuki-team"
cpp_header  = "RTClib.h"
arduino_lib = "RTClib"
cpp_class   = "RTC_DS3231"

aliases = ["RTC", "DS3231"]

[[function]]
go     = "New"
python = "new"
cpp    = "RTC_DS3231()"

[[function]]
go     = "Begin"
python = "begin"
cpp    = "{0}.begin()"

[[function]]
go     = "Now"
python = "now"
cpp    = "{0}.now()"

[[function]]
go     = "Adjust"
python = "adjust"
cpp    = "{0}.adjust({1})"

[[function]]
go     = "LostPower"
python = "lost_power"
cpp    = "{0}.lostPower()"

[[function]]
go     = "GetTemperature"
python = "get_temperature"
cpp    = "{0}.getTemperature()"

[[function]]
go     = "DateTime"
python = "date_time"
cpp    = "DateTime({0}, {1}, {2}, {3}, {4}, {5})"

[[function]]
go     = "DateTimeNow"
python = "date_time_now"
cpp    = "DateTime(F(__DATE__), F(__TIME__))"

[[function]]
go     = "Timestamp"
python = "timestamp"
cpp    = "{0}.unixtime()"

[[function]]
go     = "Year"
python = "year"
cpp    = "{0}.year()"

[[function]]
go     = "Month"
python = "month"
cpp    = "{0}.month()"

[[function]]
go     = "Day"
python = "day"
cpp    = "{0}.day()"

[[function]]
go     = "Hour"
python = "hour"
cpp    = "{0}.hour()"

[[function]]
go     = "Minute"
python = "minute"
cpp    = "{0}.minute()"

[[function]]
go     = "Second"
python = "second"
cpp    = "{0}.second()"

[[example]]
dir = "examples/basic"
EOF

cat > /home/claude/tsuki/pkg/rtc_ds3231/README.md << 'EOF'
# rtc_ds3231

**DS3231 I2C real-time clock** — wraps the RTClib Arduino library.

High-accuracy RTC with built-in temperature-compensated crystal. Battery-backed. I2C address `0x68`.
EOF

cat > /home/claude/tsuki/pkg/rtc_ds3231/v1.0.0/examples/basic/main.go << 'EOF'
package main

import (
	"arduino"
	"fmt"
	"rtc_ds3231"
)

var rtc = rtc_ds3231.New()

func setup() {
	arduino.Serial.Begin(9600)
	if !rtc.Begin() {
		fmt.Println("RTC not found — check wiring!")
		for {
		}
	}
	if rtc.LostPower() {
		fmt.Println("RTC lost power — setting compile time")
		rtc.Adjust(rtc_ds3231.DateTimeNow())
	}
}

func loop() {
	now := rtc.Now()
	fmt.Print(rtc_ds3231.Year(now))
	fmt.Print("/")
	fmt.Print(rtc_ds3231.Month(now))
	fmt.Print("/")
	fmt.Print(rtc_ds3231.Day(now))
	fmt.Print("  ")
	fmt.Print(rtc_ds3231.Hour(now))
	fmt.Print(":")
	fmt.Print(rtc_ds3231.Minute(now))
	fmt.Print(":")
	fmt.Println(rtc_ds3231.Second(now))
	arduino.Delay(1000)
}
EOF

cat > /home/claude/tsuki/pkg/rtc_ds3231/v1.0.0/examples/basic/tsuki_example.json << 'EOF'
{
  "name": "Read Current Time",
  "description": "Read the current date and time from a DS3231 RTC and print to Serial every second."
}
EOF

cat > /home/claude/tsuki/pkg/rtc_ds3231/v1.0.0/examples/basic/circuit.tsuki-circuit << 'EOF'
{
  "version": "1",
  "name": "DS3231 RTC Basic",
  "board": "uno",
  "description": "DS3231 via I2C — SDA A4, SCL A5. Connect CR2032 battery for backup.",
  "components": [
    { "id": "uno", "type": "arduino_uno", "label": "Arduino Uno", "x": 40, "y": 20, "rotation": 0, "color": "", "props": {} }
  ],
  "wires": [],
  "notes": []
}
EOF

echo "rtc_ds3231 done"
cat > /home/claude/tsuki/pkg/oled_ssd1306/v1.0.0/godotinolib.toml << 'EOF'
[package]
name        = "oled_ssd1306"
version     = "1.0.0"
description = "SSD1306 128x64 OLED display driver (I2C/SPI) via Adafruit library"
author      = "tsuki-team"
cpp_header  = "Adafruit_SSD1306.h"
arduino_lib = "Adafruit SSD1306"
cpp_class   = "Adafruit_SSD1306"

aliases = ["SSD1306", "OLED"]

[[function]]
go     = "New"
python = "new"
cpp    = "Adafruit_SSD1306({0}, {1}, &Wire, -1)"

[[function]]
go     = "Begin"
python = "begin"
cpp    = "{0}.begin(SSD1306_SWITCHCAPVCC, {1})"

[[function]]
go     = "ClearDisplay"
python = "clear_display"
cpp    = "{0}.clearDisplay()"

[[function]]
go     = "Display"
python = "display"
cpp    = "{0}.display()"

[[function]]
go     = "SetTextSize"
python = "set_text_size"
cpp    = "{0}.setTextSize({1})"

[[function]]
go     = "SetTextColor"
python = "set_text_color"
cpp    = "{0}.setTextColor({1})"

[[function]]
go     = "SetCursor"
python = "set_cursor"
cpp    = "{0}.setCursor({1}, {2})"

[[function]]
go     = "Print"
python = "print"
cpp    = "{0}.print({1})"

[[function]]
go     = "Println"
python = "println"
cpp    = "{0}.println({1})"

[[function]]
go     = "DrawPixel"
python = "draw_pixel"
cpp    = "{0}.drawPixel({1}, {2}, {3})"

[[function]]
go     = "DrawRect"
python = "draw_rect"
cpp    = "{0}.drawRect({1}, {2}, {3}, {4}, {5})"

[[function]]
go     = "FillRect"
python = "fill_rect"
cpp    = "{0}.fillRect({1}, {2}, {3}, {4}, {5})"

[[function]]
go     = "DrawCircle"
python = "draw_circle"
cpp    = "{0}.drawCircle({1}, {2}, {3}, {4})"

[[constant]]
go     = "WHITE"
python = "WHITE"
cpp    = "SSD1306_WHITE"

[[constant]]
go     = "BLACK"
python = "BLACK"
cpp    = "SSD1306_BLACK"

[[constant]]
go     = "INVERSE"
python = "INVERSE"
cpp    = "SSD1306_INVERSE"

[[example]]
dir = "examples/basic"
EOF

cat > /home/claude/tsuki/pkg/oled_ssd1306/README.md << 'EOF'
# oled_ssd1306

**SSD1306 128×64 OLED display** — wraps the Adafruit SSD1306 + GFX libraries.

I2C interface (SDA, SCL). Default I2C address `0x3C`. Supports text, shapes, and pixel drawing.
EOF

cat > /home/claude/tsuki/pkg/oled_ssd1306/v1.0.0/examples/basic/main.go << 'EOF'
package main

import (
	"arduino"
	"oled_ssd1306"
)

// New(width, height)  — I2C address 0x3C
var display = oled_ssd1306.New(128, 64)

func setup() {
	arduino.Serial.Begin(9600)
	display.Begin(0x3C)
	display.ClearDisplay()

	display.SetTextSize(1)
	display.SetTextColor(oled_ssd1306.WHITE)
	display.SetCursor(0, 0)
	display.Println("Hello, tsuki!")
	display.SetCursor(0, 16)
	display.Print("OLED SSD1306 ready")
	display.Display()
}

func loop() {
	arduino.Delay(1000)
}
EOF

cat > /home/claude/tsuki/pkg/oled_ssd1306/v1.0.0/examples/basic/tsuki_example.json << 'EOF'
{
  "name": "Hello World OLED",
  "description": "Print text on a 128x64 SSD1306 OLED display via I2C (address 0x3C)."
}
EOF

cat > /home/claude/tsuki/pkg/oled_ssd1306/v1.0.0/examples/basic/circuit.tsuki-circuit << 'EOF'
{
  "version": "1",
  "name": "SSD1306 OLED Basic",
  "board": "uno",
  "description": "SSD1306 OLED via I2C — SDA A4, SCL A5.",
  "components": [
    { "id": "uno", "type": "arduino_uno", "label": "Arduino Uno", "x": 40, "y": 20, "rotation": 0, "color": "", "props": {} }
  ],
  "wires": [],
  "notes": []
}
EOF

echo "oled_ssd1306 done"
cat > /home/claude/tsuki/pkg/max7219/v1.0.0/godotinolib.toml << 'EOF'
[package]
name        = "max7219"
version     = "1.0.0"
description = "MAX7219 8x8 LED matrix and 7-segment display driver (SPI)"
author      = "tsuki-team"
cpp_header  = "LedControl.h"
arduino_lib = "LedControl"
cpp_class   = "LedControl"

aliases = ["MAX7219", "LedControl"]

[[function]]
go     = "New"
python = "new"
cpp    = "LedControl({0}, {1}, {2}, {3})"

[[function]]
go     = "Shutdown"
python = "shutdown"
cpp    = "{0}.shutdown({1}, {2})"

[[function]]
go     = "SetIntensity"
python = "set_intensity"
cpp    = "{0}.setIntensity({1}, {2})"

[[function]]
go     = "ClearDisplay"
python = "clear_display"
cpp    = "{0}.clearDisplay({1})"

[[function]]
go     = "SetLed"
python = "set_led"
cpp    = "{0}.setLed({1}, {2}, {3}, {4})"

[[function]]
go     = "SetRow"
python = "set_row"
cpp    = "{0}.setRow({1}, {2}, {3})"

[[function]]
go     = "SetColumn"
python = "set_column"
cpp    = "{0}.setColumn({1}, {2}, {3})"

[[function]]
go     = "SetDigit"
python = "set_digit"
cpp    = "{0}.setDigit({1}, {2}, {3}, {4})"

[[function]]
go     = "SetChar"
python = "set_char"
cpp    = "{0}.setChar({1}, {2}, {3}, {4})"

[[example]]
dir = "examples/basic"
EOF

cat > /home/claude/tsuki/pkg/max7219/README.md << 'EOF'
# max7219

**MAX7219 8×8 LED matrix / 7-segment driver** — wraps the LedControl Arduino library.

SPI interface (DATA, CLK, CS). Supports chaining multiple MAX7219 modules.
EOF

cat > /home/claude/tsuki/pkg/max7219/v1.0.0/examples/basic/main.go << 'EOF'
package main

import (
	"arduino"
	"max7219"
)

// LedControl(dataPin, clkPin, csPin, numDevices)
var matrix = max7219.New(11, 13, 10, 1)

func setup() {
	matrix.Shutdown(0, false)    // wake up
	matrix.SetIntensity(0, 8)   // brightness 0–15
	matrix.ClearDisplay(0)
}

func loop() {
	// Draw a smiley on the 8x8 matrix
	matrix.SetRow(0, 0, 0b00111100)
	matrix.SetRow(0, 1, 0b01000010)
	matrix.SetRow(0, 2, 0b10100101)
	matrix.SetRow(0, 3, 0b10000001)
	matrix.SetRow(0, 4, 0b10100101)
	matrix.SetRow(0, 5, 0b10011001)
	matrix.SetRow(0, 6, 0b01000010)
	matrix.SetRow(0, 7, 0b00111100)
	arduino.Delay(2000)
	matrix.ClearDisplay(0)
	arduino.Delay(500)
}
EOF

cat > /home/claude/tsuki/pkg/max7219/v1.0.0/examples/basic/tsuki_example.json << 'EOF'
{
  "name": "8x8 Matrix Smiley",
  "description": "Draw a smiley face on a MAX7219 8x8 LED matrix. DATA=D11, CLK=D13, CS=D10."
}
EOF

cat > /home/claude/tsuki/pkg/max7219/v1.0.0/examples/basic/circuit.tsuki-circuit << 'EOF'
{
  "version": "1",
  "name": "MAX7219 Matrix",
  "board": "uno",
  "description": "MAX7219 8x8 matrix — DATA D11, CLK D13, CS D10.",
  "components": [
    { "id": "uno",  "type": "arduino_uno", "label": "Arduino Uno", "x": 40, "y": 20, "rotation": 0, "color": "", "props": {} }
  ],
  "wires": [],
  "notes": []
}
EOF

echo "max7219 done"
cat > /home/claude/tsuki/pkg/ds18b20/v1.0.0/examples/basic/main.go << 'EOF'
package main

import (
	"arduino"
	"ds18b20"
	"fmt"
)

const dataPin = 2

var oneWire = arduino.OneWire(dataPin)
var sensors = ds18b20.New(oneWire)

func setup() {
	arduino.Serial.Begin(9600)
	sensors.Begin()
	fmt.Println("DS18B20 ready — sensors found:", sensors.GetDeviceCount())
}

func loop() {
	sensors.RequestTemperatures()
	temp := sensors.GetTempCByIndex(0)

	if temp == ds18b20.DEVICE_DISCONNECTED_C {
		fmt.Println("Error: sensor not found!")
	} else {
		fmt.Println("Temperature:", temp, "C")
	}

	arduino.Delay(1000)
}
EOF

cat > /home/claude/tsuki/pkg/ds18b20/v1.0.0/examples/basic/tsuki_example.json << 'EOF'
{
  "name": "Basic Temperature Read",
  "description": "Read temperature from a DS18B20 sensor on D2 and print to Serial. Requires 4.7kΩ pull-up on data line."
}
EOF

cat > /home/claude/tsuki/pkg/ds18b20/v1.0.0/examples/basic/circuit.tsuki-circuit << 'EOF'
{
  "version": "1",
  "name": "DS18B20 Basic",
  "board": "uno",
  "description": "DS18B20 on D2 with 4.7kΩ pull-up to 5V.",
  "components": [
    { "id": "uno",  "type": "arduino_uno", "label": "Arduino Uno", "x": 40,  "y": 20,  "rotation": 0, "color": "", "props": {} },
    { "id": "vcc1", "type": "vcc_node",    "label": "5V",          "x": 220, "y": 30,  "rotation": 0, "color": "", "props": {} },
    { "id": "gnd1", "type": "gnd_node",    "label": "GND",         "x": 380, "y": 220, "rotation": 0, "color": "", "props": {} },
    { "id": "r1",   "type": "resistor",    "label": "4.7kΩ",       "x": 220, "y": 70,  "rotation": 0, "color": "", "props": { "ohms": 4700 } }
  ],
  "wires": [
    { "id": "w1", "fromComp": "vcc1", "fromPin": "5v", "toComp": "r1",   "toPin": "pin1", "color": "#ef4444", "waypoints": [] },
    { "id": "w2", "fromComp": "r1",   "fromPin": "pin2", "toComp": "uno", "toPin": "D2",  "color": "#3b82f6", "waypoints": [] },
    { "id": "w3", "fromComp": "uno",  "fromPin": "GND",  "toComp": "gnd1","toPin": "gnd", "color": "#6b7280", "waypoints": [] }
  ],
  "notes": []
}
EOF

echo "ds18b20 examples done"
cat > /home/claude/tsuki/pkg/ds18b20/v1.0.0/godotinolib.toml << 'EOF'
[package]
name        = "ds18b20"
version     = "1.0.0"
description = "DS18B20 OneWire digital temperature sensor"
author      = "tsuki-team"
cpp_header  = "DallasTemperature.h"
arduino_lib = "DallasTemperature"
cpp_class   = "DallasTemperature"

aliases = ["DS18B20", "DallasTemp"]

[[function]]
go     = "New"
python = "new"
cpp    = "DallasTemperature(&{0})"

[[function]]
go     = "Begin"
python = "begin"
cpp    = "{0}.begin()"

[[function]]
go     = "RequestTemperatures"
python = "request_temperatures"
cpp    = "{0}.requestTemperatures()"

[[function]]
go     = "GetTempCByIndex"
python = "get_temp_c_by_index"
cpp    = "{0}.getTempCByIndex({1})"

[[function]]
go     = "GetTempFByIndex"
python = "get_temp_f_by_index"
cpp    = "{0}.getTempFByIndex({1})"

[[function]]
go     = "GetDeviceCount"
python = "get_device_count"
cpp    = "{0}.getDeviceCount()"

[[function]]
go     = "IsConnected"
python = "is_connected"
cpp    = "{0}.isConnected({1})"

[[constant]]
go     = "DEVICE_DISCONNECTED_C"
python = "DEVICE_DISCONNECTED_C"
cpp    = "DEVICE_DISCONNECTED_C"

[[example]]
dir = "examples/basic"
EOF

cat > /home/claude/tsuki/pkg/ds18b20/README.md << 'EOF'
# ds18b20

**DS18B20 OneWire digital temperature sensor** — wraps the DallasTemperature + OneWire Arduino libraries.

Supports multiple sensors on a single data wire. Requires a 4.7kΩ pull-up resistor on the data line.
EOF
for board in nano_every stm32_bluepill pico teensy40; do
  mkdir -p /home/claude/tsuki/pkg/pkg/boards/$board
done

cat > /home/claude/tsuki/pkg/pkg/boards/nano_every/README.md << 'EOF'
# Arduino Nano Every

**MCU:** ATmega4809 · **Arch:** megaAVR · **Flash:** 48K · **RAM:** 6K · **Voltage:** 5V / 3.3V

The Nano Every is the updated Nano with the newer ATmega4809 chip and more flash/RAM than the classic Nano. Same compact DIP form factor, USB-C connector.

## Pin count
- 14 digital I/O (5 PWM)
- 8 analog inputs (A0–A7)
- 1 UART, 1 SPI, 1 I2C
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/stm32_bluepill/README.md << 'EOF'
# STM32 Blue Pill (STM32F103C8T6)

**MCU:** STM32F103C8T6 · **Arch:** ARM Cortex-M3 · **Flash:** 64K · **RAM:** 20K · **Clock:** 72MHz · **Voltage:** 3.3V

The most popular STM32 board. Requires STM32duino core. Uses ST-Link or serial (via BOOT0 jumper) for flashing.

## Pin count
- 32 GPIO
- 2 SPI, 2 I2C, 3 UART
- 10 ADC channels (12-bit)
- 4 timers
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/pico/README.md << 'EOF'
# Raspberry Pi Pico

**MCU:** RP2040 · **Arch:** dual-core ARM Cortex-M0+ · **Flash:** 2MB · **RAM:** 264K · **Clock:** 133MHz · **Voltage:** 3.3V

The official Raspberry Pi microcontroller board. Drag-and-drop UF2 flashing, programmable I/O (PIO), and excellent community support.

## Pin count
- 26 GPIO (23 digital, 3 ADC)
- 2 SPI, 2 I2C, 2 UART
- 16 PWM channels
- USB 1.1 device/host
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/teensy40/README.md << 'EOF'
# Teensy 4.0

**MCU:** NXP iMXRT1062 · **Arch:** ARM Cortex-M7 · **Flash:** 1984K · **RAM:** 1024K · **Clock:** 600MHz · **Voltage:** 3.3V

Fastest Arduino-compatible board available. Requires Teensyduino add-on. Exceptional for DSP, audio, and high-speed I/O.

## Pin count
- 40 digital I/O (31 PWM)
- 14 analog inputs (12-bit ADC)
- 7 serial ports, 3 SPI, 3 I2C
- Native USB
EOF

echo "READMEs done"
cat > /home/claude/tsuki/pkg/teensy40/v1.0.0/board.toml << 'EOF'
[board]
id             = "teensy40"
name           = "Teensy 4.0"
version        = "1.0.0"
fqbn           = "teensy:avr:teensy40"
variant        = "teensy40"
flash_kb       = 1984
ram_kb         = 1024
toolchain_type = "sam"
defines        = "ARDUINO_TEENSY40,ARDUINO_ARCH_ARM"

[sam]
mcu        = "imxrt1062"
f_cpu      = 600000000
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/teensy40/v1.0.0/tsuki_board.toml << 'EOF'
[board]
id          = "teensy40"
name        = "Teensy 4.0"
fqbn        = "teensy:avr:teensy40"
variant     = "teensy40"
flash_kb    = 1984
ram_kb      = 1024
description = "Teensy 4.0 — NXP iMXRT1062 ARM Cortex-M7, 600MHz, 1984K flash, 1024K RAM"
author      = "tsuki-team"
version     = "1.0.0"

[toolchain]
type        = "sam"
mcu         = "imxrt1062"
f_cpu       = 600000000

[defines]
values = ["ARDUINO_TEENSY40", "ARDUINO_ARCH_ARM", "__IMXRT1062__"]
EOF

echo "teensy40 done"
cat > /home/claude/tsuki/pkg/pico/v1.0.0/board.toml << 'EOF'
[board]
id             = "pico"
name           = "Raspberry Pi Pico"
version        = "1.0.0"
fqbn           = "rp2040:rp2040:rpipico"
variant        = "rpipico"
flash_kb       = 2048
ram_kb         = 264
toolchain_type = "rp2040"
defines        = "ARDUINO_RASPBERRY_PI_PICO,ARDUINO_ARCH_RP2040"

EOF

cat > /home/claude/tsuki/pkg/pkg/boards/pico/v1.0.0/tsuki_board.toml << 'EOF'
[board]
id          = "pico"
name        = "Raspberry Pi Pico"
fqbn        = "rp2040:rp2040:rpipico"
variant     = "rpipico"
flash_kb    = 2048
ram_kb      = 264
description = "Raspberry Pi Pico — RP2040 dual-core ARM Cortex-M0+, 133MHz, 2MB flash, 264K RAM"
author      = "tsuki-team"
version     = "1.0.0"

[toolchain]
type        = "rp2040"

[defines]
values = ["ARDUINO_RASPBERRY_PI_PICO", "ARDUINO_ARCH_RP2040", "PICO_RP2040"]
EOF

echo "pico done"
cat > /home/claude/tsuki/pkg/stm32_bluepill/v1.0.0/board.toml << 'EOF'
[board]
id             = "stm32_bluepill"
name           = "STM32 Blue Pill"
version        = "1.0.0"
fqbn           = "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"
variant        = "bluepill_f103c8"
flash_kb       = 64
ram_kb         = 20
toolchain_type = "sam"
defines        = "ARDUINO_BLUEPILL_F103C8,ARDUINO_ARCH_STM32"

[sam]
mcu        = "stm32f103c8t6"
f_cpu      = 72000000
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/stm32_bluepill/v1.0.0/tsuki_board.toml << 'EOF'
[board]
id          = "stm32_bluepill"
name        = "STM32 Blue Pill"
fqbn        = "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"
variant     = "bluepill_f103c8"
flash_kb    = 64
ram_kb      = 20
description = "STM32 Blue Pill — STM32F103C8T6 ARM Cortex-M3, 72MHz, 64K flash, 20K RAM, 3.3V"
author      = "tsuki-team"
version     = "1.0.0"

[toolchain]
type        = "sam"
mcu         = "stm32f103c8t6"
f_cpu       = 72000000

[defines]
values = ["ARDUINO_BLUEPILL_F103C8", "ARDUINO_ARCH_STM32", "STM32F1xx"]
EOF

echo "stm32_bluepill done"
cat > /home/claude/tsuki/pkg/nano_every/v1.0.0/board.toml << 'EOF'
[board]
id             = "nano_every"
name           = "Arduino Nano Every"
version        = "1.0.0"
fqbn           = "arduino:megaavr:nanoevery"
variant        = "nanoevery"
flash_kb       = 48
ram_kb         = 6
toolchain_type = "avr"
defines        = "ARDUINO_AVR_NANO_EVERY,ARDUINO_ARCH_MEGAAVR"

[avr]
mcu        = "atmega4809"
f_cpu      = 16000000
programmer = "arduino"
baud       = 115200
EOF

cat > /home/claude/tsuki/pkg/pkg/boards/nano_every/v1.0.0/tsuki_board.toml << 'EOF'
[board]
id          = "nano_every"
name        = "Arduino Nano Every"
fqbn        = "arduino:megaavr:nanoevery"
variant     = "nanoevery"
flash_kb    = 48
ram_kb      = 6
description = "Arduino Nano Every — AVR ATmega4809, 48K flash, 6K RAM, 5V/16MHz"
author      = "tsuki-team"
version     = "1.0.0"

[toolchain]
type        = "avr"
mcu         = "atmega4809"
f_cpu       = 16000000
programmer  = "arduino"
baud        = 115200

[defines]
values = ["ARDUINO_AVR_NANO_EVERY", "ARDUINO_ARCH_MEGAAVR"]
EOF

echo "nano_every done"
# Crear estructura de directorios para los nuevos boards
cd /home/claude/tsuki

# Boards nuevos (nano_every, stm32_bluepill, pico, teensy40)
for id in nano_every stm32_bluepill pico teensy40; do
  mkdir -p pkg/$id/v1.0.0
  mkdir -p pkg/pkg/boards/$id/v1.0.0
done

# Libs nuevas
for lib in ds18b20 max7219 oled_ssd1306 rtc_ds3231 hcsr04 l298n nrf24l01 sd_card midi tft_ili9341; do
  mkdir -p pkg/$lib/v1.0.0/examples/basic
done

echo "Dirs created"