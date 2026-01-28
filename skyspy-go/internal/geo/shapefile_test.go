package geo

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// Helper function to create a minimal shapefile header
func createShapefileHeader(shapeType int32, xMin, yMin, xMax, yMax float64) []byte {
	header := make([]byte, 100)

	// File code (big endian): 9994
	binary.BigEndian.PutUint32(header[0:4], 9994)

	// File length in 16-bit words (big endian) - will be updated
	binary.BigEndian.PutUint32(header[24:28], 50) // 100 bytes = 50 words

	// Version (little endian): 1000
	binary.LittleEndian.PutUint32(header[28:32], 1000)

	// Shape type (little endian)
	binary.LittleEndian.PutUint32(header[32:36], uint32(shapeType))

	// Bounding box (little endian)
	binary.LittleEndian.PutUint64(header[36:44], float64ToBits(xMin))
	binary.LittleEndian.PutUint64(header[44:52], float64ToBits(yMin))
	binary.LittleEndian.PutUint64(header[52:60], float64ToBits(xMax))
	binary.LittleEndian.PutUint64(header[60:68], float64ToBits(yMax))

	return header
}

// Helper to convert float64 to bits
func float64ToBits(f float64) uint64 {
	buf := new(bytes.Buffer)
	binary.Write(buf, binary.LittleEndian, f)
	return binary.LittleEndian.Uint64(buf.Bytes())
}

// Helper to create a point record
func createPointRecord(recordNum int32, x, y float64) []byte {
	// Record header: 8 bytes (big endian)
	// Content: 4 (shape type) + 8 (x) + 8 (y) = 20 bytes = 10 words
	record := make([]byte, 8+20)

	// Record header (big endian)
	binary.BigEndian.PutUint32(record[0:4], uint32(recordNum))
	binary.BigEndian.PutUint32(record[4:8], 10) // 20 bytes = 10 words

	// Content (little endian)
	binary.LittleEndian.PutUint32(record[8:12], shapePoint) // Shape type
	binary.LittleEndian.PutUint64(record[12:20], float64ToBits(x))
	binary.LittleEndian.PutUint64(record[20:28], float64ToBits(y))

	return record
}

// Helper to create a polyline record
func createPolyLineRecord(recordNum int32, points [][2]float64) []byte {
	numParts := 1
	numPoints := len(points)

	// Content size: 4 (type) + 32 (bbox) + 4 (numParts) + 4 (numPoints) + 4*numParts (parts) + 16*numPoints (points)
	contentSize := 44 + 4*numParts + 16*numPoints
	record := make([]byte, 8+contentSize)

	// Record header (big endian)
	binary.BigEndian.PutUint32(record[0:4], uint32(recordNum))
	binary.BigEndian.PutUint32(record[4:8], uint32(contentSize/2))

	offset := 8

	// Shape type (little endian)
	binary.LittleEndian.PutUint32(record[offset:offset+4], shapePolyLine)
	offset += 4

	// Bounding box (skip for test - just zeros)
	offset += 32

	// NumParts
	binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(numParts))
	offset += 4

	// NumPoints
	binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(numPoints))
	offset += 4

	// Parts array (start index of each part)
	binary.LittleEndian.PutUint32(record[offset:offset+4], 0)
	offset += 4

	// Points
	for _, pt := range points {
		binary.LittleEndian.PutUint64(record[offset:offset+8], float64ToBits(pt[0]))
		binary.LittleEndian.PutUint64(record[offset+8:offset+16], float64ToBits(pt[1]))
		offset += 16
	}

	return record
}

// Helper to create a polygon record
func createPolygonRecord(recordNum int32, points [][2]float64) []byte {
	numParts := 1
	numPoints := len(points)

	contentSize := 44 + 4*numParts + 16*numPoints
	record := make([]byte, 8+contentSize)

	// Record header (big endian)
	binary.BigEndian.PutUint32(record[0:4], uint32(recordNum))
	binary.BigEndian.PutUint32(record[4:8], uint32(contentSize/2))

	offset := 8

	// Shape type
	binary.LittleEndian.PutUint32(record[offset:offset+4], shapePolygon)
	offset += 4

	// Bounding box (zeros for test)
	offset += 32

	// NumParts
	binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(numParts))
	offset += 4

	// NumPoints
	binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(numPoints))
	offset += 4

	// Parts array
	binary.LittleEndian.PutUint32(record[offset:offset+4], 0)
	offset += 4

	// Points
	for _, pt := range points {
		binary.LittleEndian.PutUint64(record[offset:offset+8], float64ToBits(pt[0]))
		binary.LittleEndian.PutUint64(record[offset+8:offset+16], float64ToBits(pt[1]))
		offset += 16
	}

	return record
}

