// Package geo provides geographic overlay support for SkySpy radar display
package geo

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Shapefile shape types
const (
	shapeNull        = 0
	shapePoint       = 1
	shapePolyLine    = 3
	shapePolygon     = 5
	shapeMultiPoint  = 8
	shapePointZ      = 11
	shapePolyLineZ   = 13
	shapePolygonZ    = 15
	shapeMultiPointZ = 18
	shapePointM      = 21
	shapePolyLineM   = 23
	shapePolygonM    = 25
	shapeMultiPointM = 28
)

// shapefileHeader represents the 100-byte shapefile header
type shapefileHeader struct {
	FileCode   int32    // Big endian, always 9994
	Unused     [5]int32 // Big endian, unused
	FileLength int32    // Big endian, file length in 16-bit words
	Version    int32    // Little endian, always 1000
	ShapeType  int32    // Little endian
	XMin       float64  // Little endian
	YMin       float64  // Little endian
	XMax       float64  // Little endian
	YMax       float64  // Little endian
	ZMin       float64  // Little endian
	ZMax       float64  // Little endian
	MMin       float64  // Little endian
	MMax       float64  // Little endian
}

// recordHeader represents each record header (8 bytes)
type recordHeader struct {
	RecordNumber  int32 // Big endian
	ContentLength int32 // Big endian (in 16-bit words)
}

// dbfHeader represents the dBASE file header
type dbfHeader struct {
	Version      byte
	Year         byte
	Month        byte
	Day          byte
	RecordCount  uint32
	HeaderSize   uint16
	RecordSize   uint16
	Reserved     [20]byte
}

// dbfField represents a field descriptor in the dBASE file
type dbfField struct {
	Name          [11]byte
	Type          byte
	Reserved1     [4]byte
	FieldLength   byte
	DecimalCount  byte
	Reserved2     [14]byte
}

// ParseShapefile reads a shapefile and returns a GeoOverlay
func ParseShapefile(path string) (*GeoOverlay, error) {
	// Expand path
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	// Open the .shp file
	shpFile, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open shapefile: %w", err)
	}
	defer shpFile.Close()

	// Read the entire file into memory for easier parsing
	data, err := io.ReadAll(shpFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read shapefile: %w", err)
	}

	if len(data) < 100 {
		return nil, fmt.Errorf("shapefile too small: %d bytes", len(data))
	}

	// Parse the header
	header, err := parseShapefileHeader(data[:100])
	if err != nil {
		return nil, err
	}

	// Create overlay
	overlay := &GeoOverlay{
		Name:       filepath.Base(path),
		Enabled:    true,
		Opacity:    1.0,
		SourceFile: path,
	}

	// Try to load attribute names from .dbf file
	dbfPath := strings.TrimSuffix(path, filepath.Ext(path)) + ".dbf"
	var attributes []map[string]string
	if _, err := os.Stat(dbfPath); err == nil {
		attributes, _ = parseDBF(dbfPath)
	}

	// Parse records starting at offset 100
	offset := 100
	recordIndex := 0
	for offset < len(data) {
		if offset+8 > len(data) {
			break
		}

		// Read record header (big endian)
		recHeader := recordHeader{
			RecordNumber:  int32(binary.BigEndian.Uint32(data[offset : offset+4])),
			ContentLength: int32(binary.BigEndian.Uint32(data[offset+4 : offset+8])),
		}
		offset += 8

		contentBytes := int(recHeader.ContentLength) * 2 // Convert from 16-bit words to bytes
		if offset+contentBytes > len(data) {
			break
		}

		recordData := data[offset : offset+contentBytes]
		offset += contentBytes

		if len(recordData) < 4 {
			continue
		}

		// Read shape type (little endian)
		shapeType := int32(binary.LittleEndian.Uint32(recordData[:4]))

		// Get feature name from attributes if available
		featureName := ""
		var props map[string]interface{}
		if recordIndex < len(attributes) {
			props = make(map[string]interface{})
			for k, v := range attributes[recordIndex] {
				props[k] = v
				// Try to find a name field
				keyLower := strings.ToLower(k)
				if featureName == "" && (keyLower == "name" || keyLower == "label" || keyLower == "title" || keyLower == "id") {
					featureName = v
				}
			}
		}
		if props == nil {
			props = make(map[string]interface{})
		}

		feature, err := parseShapeRecord(recordData, shapeType, header.ShapeType)
		if err == nil && feature != nil {
			feature.Name = featureName
			feature.Properties = props
			overlay.Features = append(overlay.Features, *feature)
		}

		recordIndex++
	}

	return overlay, nil
}

