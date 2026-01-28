package testutil

import (
	"fmt"
	"math/rand"
	"time"
)

// Aircraft type codes commonly seen
var aircraftTypes = []string{
	"A320", "A321", "A319", "A330", "A350", "A380",
	"B737", "B738", "B739", "B744", "B747", "B752", "B763", "B772", "B77W", "B787", "B788", "B789",
	"E170", "E175", "E190", "E195",
	"CRJ2", "CRJ7", "CRJ9",
	"DH8D", "AT76",
	"C172", "C208", "PC12", "P180",
}

// Military aircraft types
var militaryTypes = []string{
	"C130", "C17", "C5", "KC10", "KC135", "KC46",
	"F15", "F16", "F18", "F22", "F35",
	"B1", "B2", "B52",
	"E3", "E8", "RC135", "U2",
	"V22", "H60", "H47", "AH64",
	"A10", "AC130",
}

// Airline callsign prefixes
var callsignPrefixes = []string{
	"AAL", "UAL", "DAL", "SWA", "JBU", "ASA", "FDX", "UPS",
	"BAW", "DLH", "AFR", "KLM", "SAS", "ACA", "QFA",
	"ANA", "JAL", "CPA", "SIA", "UAE", "QTR", "ELY",
}

// Military callsign prefixes
var militaryCallsigns = []string{
	"RCH", "DUKE", "VADER", "COBRA", "HAVOC", "TOPGUN",
	"REACH", "BOLT", "WOLF", "VIPER", "TALON", "RAPTOR",
	"NIGHT", "CHAOS", "TITAN", "GOOSE", "MAVERICK", "ICEMAN",
}

// ACARS message labels
var acarsLabels = []string{
	"H1", "Q0", "QA", "QB", "QC", "QD", "QE", "QF", "QG", "QH", "QK", "QL", "QM", "QN", "QP", "QQ", "QR", "QS", "QT", "QU",
	"_d", "5U", "5Y", "5Z", "80", "83", "8D", "8E",
	"SA", "SQ", "B0", "B1", "B2", "B3", "B4", "B5", "B6",
}

// seededRand provides a deterministic random source when needed
var seededRand = rand.New(rand.NewSource(time.Now().UnixNano()))

// GenerateAircraft generates the specified number of random aircraft
func GenerateAircraft(count int) []Aircraft {
	aircraft := make([]Aircraft, count)
	for i := 0; i < count; i++ {
		aircraft[i] = generateRandomAircraft()
	}
	return aircraft
}

// generateRandomAircraft creates a single random aircraft
func generateRandomAircraft() Aircraft {
	hex := generateHex()
	lat := randomFloat(25.0, 49.0)      // Continental US latitude range
	lon := randomFloat(-125.0, -67.0)   // Continental US longitude range
	alt := randomInt(1000, 45000)
	gs := randomFloat(100.0, 550.0)
	track := randomFloat(0.0, 359.9)
	baroRate := randomFloat(-2000.0, 2000.0)
	rssi := randomFloat(-30.0, -5.0)
	distance := randomFloat(0.5, 200.0)
	bearing := randomFloat(0.0, 359.9)

	callsign := generateCallsign()
	squawk := generateSquawk()
	acType := aircraftTypes[seededRand.Intn(len(aircraftTypes))]

	return Aircraft{
		Hex:      hex,
		Flight:   callsign,
		Lat:      &lat,
		Lon:      &lon,
		AltBaro:  &alt,
		Alt:      &alt,
		GS:       &gs,
		Track:    &track,
		BaroRate: &baroRate,
		RSSI:     &rssi,
		Squawk:   squawk,
		Type:     acType,
		Military: false,
		Distance: &distance,
		Bearing:  &bearing,
	}
}

// GenerateMilitaryAircraft generates a random military aircraft
func GenerateMilitaryAircraft() Aircraft {
	ac := generateRandomAircraft()
	ac.Military = true
	ac.Type = militaryTypes[seededRand.Intn(len(militaryTypes))]
	ac.Flight = militaryCallsigns[seededRand.Intn(len(militaryCallsigns))] + fmt.Sprintf("%02d", seededRand.Intn(100))
	ac.Hex = "AE" + generateHex()[2:] // US military hex range
	return ac
}

