// Package geo provides geographic overlay support for SkySpy radar display
package geo

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// KML XML structures

// kmlRoot represents the root KML element
type kmlRoot struct {
	XMLName  xml.Name    `xml:"kml"`
	Document kmlDocument `xml:"Document"`
	Folder   *kmlFolder  `xml:"Folder"`
	// Direct placemarks at root level
	Placemarks []kmlPlacemark `xml:"Placemark"`
}

// kmlDocument represents a KML Document
type kmlDocument struct {
	Name       string           `xml:"name"`
	Folders    []kmlFolder      `xml:"Folder"`
	Placemarks []kmlPlacemark   `xml:"Placemark"`
	Styles     []kmlStyle       `xml:"Style"`
	StyleMaps  []kmlStyleMap    `xml:"StyleMap"`
}

// kmlFolder represents a KML Folder
type kmlFolder struct {
	Name       string           `xml:"name"`
	Folders    []kmlFolder      `xml:"Folder"`
	Placemarks []kmlPlacemark   `xml:"Placemark"`
}

// kmlPlacemark represents a KML Placemark
type kmlPlacemark struct {
	Name        string          `xml:"name"`
	Description string          `xml:"description"`
	StyleURL    string          `xml:"styleUrl"`
	Point       *kmlPoint       `xml:"Point"`
	LineString  *kmlLineString  `xml:"LineString"`
	Polygon     *kmlPolygon     `xml:"Polygon"`
	MultiGeom   *kmlMultiGeom   `xml:"MultiGeometry"`
}

// kmlPoint represents a KML Point geometry
type kmlPoint struct {
	Coordinates string `xml:"coordinates"`
}

// kmlLineString represents a KML LineString geometry
type kmlLineString struct {
	Coordinates string `xml:"coordinates"`
}

// kmlPolygon represents a KML Polygon geometry
type kmlPolygon struct {
	OuterBoundaryIs kmlBoundary `xml:"outerBoundaryIs"`
	InnerBoundaryIs []kmlBoundary `xml:"innerBoundaryIs"`
}

// kmlBoundary represents a KML boundary (LinearRing)
type kmlBoundary struct {
	LinearRing kmlLinearRing `xml:"LinearRing"`
}

// kmlLinearRing represents a KML LinearRing
type kmlLinearRing struct {
	Coordinates string `xml:"coordinates"`
}

// kmlMultiGeom represents a KML MultiGeometry
type kmlMultiGeom struct {
	Points      []kmlPoint      `xml:"Point"`
	LineStrings []kmlLineString `xml:"LineString"`
	Polygons    []kmlPolygon    `xml:"Polygon"`
}

// kmlStyle represents a KML Style
type kmlStyle struct {
	ID        string       `xml:"id,attr"`
	LineStyle *kmlLineStyle `xml:"LineStyle"`
	PolyStyle *kmlPolyStyle `xml:"PolyStyle"`
	IconStyle *kmlIconStyle `xml:"IconStyle"`
}

// kmlStyleMap represents a KML StyleMap
type kmlStyleMap struct {
	ID    string        `xml:"id,attr"`
	Pairs []kmlStylePair `xml:"Pair"`
}

// kmlStylePair represents a StyleMap Pair
type kmlStylePair struct {
	Key      string `xml:"key"`
	StyleURL string `xml:"styleUrl"`
}

// kmlLineStyle represents KML LineStyle
type kmlLineStyle struct {
	Color string  `xml:"color"`
	Width float64 `xml:"width"`
}

// kmlPolyStyle represents KML PolyStyle
type kmlPolyStyle struct {
	Color   string `xml:"color"`
	Fill    int    `xml:"fill"`
	Outline int    `xml:"outline"`
}

// kmlIconStyle represents KML IconStyle
type kmlIconStyle struct {
	Color string `xml:"color"`
	Scale float64 `xml:"scale"`
}

// ParseKML reads a KML file and returns a GeoOverlay
func ParseKML(path string) (*GeoOverlay, error) {
	// Expand path
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read KML file: %w", err)
	}

	return parseKMLData(data, path)
}

// ParseKMZ reads a KMZ file (zipped KML) and returns a GeoOverlay
func ParseKMZ(path string) (*GeoOverlay, error) {
	// Expand path
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	// Open the zip file
	r, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open KMZ file: %w", err)
	}
	defer r.Close()

	// Look for doc.kml or any .kml file
	var kmlFile *zip.File
	for _, f := range r.File {
		name := strings.ToLower(f.Name)
		if name == "doc.kml" {
			kmlFile = f
			break
		}
		if strings.HasSuffix(name, ".kml") && kmlFile == nil {
			kmlFile = f
		}
	}

	if kmlFile == nil {
		return nil, fmt.Errorf("no KML file found in KMZ archive")
	}

	// Read the KML file from the archive
	rc, err := kmlFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open KML in KMZ: %w", err)
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("failed to read KML from KMZ: %w", err)
	}

	return parseKMLData(data, path)
}