// parseShapefileHeader parses the 100-byte shapefile header
func parseShapefileHeader(data []byte) (*shapefileHeader, error) {
	if len(data) < 100 {
		return nil, fmt.Errorf("header too short")
	}

	header := &shapefileHeader{}

	// File code is big endian
	header.FileCode = int32(binary.BigEndian.Uint32(data[0:4]))
	if header.FileCode != 9994 {
		return nil, fmt.Errorf("invalid shapefile magic number: %d (expected 9994)", header.FileCode)
	}

	// File length is big endian
	header.FileLength = int32(binary.BigEndian.Uint32(data[24:28]))

	// Version is little endian
	header.Version = int32(binary.LittleEndian.Uint32(data[28:32]))

	// Shape type is little endian
	header.ShapeType = int32(binary.LittleEndian.Uint32(data[32:36]))

	// Bounding box is little endian
	header.XMin = readFloat64LE(data[36:44])
	header.YMin = readFloat64LE(data[44:52])
	header.XMax = readFloat64LE(data[52:60])
	header.YMax = readFloat64LE(data[60:68])
	header.ZMin = readFloat64LE(data[68:76])
	header.ZMax = readFloat64LE(data[76:84])
	header.MMin = readFloat64LE(data[84:92])
	header.MMax = readFloat64LE(data[92:100])

	return header, nil
}

// readFloat64LE reads a little-endian float64
func readFloat64LE(data []byte) float64 {
	bits := binary.LittleEndian.Uint64(data)
	return float64FromBits(bits)
}

// float64FromBits converts uint64 bits to float64
func float64FromBits(bits uint64) float64 {
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, bits)
	var f float64
	binary.Read(bytes.NewReader(buf), binary.LittleEndian, &f)
	return f
}

// parseShapeRecord parses a single shape record
func parseShapeRecord(data []byte, shapeType, fileShapeType int32) (*GeoFeature, error) {
	if shapeType == shapeNull {
		return nil, nil
	}

	switch shapeType {
	case shapePoint, shapePointM, shapePointZ:
		return parsePoint(data)
	case shapePolyLine, shapePolyLineM, shapePolyLineZ:
		return parsePolyLine(data)
	case shapePolygon, shapePolygonM, shapePolygonZ:
		return parsePolygon(data)
	case shapeMultiPoint, shapeMultiPointM, shapeMultiPointZ:
		return parseMultiPoint(data)
	default:
		return nil, fmt.Errorf("unsupported shape type: %d", shapeType)
	}
}

// parsePoint parses a Point shape (type 1, 11, 21)
func parsePoint(data []byte) (*GeoFeature, error) {
	// Point: ShapeType (4 bytes) + X (8 bytes) + Y (8 bytes)
	if len(data) < 20 {
		return nil, fmt.Errorf("point record too short: %d bytes", len(data))
	}

	x := readFloat64LE(data[4:12])  // Longitude
	y := readFloat64LE(data[12:20]) // Latitude

	return &GeoFeature{
		Type: OverlayPoint,
		Points: []GeoPoint{
			{Lat: y, Lon: x},
		},
	}, nil
}

// parsePolyLine parses a PolyLine shape (type 3, 13, 23)
func parsePolyLine(data []byte) (*GeoFeature, error) {
	// PolyLine header:
	// ShapeType (4) + BBox (32) + NumParts (4) + NumPoints (4) = 44 bytes minimum
	if len(data) < 44 {
		return nil, fmt.Errorf("polyline record too short: %d bytes", len(data))
	}

	// Skip shape type (4) and bounding box (32)
	numParts := int(binary.LittleEndian.Uint32(data[36:40]))
	numPoints := int(binary.LittleEndian.Uint32(data[40:44]))

	if numParts <= 0 || numPoints <= 0 {
		return nil, nil
	}

	// Calculate expected size
	// Parts array: numParts * 4 bytes
	// Points array: numPoints * 16 bytes (X and Y are each 8 bytes)
	expectedSize := 44 + numParts*4 + numPoints*16
	if len(data) < expectedSize {
		return nil, fmt.Errorf("polyline data too short: have %d, need %d", len(data), expectedSize)
	}

	// Read parts indices
	parts := make([]int, numParts)
	offset := 44
	for i := 0; i < numParts; i++ {
		parts[i] = int(binary.LittleEndian.Uint32(data[offset : offset+4]))
		offset += 4
	}

	// Read all points
	allPoints := make([]GeoPoint, numPoints)
	for i := 0; i < numPoints; i++ {
		x := readFloat64LE(data[offset : offset+8])
		y := readFloat64LE(data[offset+8 : offset+16])
		allPoints[i] = GeoPoint{Lat: y, Lon: x}
		offset += 16
	}

	// For simplicity, combine all parts into one feature
	// A more complete implementation would create multiple features
	return &GeoFeature{
		Type:   OverlayLine,
		Points: allPoints,
	}, nil
}