func TestParseShapefileHeader(t *testing.T) {
	header := createShapefileHeader(shapePoint, -180, -90, 180, 90)

	parsed, err := parseShapefileHeader(header)
	if err != nil {
		t.Fatalf("Failed to parse header: %v", err)
	}

	if parsed.FileCode != 9994 {
		t.Errorf("Expected file code 9994, got %d", parsed.FileCode)
	}

	if parsed.Version != 1000 {
		t.Errorf("Expected version 1000, got %d", parsed.Version)
	}

	if parsed.ShapeType != shapePoint {
		t.Errorf("Expected shape type %d, got %d", shapePoint, parsed.ShapeType)
	}

	if parsed.XMin != -180 {
		t.Errorf("Expected XMin -180, got %f", parsed.XMin)
	}
}

func TestParseShapefileInvalidHeader(t *testing.T) {
	// Test with wrong magic number
	header := createShapefileHeader(shapePoint, 0, 0, 0, 0)
	binary.BigEndian.PutUint32(header[0:4], 1234) // Wrong magic

	_, err := parseShapefileHeader(header)
	if err == nil {
		t.Error("Expected error for invalid magic number")
	}
}

func TestParseShapefileTooSmall(t *testing.T) {
	header := make([]byte, 50) // Too small

	_, err := parseShapefileHeader(header)
	if err == nil {
		t.Error("Expected error for header too small")
	}
}

func TestParseShapefileWithPoints(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create shapefile with points
	shpPath := filepath.Join(tmpDir, "test_points.shp")

	// Build shapefile data
	var data []byte
	header := createShapefileHeader(shapePoint, -122.5, 37.5, -122.0, 38.0)
	data = append(data, header...)

	// Add point records
	data = append(data, createPointRecord(1, -122.4, 37.8)...) // San Francisco area
	data = append(data, createPointRecord(2, -122.2, 37.6)...)

	// Update file length in header
	fileLength := len(data) / 2 // In 16-bit words
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	// Write file
	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	// Parse shapefile
	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	if len(overlay.Features) != 2 {
		t.Errorf("Expected 2 features, got %d", len(overlay.Features))
	}

	// Check first point
	if len(overlay.Features) > 0 {
		f := overlay.Features[0]
		if f.Type != OverlayPoint {
			t.Errorf("Expected point type, got %d", f.Type)
		}
		if len(f.Points) != 1 {
			t.Errorf("Expected 1 point, got %d", len(f.Points))
		}
		if f.Points[0].Lon != -122.4 || f.Points[0].Lat != 37.8 {
			t.Errorf("Unexpected coordinates: %f, %f", f.Points[0].Lon, f.Points[0].Lat)
		}
	}
}

func TestParseShapefileWithPolyLine(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "test_lines.shp")

	// Build shapefile data
	var data []byte
	header := createShapefileHeader(shapePolyLine, -123, 37, -122, 38)
	data = append(data, header...)

	// Add polyline record
	points := [][2]float64{
		{-122.5, 37.5},
		{-122.4, 37.6},
		{-122.3, 37.7},
	}
	data = append(data, createPolyLineRecord(1, points)...)

	// Update file length
	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}

	if len(overlay.Features) > 0 {
		f := overlay.Features[0]
		if f.Type != OverlayLine {
			t.Errorf("Expected line type, got %d", f.Type)
		}
		if len(f.Points) != 3 {
			t.Errorf("Expected 3 points, got %d", len(f.Points))
		}
	}
}

func TestParseShapefileWithPolygon(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "test_polygon.shp")

	// Build shapefile data
	var data []byte
	header := createShapefileHeader(shapePolygon, -123, 37, -122, 38)
	data = append(data, header...)

	// Add polygon record (a simple square)
	points := [][2]float64{
		{-122.5, 37.5},
		{-122.5, 37.7},
		{-122.3, 37.7},
		{-122.3, 37.5},
		{-122.5, 37.5}, // Close the polygon
	}
	data = append(data, createPolygonRecord(1, points)...)

	// Update file length
	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}

	if len(overlay.Features) > 0 {
		f := overlay.Features[0]
		if f.Type != OverlayPolygon {
			t.Errorf("Expected polygon type, got %d", f.Type)
		}
		if len(f.Points) != 5 {
			t.Errorf("Expected 5 points, got %d", len(f.Points))
		}
	}
}