// parseKMLData parses KML XML data and returns a GeoOverlay
func parseKMLData(data []byte, sourcePath string) (*GeoOverlay, error) {
	var kml kmlRoot
	if err := xml.Unmarshal(data, &kml); err != nil {
		return nil, fmt.Errorf("failed to parse KML: %w", err)
	}

	overlay := &GeoOverlay{
		Name:       filepath.Base(sourcePath),
		Enabled:    true,
		Opacity:    1.0,
		SourceFile: sourcePath,
	}

	// Use document name if available
	if kml.Document.Name != "" {
		overlay.Name = kml.Document.Name
	}

	// Collect all placemarks from various locations
	var placemarks []kmlPlacemark

	// From root level
	placemarks = append(placemarks, kml.Placemarks...)

	// From Document
	placemarks = append(placemarks, kml.Document.Placemarks...)

	// From Document Folders (recursive)
	for _, folder := range kml.Document.Folders {
		placemarks = append(placemarks, collectPlacemarks(folder)...)
	}

	// From root Folder
	if kml.Folder != nil {
		placemarks = append(placemarks, collectPlacemarks(*kml.Folder)...)
	}

	// Convert placemarks to features
	for _, pm := range placemarks {
		features := convertPlacemarkToFeatures(pm)
		overlay.Features = append(overlay.Features, features...)
	}

	return overlay, nil
}

// collectPlacemarks recursively collects placemarks from a folder and its subfolders
func collectPlacemarks(folder kmlFolder) []kmlPlacemark {
	var result []kmlPlacemark
	result = append(result, folder.Placemarks...)

	for _, subFolder := range folder.Folders {
		result = append(result, collectPlacemarks(subFolder)...)
	}

	return result
}

// convertPlacemarkToFeatures converts a KML placemark to GeoFeatures
func convertPlacemarkToFeatures(pm kmlPlacemark) []GeoFeature {
	var features []GeoFeature

	props := map[string]interface{}{
		"name":        pm.Name,
		"description": pm.Description,
	}

	// Handle Point
	if pm.Point != nil {
		coords := parseKMLCoordinates(pm.Point.Coordinates)
		if len(coords) > 0 {
			features = append(features, GeoFeature{
				Type:       OverlayPoint,
				Points:     coords,
				Name:       pm.Name,
				Properties: props,
			})
		}
	}

	// Handle LineString
	if pm.LineString != nil {
		coords := parseKMLCoordinates(pm.LineString.Coordinates)
		if len(coords) > 0 {
			features = append(features, GeoFeature{
				Type:       OverlayLine,
				Points:     coords,
				Name:       pm.Name,
				Properties: props,
			})
		}
	}

	// Handle Polygon
	if pm.Polygon != nil {
		coords := parseKMLCoordinates(pm.Polygon.OuterBoundaryIs.LinearRing.Coordinates)
		if len(coords) > 0 {
			features = append(features, GeoFeature{
				Type:       OverlayPolygon,
				Points:     coords,
				Name:       pm.Name,
				Properties: props,
			})
		}
	}

	// Handle MultiGeometry
	if pm.MultiGeom != nil {
		// Points
		for _, pt := range pm.MultiGeom.Points {
			coords := parseKMLCoordinates(pt.Coordinates)
			if len(coords) > 0 {
				features = append(features, GeoFeature{
					Type:       OverlayPoint,
					Points:     coords,
					Name:       pm.Name,
					Properties: props,
				})
			}
		}

		// LineStrings
		for _, ls := range pm.MultiGeom.LineStrings {
			coords := parseKMLCoordinates(ls.Coordinates)
			if len(coords) > 0 {
				features = append(features, GeoFeature{
					Type:       OverlayLine,
					Points:     coords,
					Name:       pm.Name,
					Properties: props,
				})
			}
		}

		// Polygons
		for _, poly := range pm.MultiGeom.Polygons {
			coords := parseKMLCoordinates(poly.OuterBoundaryIs.LinearRing.Coordinates)
			if len(coords) > 0 {
				features = append(features, GeoFeature{
					Type:       OverlayPolygon,
					Points:     coords,
					Name:       pm.Name,
					Properties: props,
				})
			}
		}
	}

	return features
}

// parseKMLCoordinates parses KML coordinate string into GeoPoints
// KML format: longitude,latitude[,altitude] separated by whitespace
func parseKMLCoordinates(coordStr string) []GeoPoint {
	var points []GeoPoint

	// Split by whitespace (spaces, tabs, newlines)
	coordStr = strings.TrimSpace(coordStr)
	if coordStr == "" {
		return points
	}

	// Replace common separators with spaces for uniform parsing
	coordStr = strings.ReplaceAll(coordStr, "\n", " ")
	coordStr = strings.ReplaceAll(coordStr, "\r", " ")
	coordStr = strings.ReplaceAll(coordStr, "\t", " ")

	// Split into coordinate tuples
	tuples := strings.Fields(coordStr)

	for _, tuple := range tuples {
		tuple = strings.TrimSpace(tuple)
		if tuple == "" {
			continue
		}

		parts := strings.Split(tuple, ",")
		if len(parts) < 2 {
			continue
		}

		lon, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
		lat, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)

		if err1 == nil && err2 == nil {
			points = append(points, GeoPoint{Lat: lat, Lon: lon})
		}
	}

	return points
}
