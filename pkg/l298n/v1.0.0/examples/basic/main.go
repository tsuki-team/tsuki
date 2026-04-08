package main

import (
	"arduino"
	"l298n"
)

// Motor A: EN=5 (PWM), IN1=6, IN2=7
var motorA = l298n.New(5, 6, 7)

func setup() {
	arduino.Serial.Begin(9600)
	motorA.SetSpeed(200) // 0–255
}

func loop() {
	motorA.Run(l298n.FORWARD)
	arduino.Delay(2000)

	motorA.Stop()
	arduino.Delay(500)

	motorA.Run(l298n.BACKWARD)
	arduino.Delay(2000)

	motorA.Stop()
	arduino.Delay(500)
}