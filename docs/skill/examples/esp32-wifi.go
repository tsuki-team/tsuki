// examples/esp32-wifi.go
// Connects ESP32 to WiFi and prints the IP address via Serial.
//
// Board: esp32  (install: tsuki-flash platforms install esp32)
// Packages: wifi (tsuki pkg install wifi)
//
// This example demonstrates:
// - Importing the wifi package
// - Using struct-style API (wifi.Client)
// - Reading a string-typed return value

package main

import (
	"arduino"
	"fmt"
	"wifi"
	"time"
)

const SSID     = "MyNetwork"
const PASSWORD = "mysecret"

var client wifi.Client

func setup() {
	arduino.SerialBegin(115200)
	client = wifi.New()
	client.Connect(SSID, PASSWORD)

	fmt.Print("Connecting")
	for client.Status() != wifi.CONNECTED {
		fmt.Print(".")
		time.Delay(500)
	}
	fmt.Println()
	fmt.Print("IP: ")
	fmt.Println(client.LocalIP())
}

func loop() {
	// Main program logic goes here
	time.Delay(1000)
}