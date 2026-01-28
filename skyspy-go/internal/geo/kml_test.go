package geo

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestParseKMLPoint(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test Points</name>
    <Placemark>
      <name>San Francisco</name>
      <description>A city in California</description>
      <Point>
        <coordinates>-122.4194,37.7749,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if overlay.Name != "Test Points" {
		t.Errorf("Expected name 'Test Points', got '%s'", overlay.Name)
	}

	if len(overlay.Features) != 1 {
		t.Fatalf("Expected 1 feature, got %d", len(overlay.Features))
	}

	f := overlay.Features[0]
	if f.Type != OverlayPoint {
		t.Errorf("Expected point type, got %d", f.Type)
	}

	if f.Name != "San Francisco" {
		t.Errorf("Expected name 'San Francisco', got '%s'", f.Name)
	}

	if len(f.Points) != 1 {
		t.Fatalf("Expected 1 point, got %d", len(f.Points))
	}

	pt := f.Points[0]
	if pt.Lon != -122.4194 {
		t.Errorf("Expected longitude -122.4194, got %f", pt.Lon)
	}
	if pt.Lat != 37.7749 {
		t.Errorf("Expected latitude 37.7749, got %f", pt.Lat)
	}
}

func TestParseKMLLineString(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Route</name>
      <LineString>
        <coordinates>
          -122.4194,37.7749,0
          -122.4094,37.7849,0
          -122.3994,37.7949,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_line.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Fatalf("Expected 1 feature, got %d", len(overlay.Features))
	}

	f := overlay.Features[0]
	if f.Type != OverlayLine {
		t.Errorf("Expected line type, got %d", f.Type)
	}

	if len(f.Points) != 3 {
		t.Errorf("Expected 3 points, got %d", len(f.Points))
	}
}

func TestParseKMLPolygon(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Area</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -122.5,37.5,0
              -122.5,37.7,0
              -122.3,37.7,0
              -122.3,37.5,0
              -122.5,37.5,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_polygon.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Fatalf("Expected 1 feature, got %d", len(overlay.Features))
	}

	f := overlay.Features[0]
	if f.Type != OverlayPolygon {
		t.Errorf("Expected polygon type, got %d", f.Type)
	}

	if len(f.Points) != 5 {
		t.Errorf("Expected 5 points (closed polygon), got %d", len(f.Points))
	}
}

func TestParseKMLFolders(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test with Folders</name>
    <Folder>
      <name>Airports</name>
      <Placemark>
        <name>SFO</name>
        <Point>
          <coordinates>-122.3789,37.6213,0</coordinates>
        </Point>
      </Placemark>
      <Folder>
        <name>Regional</name>
        <Placemark>
          <name>OAK</name>
          <Point>
            <coordinates>-122.2197,37.7213,0</coordinates>
          </Point>
        </Placemark>
      </Folder>
    </Folder>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_folders.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if len(overlay.Features) != 2 {
		t.Errorf("Expected 2 features from nested folders, got %d", len(overlay.Features))
	}

	// Check that both airports are found
	names := make(map[string]bool)
	for _, f := range overlay.Features {
		names[f.Name] = true
	}

	if !names["SFO"] {
		t.Error("Expected to find SFO placemark")
	}
	if !names["OAK"] {
		t.Error("Expected to find OAK placemark")
	}
}

func TestParseKMLMultiGeometry(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Multi</name>
      <MultiGeometry>
        <Point>
          <coordinates>-122.4,37.7,0</coordinates>
        </Point>
        <LineString>
          <coordinates>
            -122.5,37.5,0
            -122.4,37.6,0
          </coordinates>
        </LineString>
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_multi.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	// Should have 2 features from the MultiGeometry
	if len(overlay.Features) != 2 {
		t.Errorf("Expected 2 features from MultiGeometry, got %d", len(overlay.Features))
	}

	// Check types
	hasPoint := false
	hasLine := false
	for _, f := range overlay.Features {
		if f.Type == OverlayPoint {
			hasPoint = true
		}
		if f.Type == OverlayLine {
			hasLine = true
		}
	}

	if !hasPoint {
		t.Error("Expected a point feature from MultiGeometry")
	}
	if !hasLine {
		t.Error("Expected a line feature from MultiGeometry")
	}
}