// GenerateEmergencyAircraft generates an aircraft with an emergency squawk code
func GenerateEmergencyAircraft(squawk string) Aircraft {
	ac := generateRandomAircraft()

	// Validate squawk is a valid emergency code
	validSquawks := map[string]bool{
		"7500": true, // Hijack
		"7600": true, // Radio failure
		"7700": true, // General emergency
	}

	if !validSquawks[squawk] {
		squawk = "7700" // Default to general emergency
	}

	ac.Squawk = squawk
	return ac
}

// NewAircraftAt creates an aircraft at a specific position
func NewAircraftAt(lat, lon float64) Aircraft {
	ac := generateRandomAircraft()
	ac.Lat = &lat
	ac.Lon = &lon

	// Recalculate distance and bearing from a hypothetical center
	// (for testing, we'll use a simple placeholder)
	distance := 50.0
	bearing := 180.0
	ac.Distance = &distance
	ac.Bearing = &bearing

	return ac
}

// AircraftWithCallsign creates an aircraft with a specific callsign
func AircraftWithCallsign(callsign string) Aircraft {
	ac := generateRandomAircraft()
	ac.Flight = callsign
	return ac
}

// AircraftWithSquawk creates an aircraft with a specific squawk code
func AircraftWithSquawk(squawk string) Aircraft {
	ac := generateRandomAircraft()
	ac.Squawk = squawk
	return ac
}

// AircraftWithHex creates an aircraft with a specific hex code
func AircraftWithHex(hex string) Aircraft {
	ac := generateRandomAircraft()
	ac.Hex = hex
	return ac
}

// AircraftWithType creates an aircraft with a specific type code
func AircraftWithType(acType string) Aircraft {
	ac := generateRandomAircraft()
	ac.Type = acType
	return ac
}

// AircraftWithAltitude creates an aircraft at a specific altitude
func AircraftWithAltitude(alt int) Aircraft {
	ac := generateRandomAircraft()
	ac.AltBaro = &alt
	ac.Alt = &alt
	return ac
}

// AircraftOnGround creates an aircraft on the ground
func AircraftOnGround() Aircraft {
	ac := generateRandomAircraft()
	alt := 0
	gs := randomFloat(0, 30.0)
	ac.AltBaro = &alt
	ac.Alt = &alt
	ac.GS = &gs
	return ac
}

// AircraftWithNoPosition creates an aircraft without position data
func AircraftWithNoPosition() Aircraft {
	hex := generateHex()
	alt := randomInt(10000, 40000)
	rssi := randomFloat(-25.0, -5.0)

	return Aircraft{
		Hex:     hex,
		Flight:  generateCallsign(),
		AltBaro: &alt,
		Alt:     &alt,
		RSSI:    &rssi,
		Squawk:  generateSquawk(),
		Type:    aircraftTypes[seededRand.Intn(len(aircraftTypes))],
	}
}

