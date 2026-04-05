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
