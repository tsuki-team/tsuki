import (
	"arduino"
	"fmt"
	"hcsr04"
)

const trigPin = 9
const echoPin = 10

var sensor = hcsr04.New(trigPin, echoPin)

func setup() {
	arduino.Serial.Begin(9600)
	fmt.Println("HC-SR04 ready")
}

func loop() {
	dist := sensor.DistCm()
	fmt.Println("Distance:", dist, "cm")
	arduino.Delay(500)
}