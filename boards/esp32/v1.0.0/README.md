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
