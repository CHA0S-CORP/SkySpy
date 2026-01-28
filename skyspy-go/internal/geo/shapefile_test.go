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

func TestParseShapefileTildePath(t *testing.T) {
	// Test that tilde expansion doesn't panic (file won't exist)
	_, err := ParseShapefile("~/nonexistent_shapefile_test.shp")
	if err == nil {
		t.Error("Expected error for nonexistent file with tilde path")
	}
}

func TestParseUnsupportedShapeType(t *testing.T) {
	// Test unsupported shape type (e.g., 100)
	data := make([]byte, 4)
	binary.LittleEndian.PutUint32(data, 100)

	_, err := parseShapeRecord(data, 100, 100)
	if err == nil {
		t.Error("Expected error for unsupported shape type")
	}
}

// Helper to create a multipoint record
func createMultiPointRecord(recordNum int32, points [][2]float64) []byte {
	numPoints := len(points)

	// Content size: 4 (type) + 32 (bbox) + 4 (numPoints) + 16*numPoints (points)
	contentSize := 40 + 16*numPoints
	record := make([]byte, 8+contentSize)

	// Record header (big endian)
	binary.BigEndian.PutUint32(record[0:4], uint32(recordNum))
	binary.BigEndian.PutUint32(record[4:8], uint32(contentSize/2))

	offset := 8

	// Shape type
	binary.LittleEndian.PutUint32(record[offset:offset+4], shapeMultiPoint)
	offset += 4

	// Bounding box (zeros for test)
	offset += 32

	// NumPoints
	binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(numPoints))
	offset += 4

	// Points
	for _, pt := range points {
		binary.LittleEndian.PutUint64(record[offset:offset+8], float64ToBits(pt[0]))
		binary.LittleEndian.PutUint64(record[offset+8:offset+16], float64ToBits(pt[1]))
		offset += 16
	}

	return record
}

func TestParseShapefileWithMultiPoint(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "test_multipoint.shp")

	// Build shapefile data
	var data []byte
	header := createShapefileHeader(shapeMultiPoint, -123, 37, -122, 38)
	data = append(data, header...)

	// Add multipoint record
	points := [][2]float64{
		{-122.5, 37.5},
		{-122.4, 37.6},
		{-122.3, 37.7},
	}
	data = append(data, createMultiPointRecord(1, points)...)

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
		if f.Type != OverlayPoint {
			t.Errorf("Expected point type, got %d", f.Type)
		}
		// MultiPoint returns just the first point
		if len(f.Points) != 1 {
			t.Errorf("Expected 1 point, got %d", len(f.Points))
		}
	}
}

func TestParsePointTooShort(t *testing.T) {
	// Point with insufficient data
	data := make([]byte, 10) // Less than 20 bytes needed
	binary.LittleEndian.PutUint32(data, shapePoint)

	_, err := parsePoint(data)
	if err == nil {
		t.Error("Expected error for point with insufficient data")
	}
}

func TestParsePolyLineTooShort(t *testing.T) {
	// PolyLine with insufficient data
	data := make([]byte, 20) // Less than 44 bytes needed
	binary.LittleEndian.PutUint32(data, shapePolyLine)

	_, err := parsePolyLine(data)
	if err == nil {
		t.Error("Expected error for polyline with insufficient data")
	}
}

func TestParsePolyLineZeroPartsOrPoints(t *testing.T) {
	// PolyLine with 0 parts or points
	data := make([]byte, 44)
	binary.LittleEndian.PutUint32(data[0:4], shapePolyLine)
	// NumParts = 0
	binary.LittleEndian.PutUint32(data[36:40], 0)
	// NumPoints = 0
	binary.LittleEndian.PutUint32(data[40:44], 0)

	result, err := parsePolyLine(data)
	if err != nil {
		t.Errorf("PolyLine with 0 parts/points should not error: %v", err)
	}
	if result != nil {
		t.Error("PolyLine with 0 parts/points should return nil")
	}
}

