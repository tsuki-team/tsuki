// examples/blink.go
// The simplest tsuki program — blinks the built-in LED on any Arduino board.
//
// Board: uno, nano, mega, leonardo, due, pico, etc.
// Packages: none
//
// Transpiles to:
//   #include <Arduino.h>
//   void setup() { pinMode(LED_BUILTIN, OUTPUT); }
//   void loop() {
//     digitalWrite(LED_BUILTIN, HIGH); delay(500);
//     digitalWrite(LED_BUILTIN, LOW);  delay(500);
//   }

package main

import "arduino"

func setup() {
	arduino.PinMode(arduino.LED_BUILTIN, arduino.OUTPUT)
}

func loop() {
	arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.HIGH)
	arduino.Delay(500)
	arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.LOW)
	arduino.Delay(500)
}