// parsePolygon parses a Polygon shape (type 5, 15, 25)
func parsePolygon(data []byte) (*GeoFeature, error) {
	// Polygon has the same structure as PolyLine
	if len(data) < 44 {
		return nil, fmt.Errorf("polygon record too short: %d bytes", len(data))
	}

	numParts := int(binary.LittleEndian.Uint32(data[36:40]))
	numPoints := int(binary.LittleEndian.Uint32(data[40:44]))

	if numParts <= 0 || numPoints <= 0 {
		return nil, nil
	}

	expectedSize := 44 + numParts*4 + numPoints*16
	if len(data) < expectedSize {
		return nil, fmt.Errorf("polygon data too short: have %d, need %d", len(data), expectedSize)
	}

	// Read parts indices
	parts := make([]int, numParts)
	offset := 44
	for i := 0; i < numParts; i++ {
		parts[i] = int(binary.LittleEndian.Uint32(data[offset : offset+4]))
		offset += 4
	}

	// Read all points - only use outer ring (first part)
	// Determine end of first part
	endOfFirstPart := numPoints
	if numParts > 1 {
		endOfFirstPart = parts[1]
	}

	var points []GeoPoint
	for i := 0; i < endOfFirstPart; i++ {
		x := readFloat64LE(data[offset : offset+8])
		y := readFloat64LE(data[offset+8 : offset+16])
		points = append(points, GeoPoint{Lat: y, Lon: x})
		offset += 16
	}

	return &GeoFeature{
		Type:   OverlayPolygon,
		Points: points,
	}, nil
}

// parseMultiPoint parses a MultiPoint shape (type 8, 18, 28)
func parseMultiPoint(data []byte) (*GeoFeature, error) {
	// MultiPoint: ShapeType (4) + BBox (32) + NumPoints (4) = 40 bytes minimum
	if len(data) < 40 {
		return nil, fmt.Errorf("multipoint record too short: %d bytes", len(data))
	}

	numPoints := int(binary.LittleEndian.Uint32(data[36:40]))

	if numPoints <= 0 {
		return nil, nil
	}

	expectedSize := 40 + numPoints*16
	if len(data) < expectedSize {
		return nil, fmt.Errorf("multipoint data too short: have %d, need %d", len(data), expectedSize)
	}

	// Read all points - return first point as a single point feature
	offset := 40
	x := readFloat64LE(data[offset : offset+8])
	y := readFloat64LE(data[offset+8 : offset+16])

	return &GeoFeature{
		Type: OverlayPoint,
		Points: []GeoPoint{
			{Lat: y, Lon: x},
		},
	}, nil
}

// parseDBF reads attribute data from a .dbf file
func parseDBF(path string) ([]map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}

	if len(data) < 32 {
		return nil, fmt.Errorf("dbf file too small")
	}

	// Parse header
	recordCount := binary.LittleEndian.Uint32(data[4:8])
	headerSize := binary.LittleEndian.Uint16(data[8:10])
	recordSize := binary.LittleEndian.Uint16(data[10:12])

	if int(headerSize) > len(data) {
		return nil, fmt.Errorf("invalid dbf header size")
	}

	// Parse field descriptors
	// Fields start at byte 32 and end at header terminator (0x0D)
	var fields []struct {
		Name   string
		Length int
	}

	offset := 32
	for offset+32 <= int(headerSize) && data[offset] != 0x0D {
		// Read field name (first 11 bytes, null-terminated)
		nameBytes := data[offset : offset+11]
		nameEnd := bytes.IndexByte(nameBytes, 0)
		if nameEnd == -1 {
			nameEnd = 11
		}
		fieldName := strings.TrimSpace(string(nameBytes[:nameEnd]))

		// Field length is at offset 16 within the field descriptor
		fieldLength := int(data[offset+16])

		fields = append(fields, struct {
			Name   string
			Length int
		}{
			Name:   fieldName,
			Length: fieldLength,
		})

		offset += 32
	}

	// Skip to record data (after header terminator)
	recordStart := int(headerSize)

	var records []map[string]string
	for i := uint32(0); i < recordCount; i++ {
		recOffset := recordStart + int(i)*int(recordSize)
		if recOffset+int(recordSize) > len(data) {
			break
		}

		// Skip deletion flag (1 byte)
		fieldOffset := recOffset + 1

		record := make(map[string]string)
		for _, field := range fields {
			if fieldOffset+field.Length > len(data) {
				break
			}
			value := strings.TrimSpace(string(data[fieldOffset : fieldOffset+field.Length]))
			record[field.Name] = value
			fieldOffset += field.Length
		}

		records = append(records, record)
	}

	return records, nil
}