func TestParsePolyLineDataTooShort(t *testing.T) {
	// PolyLine with numParts/numPoints but insufficient data for them
	data := make([]byte, 50) // Just barely enough for header but not data
	binary.LittleEndian.PutUint32(data[0:4], shapePolyLine)
	binary.LittleEndian.PutUint32(data[36:40], 1)  // NumParts = 1
	binary.LittleEndian.PutUint32(data[40:44], 10) // NumPoints = 10 (would need much more data)

	_, err := parsePolyLine(data)
	if err == nil {
		t.Error("Expected error for polyline with insufficient point data")
	}
}

func TestParsePolygonTooShort(t *testing.T) {
	// Polygon with insufficient data
	data := make([]byte, 20)
	binary.LittleEndian.PutUint32(data, shapePolygon)

	_, err := parsePolygon(data)
	if err == nil {
		t.Error("Expected error for polygon with insufficient data")
	}
}

func TestParsePolygonZeroPartsOrPoints(t *testing.T) {
	// Polygon with 0 parts or points
	data := make([]byte, 44)
	binary.LittleEndian.PutUint32(data[0:4], shapePolygon)
	binary.LittleEndian.PutUint32(data[36:40], 0)
	binary.LittleEndian.PutUint32(data[40:44], 0)

	result, err := parsePolygon(data)
	if err != nil {
		t.Errorf("Polygon with 0 parts/points should not error: %v", err)
	}
	if result != nil {
		t.Error("Polygon with 0 parts/points should return nil")
	}
}

func TestParsePolygonDataTooShort(t *testing.T) {
	// Polygon with numParts/numPoints but insufficient data
	data := make([]byte, 50)
	binary.LittleEndian.PutUint32(data[0:4], shapePolygon)
	binary.LittleEndian.PutUint32(data[36:40], 1)
	binary.LittleEndian.PutUint32(data[40:44], 10)

	_, err := parsePolygon(data)
	if err == nil {
		t.Error("Expected error for polygon with insufficient point data")
	}
}

func TestParseMultiPointTooShort(t *testing.T) {
	// MultiPoint with insufficient data
	data := make([]byte, 20)
	binary.LittleEndian.PutUint32(data, shapeMultiPoint)

	_, err := parseMultiPoint(data)
	if err == nil {
		t.Error("Expected error for multipoint with insufficient data")
	}
}

func TestParseMultiPointZeroPoints(t *testing.T) {
	// MultiPoint with 0 points
	data := make([]byte, 40)
	binary.LittleEndian.PutUint32(data[0:4], shapeMultiPoint)
	binary.LittleEndian.PutUint32(data[36:40], 0)

	result, err := parseMultiPoint(data)
	if err != nil {
		t.Errorf("MultiPoint with 0 points should not error: %v", err)
	}
	if result != nil {
		t.Error("MultiPoint with 0 points should return nil")
	}
}

func TestParseMultiPointDataTooShort(t *testing.T) {
	// MultiPoint with numPoints but insufficient data
	data := make([]byte, 44)
	binary.LittleEndian.PutUint32(data[0:4], shapeMultiPoint)
	binary.LittleEndian.PutUint32(data[36:40], 10) // 10 points would need 40 + 160 bytes

	_, err := parseMultiPoint(data)
	if err == nil {
		t.Error("Expected error for multipoint with insufficient point data")
	}
}

func TestParseDBFNotFound(t *testing.T) {
	_, err := parseDBF("/nonexistent/path/file.dbf")
	if err == nil {
		t.Error("Expected error for nonexistent DBF file")
	}
}

