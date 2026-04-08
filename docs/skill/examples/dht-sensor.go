// examples/dht-sensor.go
// Reads temperature and humidity from a DHT22 sensor and prints via Serial.
//
// Board: uno, nano, mega
// Packages: dht (tsuki pkg install dht)
// Wiring: DHT22 DATA pin → pin 2, 10kΩ pull-up to 5V
//
// Transpiles the dht.NewDHT / ReadTemperature / ReadHumidity calls
// using the godotinolib.toml mappings from pkg/dht/

package main

import (
	"arduino"
	"fmt"
	"dht"
	"time"
)

var sensor dht.DHT

func setup() {
	arduino.SerialBegin(9600)
	sensor = dht.NewDHT(2, dht.DHT22)
	sensor.Begin()
}

func loop() {
	temp := sensor.ReadTemperature()
	hum  := sensor.ReadHumidity()

	fmt.Print("Temperature: ")
	fmt.Print(temp)
	fmt.Print("°C  Humidity: ")
	fmt.Print(hum)
	fmt.Println("%")

	time.Delay(2000)
}