func TestParseKMZ(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kmz_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>KMZ Test</name>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.4,37.7,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

	kmzPath := filepath.Join(tmpDir, "test.kmz")

	// Create KMZ (zip) file
	zipFile, err := os.Create(kmzPath)
	if err != nil {
		t.Fatalf("Failed to create KMZ file: %v", err)
	}

	w := zip.NewWriter(zipFile)

	// Add doc.kml to the archive
	f, err := w.Create("doc.kml")
	if err != nil {
		zipFile.Close()
		t.Fatalf("Failed to create doc.kml in archive: %v", err)
	}
	_, err = f.Write([]byte(kmlContent))
	if err != nil {
		zipFile.Close()
		t.Fatalf("Failed to write doc.kml: %v", err)
	}

	if err := w.Close(); err != nil {
		zipFile.Close()
		t.Fatalf("Failed to close zip writer: %v", err)
	}
	zipFile.Close()

	// Parse the KMZ
	overlay, err := ParseKMZ(kmzPath)
	if err != nil {
		t.Fatalf("Failed to parse KMZ: %v", err)
	}

	if overlay.Name != "KMZ Test" {
		t.Errorf("Expected name 'KMZ Test', got '%s'", overlay.Name)
	}

	if len(overlay.Features) != 1 {
		t.Fatalf("Expected 1 feature, got %d", len(overlay.Features))
	}
}

func TestParseKMLCoordinates(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{
			name:     "single coordinate with altitude",
			input:    "-122.4194,37.7749,0",
			expected: 1,
		},
		{
			name:     "single coordinate without altitude",
			input:    "-122.4194,37.7749",
			expected: 1,
		},
		{
			name:     "multiple coordinates space separated",
			input:    "-122.4,37.7,0 -122.5,37.8,0 -122.6,37.9,0",
			expected: 3,
		},
		{
			name:     "multiple coordinates newline separated",
			input:    "-122.4,37.7,0\n-122.5,37.8,0\n-122.6,37.9,0",
			expected: 3,
		},
		{
			name:     "coordinates with extra whitespace",
			input:    "  -122.4,37.7,0   -122.5,37.8,0   ",
			expected: 2,
		},
		{
			name:     "empty string",
			input:    "",
			expected: 0,
		},
		{
			name:     "whitespace only",
			input:    "   \n\t  ",
			expected: 0,
		},
		{
			name:     "invalid coordinate",
			input:    "not,a,coordinate",
			expected: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := parseKMLCoordinates(tc.input)
			if len(result) != tc.expected {
				t.Errorf("Expected %d points, got %d", tc.expected, len(result))
			}
		})
	}
}

func TestParseKMLRootPlacemarks(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// KML with Placemark directly under root kml element
	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Root Level Point</name>
    <Point>
      <coordinates>-122.4,37.7,0</coordinates>
    </Point>
  </Placemark>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_root.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature from root placemark, got %d", len(overlay.Features))
	}
}

func TestParseKMLRootFolder(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// KML with Folder directly under root kml element (no Document)
	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Folder>
    <name>Root Folder</name>
    <Placemark>
      <name>Point in Root Folder</name>
      <Point>
        <coordinates>-122.4,37.7,0</coordinates>
      </Point>
    </Placemark>
  </Folder>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test_root_folder.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := ParseKML(kmlPath)
	if err != nil {
		t.Fatalf("Failed to parse KML: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature from root folder placemark, got %d", len(overlay.Features))
	}
}

func TestParseKMLNotFound(t *testing.T) {
	_, err := ParseKML("/nonexistent/path/file.kml")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestParseKMZNotFound(t *testing.T) {
	_, err := ParseKMZ("/nonexistent/path/file.kmz")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestParseKMZNoKML(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kmz_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmzPath := filepath.Join(tmpDir, "empty.kmz")

	// Create KMZ without any KML file
	zipFile, err := os.Create(kmzPath)
	if err != nil {
		t.Fatalf("Failed to create KMZ file: %v", err)
	}

	w := zip.NewWriter(zipFile)

	// Add a non-KML file
	f, _ := w.Create("readme.txt")
	f.Write([]byte("This is not a KML file"))

	w.Close()
	zipFile.Close()

	_, err = ParseKMZ(kmzPath)
	if err == nil {
		t.Error("Expected error for KMZ without KML file")
	}
}

func TestParseKMLInvalidXML(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "kml_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlPath := filepath.Join(tmpDir, "invalid.kml")
	if err := os.WriteFile(kmlPath, []byte("not valid xml <><>"), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	_, err = ParseKML(kmlPath)
	if err == nil {
		t.Error("Expected error for invalid XML")
	}
}