// GenerateACARSMessage generates a random ACARS message
func GenerateACARSMessage() ACARSMessage {
	callsign := generateCallsign()
	label := acarsLabels[seededRand.Intn(len(acarsLabels))]
	text := generateACARSText(label)

	return ACARSMessage{
		Callsign:  callsign,
		Flight:    callsign,
		Label:     label,
		Text:      text,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
}

// ACARSWithCallsign creates an ACARS message with a specific callsign
func ACARSWithCallsign(callsign string) ACARSMessage {
	msg := GenerateACARSMessage()
	msg.Callsign = callsign
	msg.Flight = callsign
	return msg
}

// ACARSWithLabel creates an ACARS message with a specific label
func ACARSWithLabel(label string) ACARSMessage {
	msg := GenerateACARSMessage()
	msg.Label = label
	return msg
}

// ACARSWithText creates an ACARS message with specific text content
func ACARSWithText(text string) ACARSMessage {
	msg := GenerateACARSMessage()
	msg.Text = text
	return msg
}

// generateHex generates a random 6-character hexadecimal ICAO address
func generateHex() string {
	return fmt.Sprintf("%06X", seededRand.Intn(0xFFFFFF))
}

// generateCallsign generates a random airline callsign
func generateCallsign() string {
	prefix := callsignPrefixes[seededRand.Intn(len(callsignPrefixes))]
	number := seededRand.Intn(9999) + 1
	return fmt.Sprintf("%s%d", prefix, number)
}

// generateSquawk generates a random squawk code
func generateSquawk() string {
	// Generate a valid squawk code (0000-7777 in octal)
	return fmt.Sprintf("%04d", seededRand.Intn(7778))
}

// randomFloat generates a random float64 between min and max
func randomFloat(min, max float64) float64 {
	return min + seededRand.Float64()*(max-min)
}

// randomInt generates a random int between min and max (inclusive)
func randomInt(min, max int) int {
	return min + seededRand.Intn(max-min+1)
}

// generateACARSText generates realistic ACARS message text based on label
func generateACARSText(label string) string {
	switch label {
	case "H1": // Position report
		lat := randomFloat(25.0, 49.0)
		lon := randomFloat(-125.0, -67.0)
		alt := randomInt(100, 450)
		return fmt.Sprintf("POS N%05.2f W%06.2f /FL%03d", lat, -lon, alt)

	case "Q0": // Link test
		return "LINK TEST OK"

	case "QA", "QB", "QC", "QD", "QE", "QF": // OOOI (Out Off On In)
		airports := []string{"KJFK", "KLAX", "KORD", "KATL", "KDFW", "KDEN", "KSFO", "KLAS", "KMIA", "KEWR"}
		return fmt.Sprintf("OUT %s %s", airports[seededRand.Intn(len(airports))], time.Now().UTC().Format("1504"))

	case "5U": // Weather request
		airports := []string{"KJFK", "KLAX", "KORD", "KATL", "KDFW", "KDEN", "KSFO", "KLAS", "KMIA", "KEWR"}
		return fmt.Sprintf("WX REQ %s", airports[seededRand.Intn(len(airports))])

	case "5Y", "5Z": // Weather report
		return fmt.Sprintf("METAR KJFK %02d%02d%02dZ %03d%02dKT %dSM FEW%03d %02d/%02d A%04d",
			seededRand.Intn(28)+1, seededRand.Intn(24), seededRand.Intn(60),
			seededRand.Intn(360), seededRand.Intn(30)+5,
			seededRand.Intn(10)+1, seededRand.Intn(250)+50,
			seededRand.Intn(30)+10, seededRand.Intn(20),
			seededRand.Intn(100)+2950)

	case "80", "83": // Departure clearance
		airports := []string{"KJFK", "KLAX", "KORD", "KATL", "KDFW"}
		runways := []string{"04L", "22R", "27L", "09R", "13L"}
		return fmt.Sprintf("CLR TO %s VIA RNAV RWY%s",
			airports[seededRand.Intn(len(airports))],
			runways[seededRand.Intn(len(runways))])

	case "8D", "8E": // Departure report
		return fmt.Sprintf("DEP %s %s", "KJFK", time.Now().UTC().Format("1504"))

	case "SA": // System status
		return "SYSTEM OK ALL GREEN"

	case "SQ": // Squawk assignment
		return fmt.Sprintf("SQUAWK %04d", seededRand.Intn(7778))

	case "B0", "B1", "B2", "B3", "B4", "B5", "B6": // Free text
		messages := []string{
			"REQUESTING HIGHER ALTITUDE",
			"TURBULENCE REPORTED FL350",
			"DEVIATION REQUEST WEATHER",
			"MAINTENANCE MSG CHECK REQUIRED",
			"CREW REQUEST FUEL UPDATE",
			"PASSENGER COUNT CONFIRMED",
			"CATERING UPDATE RECEIVED",
		}
		return messages[seededRand.Intn(len(messages))]

	default:
		return fmt.Sprintf("MSG %s DATA %d", label, seededRand.Intn(9999))
	}
}

// GenerateAircraftBatch generates aircraft with specific characteristics
type AircraftBatchOptions struct {
	Count         int
	MilitaryCount int
	EmergencyHex  []string // Hex codes that should have emergency squawks
	NearLat       float64
	NearLon       float64
	NearRadius    float64 // in degrees
}

// GenerateAircraftBatch generates a batch of aircraft with specified options
func GenerateAircraftBatch(opts AircraftBatchOptions) []Aircraft {
	aircraft := make([]Aircraft, 0, opts.Count)

	// Generate regular aircraft
	regularCount := opts.Count - opts.MilitaryCount
	for i := 0; i < regularCount; i++ {
		ac := generateRandomAircraft()

		// If near position specified, cluster aircraft around it
		if opts.NearRadius > 0 {
			lat := opts.NearLat + randomFloat(-opts.NearRadius, opts.NearRadius)
			lon := opts.NearLon + randomFloat(-opts.NearRadius, opts.NearRadius)
			ac.Lat = &lat
			ac.Lon = &lon
		}

		aircraft = append(aircraft, ac)
	}

	// Generate military aircraft
	for i := 0; i < opts.MilitaryCount; i++ {
		ac := GenerateMilitaryAircraft()

		if opts.NearRadius > 0 {
			lat := opts.NearLat + randomFloat(-opts.NearRadius, opts.NearRadius)
			lon := opts.NearLon + randomFloat(-opts.NearRadius, opts.NearRadius)
			ac.Lat = &lat
			ac.Lon = &lon
		}

		aircraft = append(aircraft, ac)
	}

	// Add emergency squawks to specified hex codes
	emergencySquawks := []string{"7500", "7600", "7700"}
	for i, hex := range opts.EmergencyHex {
		if i < len(aircraft) {
			aircraft[i].Hex = hex
			aircraft[i].Squawk = emergencySquawks[i%len(emergencySquawks)]
		}
	}

	return aircraft
}

// GenerateACARSBatch generates multiple ACARS messages
func GenerateACARSBatch(count int) []ACARSMessage {
	messages := make([]ACARSMessage, count)
	for i := 0; i < count; i++ {
		messages[i] = GenerateACARSMessage()
	}
	return messages
}

// RealisticFlightPath generates a series of aircraft positions simulating movement
func RealisticFlightPath(startLat, startLon, endLat, endLon float64, steps int) []Aircraft {
	aircraft := make([]Aircraft, steps)
	baseAircraft := generateRandomAircraft()

	latStep := (endLat - startLat) / float64(steps-1)
	lonStep := (endLon - startLon) / float64(steps-1)

	for i := 0; i < steps; i++ {
		ac := baseAircraft
		lat := startLat + latStep*float64(i)
		lon := startLon + lonStep*float64(i)
		ac.Lat = &lat
		ac.Lon = &lon

		// Vary altitude slightly during flight
		alt := *ac.AltBaro + randomInt(-500, 500)
		ac.AltBaro = &alt
		ac.Alt = &alt

		// Update distance and bearing
		distance := randomFloat(10.0, 200.0)
		bearing := randomFloat(0.0, 359.9)
		ac.Distance = &distance
		ac.Bearing = &bearing

		aircraft[i] = ac
	}

	return aircraft
}

// InterestingAircraft returns a set of aircraft that are "interesting" for testing
func InterestingAircraft() []Aircraft {
	return []Aircraft{
		GenerateMilitaryAircraft(),
		GenerateEmergencyAircraft("7700"),
		GenerateEmergencyAircraft("7600"),
		GenerateEmergencyAircraft("7500"),
		AircraftOnGround(),
		AircraftWithNoPosition(),
		AircraftWithAltitude(45000), // High altitude
		AircraftWithAltitude(500),   // Very low
	}
}