func TestParseDBFTooSmall(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbfPath := filepath.Join(tmpDir, "small.dbf")
	if err := os.WriteFile(dbfPath, []byte("too small"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = parseDBF(dbfPath)
	if err == nil {
		t.Error("Expected error for DBF file too small")
	}
}

func TestParseDBFInvalidHeaderSize(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbfPath := filepath.Join(tmpDir, "invalid.dbf")

	// Create DBF with headerSize larger than file
	dbfData := make([]byte, 32)
	dbfData[0] = 0x03
	binary.LittleEndian.PutUint16(dbfData[8:10], 1000) // Header size larger than file

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = parseDBF(dbfPath)
	if err == nil {
		t.Error("Expected error for DBF with invalid header size")
	}
}

func TestParseShapefileFileTooSmall(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "small.shp")
	if err := os.WriteFile(shpPath, []byte("too small"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = ParseShapefile(shpPath)
	if err == nil {
		t.Error("Expected error for shapefile too small")
	}
}

func TestParseShapefileInvalidMagicNumber(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "invalid_magic.shp")

	// Create a 100-byte file with invalid magic number
	data := make([]byte, 100)
	// Wrong magic number (should be 9994 = 0x270A in big endian)
	data[0], data[1], data[2], data[3] = 0, 0, 0, 1 // Magic = 1

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = ParseShapefile(shpPath)
	if err == nil {
		t.Error("Expected error for invalid magic number")
	}
}

func TestParseShapefileReadError(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Use directory as file - should fail on io.ReadAll
	_, err = ParseShapefile(tmpDir)
	if err == nil {
		t.Error("Expected error when reading directory as shapefile")
	}
}

// Helper to create a polygon record with multiple parts
func createPolygonMultiPartRecord(recordNum int32, parts []int, points [][2]float64) []byte {
	numParts := len(parts)
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
	for _, p := range parts {
		binary.LittleEndian.PutUint32(record[offset:offset+4], uint32(p))
		offset += 4
	}

	// Points
	for _, pt := range points {
		binary.LittleEndian.PutUint64(record[offset:offset+8], float64ToBits(pt[0]))
		binary.LittleEndian.PutUint64(record[offset+8:offset+16], float64ToBits(pt[1]))
		offset += 16
	}

	return record
}

func TestParsePolygonMultipleParts(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "test_multipart_polygon.shp")

	var data []byte
	header := createShapefileHeader(shapePolygon, -123, 37, -122, 38)
	data = append(data, header...)

	// Create a polygon with 2 parts (outer ring and hole)
	parts := []int{0, 5} // First part starts at 0, second at 5
	points := [][2]float64{
		// Outer ring (5 points)
		{-122.5, 37.5},
		{-122.5, 37.8},
		{-122.2, 37.8},
		{-122.2, 37.5},
		{-122.5, 37.5},
		// Inner ring / hole (4 points)
		{-122.4, 37.6},
		{-122.4, 37.7},
		{-122.3, 37.7},
		{-122.3, 37.6},
	}
	data = append(data, createPolygonMultiPartRecord(1, parts, points)...)

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

	// Should only have outer ring points (first 5)
	if len(overlay.Features) > 0 {
		f := overlay.Features[0]
		if len(f.Points) != 5 {
			t.Errorf("Expected 5 points (outer ring only), got %d", len(f.Points))
		}
	}
}

func TestParseShapefileWithZTypes(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test PointZ (type 11)
	shpPath := filepath.Join(tmpDir, "test_pointz.shp")

	var data []byte
	header := createShapefileHeader(shapePointZ, -123, 37, -122, 38)
	data = append(data, header...)

	// Create a PointZ record (same structure as Point for our purposes)
	record := make([]byte, 8+36) // PointZ has additional Z and M values
	binary.BigEndian.PutUint32(record[0:4], 1)
	binary.BigEndian.PutUint32(record[4:8], 18) // 36 bytes = 18 words

	binary.LittleEndian.PutUint32(record[8:12], shapePointZ)
	binary.LittleEndian.PutUint64(record[12:20], float64ToBits(-122.4))
	binary.LittleEndian.PutUint64(record[20:28], float64ToBits(37.8))
	// Z and M values follow but we don't use them

	data = append(data, record...)

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
		t.Errorf("Expected 1 feature for PointZ, got %d", len(overlay.Features))
	}
}