func TestParseShapefileNotFound(t *testing.T) {
	_, err := ParseShapefile("/nonexistent/path/file.shp")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestParseDBF(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a minimal DBF file
	dbfPath := filepath.Join(tmpDir, "test.dbf")

	// DBF header (32 bytes)
	dbfData := make([]byte, 0)
	header := make([]byte, 32)
	header[0] = 0x03                                        // dBASE III
	binary.LittleEndian.PutUint32(header[4:8], 2)           // 2 records
	binary.LittleEndian.PutUint16(header[8:10], 32+32+1)    // Header size (header + 1 field + terminator)
	binary.LittleEndian.PutUint16(header[10:12], 1+10)      // Record size (deletion flag + field)
	dbfData = append(dbfData, header...)

	// Field descriptor (32 bytes)
	field := make([]byte, 32)
	copy(field[0:11], "NAME")     // Field name
	field[11] = 'C'               // Character type
	field[16] = 10                // Field length
	dbfData = append(dbfData, field...)

	// Header terminator
	dbfData = append(dbfData, 0x0D)

	// Record 1
	record1 := make([]byte, 11) // deletion flag + 10 char field
	record1[0] = ' '            // Not deleted
	copy(record1[1:], "Airport   ")
	dbfData = append(dbfData, record1...)

	// Record 2
	record2 := make([]byte, 11)
	record2[0] = ' '
	copy(record2[1:], "City      ")
	dbfData = append(dbfData, record2...)

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write DBF file: %v", err)
	}

	records, err := parseDBF(dbfPath)
	if err != nil {
		t.Fatalf("Failed to parse DBF: %v", err)
	}

	if len(records) != 2 {
		t.Errorf("Expected 2 records, got %d", len(records))
	}

	if len(records) > 0 {
		if records[0]["NAME"] != "Airport" {
			t.Errorf("Expected 'Airport', got '%s'", records[0]["NAME"])
		}
	}

	if len(records) > 1 {
		if records[1]["NAME"] != "City" {
			t.Errorf("Expected 'City', got '%s'", records[1]["NAME"])
		}
	}
}

func TestParseShapefileWithDBF(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create shapefile with points
	shpPath := filepath.Join(tmpDir, "test.shp")

	var data []byte
	header := createShapefileHeader(shapePoint, -122.5, 37.5, -122.0, 38.0)
	data = append(data, header...)
	data = append(data, createPointRecord(1, -122.4, 37.8)...)

	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	// Create companion DBF file
	dbfPath := filepath.Join(tmpDir, "test.dbf")

	dbfData := make([]byte, 0)
	dbfHeader := make([]byte, 32)
	dbfHeader[0] = 0x03
	binary.LittleEndian.PutUint32(dbfHeader[4:8], 1)
	binary.LittleEndian.PutUint16(dbfHeader[8:10], 32+32+1)
	binary.LittleEndian.PutUint16(dbfHeader[10:12], 1+10)
	dbfData = append(dbfData, dbfHeader...)

	field := make([]byte, 32)
	copy(field[0:11], "NAME")
	field[11] = 'C'
	field[16] = 10
	dbfData = append(dbfData, field...)

	dbfData = append(dbfData, 0x0D)

	record := make([]byte, 11)
	record[0] = ' '
	copy(record[1:], "SFO       ")
	dbfData = append(dbfData, record...)

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write DBF file: %v", err)
	}

	// Parse shapefile with DBF
	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}

	if len(overlay.Features) > 0 {
		f := overlay.Features[0]
		if f.Name != "SFO" {
			t.Errorf("Expected name 'SFO', got '%s'", f.Name)
		}
		if f.Properties["NAME"] != "SFO" {
			t.Errorf("Expected property NAME='SFO', got '%v'", f.Properties["NAME"])
		}
	}
}

func TestFloat64Conversion(t *testing.T) {
	tests := []float64{
		0,
		1.5,
		-122.4,
		37.78,
		-180,
		180,
		90,
		-90,
	}

	for _, val := range tests {
		bits := float64ToBits(val)
		buf := make([]byte, 8)
		binary.LittleEndian.PutUint64(buf, bits)
		result := readFloat64LE(buf)
		if result != val {
			t.Errorf("Float64 roundtrip failed: expected %f, got %f", val, result)
		}
	}
}

func TestParseNullShape(t *testing.T) {
	result, err := parseShapeRecord(make([]byte, 4), shapeNull, shapeNull)
	if err != nil {
		t.Errorf("Null shape should not return error: %v", err)
	}
	if result != nil {
		t.Error("Null shape should return nil feature")
	}
}