func TestParseShapefileWithMTypes(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test PointM (type 21)
	shpPath := filepath.Join(tmpDir, "test_pointm.shp")

	var data []byte
	header := createShapefileHeader(shapePointM, -123, 37, -122, 38)
	data = append(data, header...)

	// Create a PointM record
	record := make([]byte, 8+28) // PointM has additional M value
	binary.BigEndian.PutUint32(record[0:4], 1)
	binary.BigEndian.PutUint32(record[4:8], 14) // 28 bytes = 14 words

	binary.LittleEndian.PutUint32(record[8:12], shapePointM)
	binary.LittleEndian.PutUint64(record[12:20], float64ToBits(-122.4))
	binary.LittleEndian.PutUint64(record[20:28], float64ToBits(37.8))

	data = append(data, record...)

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
		t.Errorf("Expected 1 feature for PointM, got %d", len(overlay.Features))
	}
}

func TestParseDBFFieldNameNullTerminator(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbfPath := filepath.Join(tmpDir, "test.dbf")

	// Create DBF with field name that fills all 11 bytes (no null)
	dbfData := make([]byte, 0)
	header := make([]byte, 32)
	header[0] = 0x03
	binary.LittleEndian.PutUint32(header[4:8], 1)
	binary.LittleEndian.PutUint16(header[8:10], 32+32+1)
	binary.LittleEndian.PutUint16(header[10:12], 1+10)
	dbfData = append(dbfData, header...)

	// Field with full 11-byte name
	field := make([]byte, 32)
	copy(field[0:11], "VERYLONGNAM") // 11 chars, no null
	field[11] = 'C'
	field[16] = 10
	dbfData = append(dbfData, field...)

	dbfData = append(dbfData, 0x0D)

	record := make([]byte, 11)
	record[0] = ' '
	copy(record[1:], "Test      ")
	dbfData = append(dbfData, record...)

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write DBF file: %v", err)
	}

	records, err := parseDBF(dbfPath)
	if err != nil {
		t.Fatalf("Failed to parse DBF: %v", err)
	}

	if len(records) != 1 {
		t.Errorf("Expected 1 record, got %d", len(records))
	}

	// Field name should be the full 11 chars
	if _, ok := records[0]["VERYLONGNAM"]; !ok {
		t.Error("Expected field VERYLONGNAM")
	}
}

func TestParseShapefileRecordHeaderTruncated(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "truncated.shp")

	// Create shapefile with truncated record header (less than 8 bytes after header)
	header := createShapefileHeader(shapePoint, -123, 37, -122, 38)
	data := header
	data = append(data, 0x01, 0x00, 0x00) // Only 3 bytes instead of 8 for record header

	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	// Should succeed but with no features
	if len(overlay.Features) != 0 {
		t.Errorf("Expected 0 features, got %d", len(overlay.Features))
	}
}

func TestParseShapefileRecordDataTruncated(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "truncated_data.shp")

	// Create shapefile with valid record header but truncated data
	header := createShapefileHeader(shapePoint, -123, 37, -122, 38)
	data := header

	// Add record header claiming 100 bytes of content but only provide 4
	recordHeader := make([]byte, 8)
	binary.BigEndian.PutUint32(recordHeader[0:4], 1) // Record number
	binary.BigEndian.PutUint32(recordHeader[4:8], 50) // Content length = 100 bytes = 50 words

	data = append(data, recordHeader...)
	data = append(data, 0x01, 0x00, 0x00, 0x00) // Only 4 bytes of content

	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	// Should succeed but with no features
	if len(overlay.Features) != 0 {
		t.Errorf("Expected 0 features, got %d", len(overlay.Features))
	}
}

func TestParseShapefileRecordTooShort(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "shapefile_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	shpPath := filepath.Join(tmpDir, "short_record.shp")

	// Create shapefile with record that has content length indicating only 2 bytes
	header := createShapefileHeader(shapePoint, -123, 37, -122, 38)
	data := header

	// Add record header with content length of 1 word = 2 bytes (less than 4)
	recordHeader := make([]byte, 8)
	binary.BigEndian.PutUint32(recordHeader[0:4], 1)
	binary.BigEndian.PutUint32(recordHeader[4:8], 1) // 1 word = 2 bytes

	data = append(data, recordHeader...)
	data = append(data, 0x00, 0x00) // 2 bytes of content

	fileLength := len(data) / 2
	binary.BigEndian.PutUint32(data[24:28], uint32(fileLength))

	if err := os.WriteFile(shpPath, data, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := ParseShapefile(shpPath)
	if err != nil {
		t.Fatalf("Failed to parse shapefile: %v", err)
	}

	// Should succeed but with no features (record skipped)
	if len(overlay.Features) != 0 {
		t.Errorf("Expected 0 features, got %d", len(overlay.Features))
	}
}

func TestParseDBFRecordTruncated(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbfPath := filepath.Join(tmpDir, "truncated.dbf")

	// Create DBF with record count indicating more records than data provides
	dbfData := make([]byte, 0)
	header := make([]byte, 32)
	header[0] = 0x03
	binary.LittleEndian.PutUint32(header[4:8], 5) // Claim 5 records
	binary.LittleEndian.PutUint16(header[8:10], 32+32+1)
	binary.LittleEndian.PutUint16(header[10:12], 1+10)
	dbfData = append(dbfData, header...)

	field := make([]byte, 32)
	copy(field[0:11], "NAME")
	field[11] = 'C'
	field[16] = 10
	dbfData = append(dbfData, field...)

	dbfData = append(dbfData, 0x0D)

	// Only provide 1 record instead of 5
	record := make([]byte, 11)
	record[0] = ' '
	copy(record[1:], "Test      ")
	dbfData = append(dbfData, record...)

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write DBF file: %v", err)
	}

	records, err := parseDBF(dbfPath)
	if err != nil {
		t.Fatalf("Failed to parse DBF: %v", err)
	}

	// Should only get 1 record
	if len(records) != 1 {
		t.Errorf("Expected 1 record, got %d", len(records))
	}
}

func TestParseDBFReadError(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// On Unix systems, we can't read from a directory as a file
	// os.Open succeeds on directories, but io.ReadAll fails
	// However, this may not work on all systems, so we'll just check error handling
	dirPath := tmpDir // Use the temp directory itself

	// This should either fail at Open or ReadAll
	_, err = parseDBF(dirPath)
	if err == nil {
		t.Error("Expected error when reading directory as DBF")
	}
}

func TestParseDBFFieldTruncated(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dbf_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbfPath := filepath.Join(tmpDir, "field_truncated.dbf")

	// Create DBF where the field descriptor claims a length larger than actual data
	// The record size in header will say it fits, but the field length is wrong
	// This tests the "fieldOffset+field.Length > len(data)" break condition
	dbfData := make([]byte, 0)
	header := make([]byte, 32)
	header[0] = 0x03
	binary.LittleEndian.PutUint32(header[4:8], 1)        // 1 record
	binary.LittleEndian.PutUint16(header[8:10], 32+32+1) // header + 1 field + terminator = 65
	binary.LittleEndian.PutUint16(header[10:12], 1+10)   // deletion + 10 = 11 bytes per record
	dbfData = append(dbfData, header...)

	// Field that claims 200 bytes but record only has 10
	field := make([]byte, 32)
	copy(field[0:11], "NAME")
	field[11] = 'C'
	field[16] = 200 // Claims 200 bytes but record size is only 11
	dbfData = append(dbfData, field...)

	dbfData = append(dbfData, 0x0D)

	// Provide a full record according to header's recordSize (11 bytes)
	record := make([]byte, 11)
	record[0] = ' '
	copy(record[1:], "Test      ")
	dbfData = append(dbfData, record...)

	if err := os.WriteFile(dbfPath, dbfData, 0644); err != nil {
		t.Fatalf("Failed to write DBF file: %v", err)
	}

	records, err := parseDBF(dbfPath)
	if err != nil {
		t.Fatalf("Failed to parse DBF: %v", err)
	}

	// Should get 1 record (the field break will happen but record is still added)
	if len(records) != 1 {
		t.Errorf("Expected 1 record, got %d", len(records))
	}
}
