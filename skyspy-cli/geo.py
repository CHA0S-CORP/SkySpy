"""
SkySpy CLI Geographic Overlay System
Load and render shapefiles, GeoJSON, and custom boundaries
"""

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
from enum import Enum


class OverlayType(Enum):
    POLYGON = "polygon"
    LINE = "line"
    POINT = "point"
    CIRCLE = "circle"


@dataclass
class GeoPoint:
    """Geographic point"""
    lat: float
    lon: float
    label: Optional[str] = None


@dataclass
class GeoFeature:
    """A geographic feature (polygon, line, or point)"""
    type: OverlayType
    points: List[GeoPoint]
    properties: Dict[str, Any] = field(default_factory=dict)
    name: Optional[str] = None
    style: Optional[str] = None  # Color/style override


@dataclass
class GeoOverlay:
    """A collection of geographic features"""
    name: str
    features: List[GeoFeature]
    enabled: bool = True
    color: Optional[str] = None
    opacity: float = 1.0
    source_file: Optional[str] = None


# Built-in overlays
BUILTIN_OVERLAYS: Dict[str, dict] = {
    "us_firs": {
        "name": "US Flight Information Regions",
        "description": "FAA FIR boundaries",
        "url": "https://raw.githubusercontent.com/jpatokal/openflights/master/data/countries.dat",
    },
    "range_rings": {
        "name": "Custom Range Rings",
        "description": "Additional range markers",
    },
}


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points"""
    R = 3440.065  # Earth radius in nm
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def bearing_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from point 1 to point 2"""
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)

    y = math.sin(delta_lon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def load_geojson(filepath: str) -> Optional[GeoOverlay]:
    """Load a GeoJSON file and convert to GeoOverlay"""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)

        features = []
        name = data.get("name", Path(filepath).stem)

        geojson_features = data.get("features", [])
        if not geojson_features and data.get("type") == "FeatureCollection":
            geojson_features = data.get("features", [])
        elif data.get("type") in ("Polygon", "LineString", "Point", "MultiPolygon", "MultiLineString"):
            # Single geometry, wrap it
            geojson_features = [{"type": "Feature", "geometry": data, "properties": {}}]

        for feat in geojson_features:
            geo_feat = _parse_geojson_feature(feat)
            if geo_feat:
                features.extend(geo_feat) if isinstance(geo_feat, list) else features.append(geo_feat)

        return GeoOverlay(
            name=name,
            features=features,
            source_file=filepath
        )
    except Exception as e:
        print(f"Error loading GeoJSON {filepath}: {e}")
        return None


def _parse_geojson_feature(feature: dict) -> Optional[List[GeoFeature]]:
    """Parse a single GeoJSON feature"""
    geometry = feature.get("geometry", {})
    properties = feature.get("properties", {})
    geo_type = geometry.get("type", "")
    coords = geometry.get("coordinates", [])

    name = properties.get("name") or properties.get("NAME") or properties.get("id")

    if geo_type == "Point":
        return [GeoFeature(
            type=OverlayType.POINT,
            points=[GeoPoint(lat=coords[1], lon=coords[0], label=name)],
            properties=properties,
            name=name
        )]

    elif geo_type == "LineString":
        points = [GeoPoint(lat=c[1], lon=c[0]) for c in coords]
        return [GeoFeature(
            type=OverlayType.LINE,
            points=points,
            properties=properties,
            name=name
        )]

    elif geo_type == "Polygon":
        # Take the outer ring (first ring)
        outer_ring = coords[0] if coords else []
        points = [GeoPoint(lat=c[1], lon=c[0]) for c in outer_ring]
        return [GeoFeature(
            type=OverlayType.POLYGON,
            points=points,
            properties=properties,
            name=name
        )]

    elif geo_type == "MultiPolygon":
        features = []
        for polygon in coords:
            outer_ring = polygon[0] if polygon else []
            points = [GeoPoint(lat=c[1], lon=c[0]) for c in outer_ring]
            features.append(GeoFeature(
                type=OverlayType.POLYGON,
                points=points,
                properties=properties,
                name=name
            ))
        return features

    elif geo_type == "MultiLineString":
        features = []
        for line in coords:
            points = [GeoPoint(lat=c[1], lon=c[0]) for c in line]
            features.append(GeoFeature(
                type=OverlayType.LINE,
                points=points,
                properties=properties,
                name=name
            ))
        return features

    return None


def load_shapefile(filepath: str) -> Optional[GeoOverlay]:
    """Load a shapefile using pyshp if available, otherwise try to find .geojson"""
    try:
        import shapefile

        sf = shapefile.Reader(filepath)
        features = []
        name = Path(filepath).stem

        for shape_rec in sf.shapeRecords():
            shape = shape_rec.shape
            rec = shape_rec.record

            # Get properties from record
            properties = {}
            for i, field in enumerate(sf.fields[1:]):  # Skip DeletionFlag
                if i < len(rec):
                    properties[field[0]] = rec[i]

            feat_name = properties.get("NAME") or properties.get("name") or properties.get("Name")

            if shape.shapeType in (shapefile.POLYGON, shapefile.POLYGONZ, shapefile.POLYGONM):
                # Handle polygon parts
                for part_idx in range(len(shape.parts)):
                    start = shape.parts[part_idx]
                    end = shape.parts[part_idx + 1] if part_idx + 1 < len(shape.parts) else len(shape.points)

                    points = [GeoPoint(lat=p[1], lon=p[0]) for p in shape.points[start:end]]
                    features.append(GeoFeature(
                        type=OverlayType.POLYGON,
                        points=points,
                        properties=properties,
                        name=feat_name
                    ))

            elif shape.shapeType in (shapefile.POLYLINE, shapefile.POLYLINEZ, shapefile.POLYLINEM):
                for part_idx in range(len(shape.parts)):
                    start = shape.parts[part_idx]
                    end = shape.parts[part_idx + 1] if part_idx + 1 < len(shape.parts) else len(shape.points)

                    points = [GeoPoint(lat=p[1], lon=p[0]) for p in shape.points[start:end]]
                    features.append(GeoFeature(
                        type=OverlayType.LINE,
                        points=points,
                        properties=properties,
                        name=feat_name
                    ))

            elif shape.shapeType in (shapefile.POINT, shapefile.POINTZ, shapefile.POINTM):
                if shape.points:
                    p = shape.points[0]
                    features.append(GeoFeature(
                        type=OverlayType.POINT,
                        points=[GeoPoint(lat=p[1], lon=p[0], label=feat_name)],
                        properties=properties,
                        name=feat_name
                    ))

        return GeoOverlay(
            name=name,
            features=features,
            source_file=filepath
        )

    except ImportError:
        # pyshp not installed, try loading companion .geojson
        geojson_path = filepath.replace('.shp', '.geojson')
        if os.path.exists(geojson_path):
            return load_geojson(geojson_path)
        print(f"pyshp not installed and no .geojson found for {filepath}")
        return None
    except Exception as e:
        print(f"Error loading shapefile {filepath}: {e}")
        return None


def load_overlay(filepath: str) -> Optional[GeoOverlay]:
    """Load an overlay from file (auto-detect format)"""
    filepath = os.path.expanduser(filepath)

    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return None

    ext = Path(filepath).suffix.lower()

    if ext == '.geojson' or ext == '.json':
        return load_geojson(filepath)
    elif ext == '.shp':
        return load_shapefile(filepath)
    else:
        # Try GeoJSON first
        overlay = load_geojson(filepath)
        if overlay:
            return overlay
        return load_shapefile(filepath)


def create_range_ring_overlay(center_lat: float, center_lon: float,
                              ranges: List[float], points_per_ring: int = 72) -> GeoOverlay:
    """Create custom range rings as an overlay"""
    features = []

    for range_nm in ranges:
        ring_points = []
        for i in range(points_per_ring + 1):
            bearing = (360 / points_per_ring) * i
            # Calculate point at distance/bearing from center
            lat, lon = destination_point(center_lat, center_lon, bearing, range_nm)
            ring_points.append(GeoPoint(lat=lat, lon=lon))

        features.append(GeoFeature(
            type=OverlayType.LINE,
            points=ring_points,
            name=f"{int(range_nm)}nm ring"
        ))

    return GeoOverlay(
        name="Range Rings",
        features=features,
        color="cyan"
    )


def create_airspace_circle(center_lat: float, center_lon: float,
                           radius_nm: float, name: str = "Airspace",
                           points: int = 36) -> GeoFeature:
    """Create a circular airspace boundary"""
    ring_points = []
    for i in range(points + 1):
        bearing = (360 / points) * i
        lat, lon = destination_point(center_lat, center_lon, bearing, radius_nm)
        ring_points.append(GeoPoint(lat=lat, lon=lon))

    return GeoFeature(
        type=OverlayType.POLYGON,
        points=ring_points,
        name=name
    )


def destination_point(lat: float, lon: float, bearing: float, distance_nm: float) -> Tuple[float, float]:
    """Calculate destination point given start, bearing, and distance"""
    R = 3440.065  # Earth radius in nm

    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    bearing_rad = math.radians(bearing)

    d = distance_nm / R

    lat2 = math.asin(
        math.sin(lat_rad) * math.cos(d) +
        math.cos(lat_rad) * math.sin(d) * math.cos(bearing_rad)
    )

    lon2 = lon_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(d) * math.cos(lat_rad),
        math.cos(d) - math.sin(lat_rad) * math.sin(lat2)
    )

    return math.degrees(lat2), math.degrees(lon2)


class OverlayManager:
    """Manages loaded overlays"""

    def __init__(self):
        self.overlays: Dict[str, GeoOverlay] = {}
        self.overlay_order: List[str] = []  # Render order

    def add_overlay(self, overlay: GeoOverlay, key: Optional[str] = None) -> str:
        """Add an overlay, returns the key"""
        key = key or overlay.name.lower().replace(" ", "_")
        base_key = key
        counter = 1
        while key in self.overlays:
            key = f"{base_key}_{counter}"
            counter += 1

        self.overlays[key] = overlay
        self.overlay_order.append(key)
        return key

    def remove_overlay(self, key: str) -> bool:
        """Remove an overlay by key"""
        if key in self.overlays:
            del self.overlays[key]
            self.overlay_order.remove(key)
            return True
        return False

    def toggle_overlay(self, key: str) -> bool:
        """Toggle an overlay's enabled state, returns new state"""
        if key in self.overlays:
            self.overlays[key].enabled = not self.overlays[key].enabled
            return self.overlays[key].enabled
        return False

    def set_overlay_color(self, key: str, color: str):
        """Set an overlay's color"""
        if key in self.overlays:
            self.overlays[key].color = color

    def get_enabled_overlays(self) -> List[GeoOverlay]:
        """Get all enabled overlays in render order"""
        return [self.overlays[k] for k in self.overlay_order
                if k in self.overlays and self.overlays[k].enabled]

    def load_from_file(self, filepath: str) -> Optional[str]:
        """Load an overlay from file and add it"""
        overlay = load_overlay(filepath)
        if overlay:
            return self.add_overlay(overlay)
        return None

    def get_overlay_list(self) -> List[Tuple[str, str, bool]]:
        """Get list of (key, name, enabled) for all overlays"""
        return [(k, self.overlays[k].name, self.overlays[k].enabled)
                for k in self.overlay_order if k in self.overlays]

    def to_config(self) -> List[dict]:
        """Export overlay configuration for saving"""
        config = []
        for key in self.overlay_order:
            if key not in self.overlays:
                continue
            ov = self.overlays[key]
            config.append({
                "key": key,
                "name": ov.name,
                "source_file": ov.source_file,
                "enabled": ov.enabled,
                "color": ov.color,
            })
        return config

    def from_config(self, config: List[dict]):
        """Load overlay configuration"""
        for item in config:
            if item.get("source_file"):
                overlay = load_overlay(item["source_file"])
                if overlay:
                    overlay.enabled = item.get("enabled", True)
                    overlay.color = item.get("color")
                    self.add_overlay(overlay, item.get("key"))


def render_overlay_to_radar(overlay: GeoOverlay,
                            center_lat: float, center_lon: float,
                            max_range: float,
                            radar_width: int, radar_height: int,
                            theme_color: str) -> List[Tuple[int, int, str, str]]:
    """
    Render an overlay to radar coordinates.
    Returns list of (x, y, char, color) tuples.
    """
    render_points = []
    color = overlay.color or theme_color

    center_x = radar_width // 2
    center_y = radar_height // 2
    max_radius = min(radar_width // 2, radar_height) - 1

    for feature in overlay.features:
        if feature.type == OverlayType.POINT:
            for point in feature.points:
                dist = haversine_distance(center_lat, center_lon, point.lat, point.lon)
                if dist <= max_range:
                    brg = bearing_between(center_lat, center_lon, point.lat, point.lon)
                    x, y = _geo_to_radar(dist, brg, max_range, center_x, center_y, max_radius)
                    if 0 <= x < radar_width and 0 <= y < radar_height:
                        char = point.label[0] if point.label else '◇'
                        render_points.append((x, y, char, color))

        elif feature.type in (OverlayType.LINE, OverlayType.POLYGON):
            # Render line segments
            points = feature.points
            if feature.type == OverlayType.POLYGON and points and points[0] != points[-1]:
                points = points + [points[0]]  # Close polygon

            for i in range(len(points) - 1):
                p1, p2 = points[i], points[i + 1]

                # Get radar coords for both points
                dist1 = haversine_distance(center_lat, center_lon, p1.lat, p1.lon)
                dist2 = haversine_distance(center_lat, center_lon, p2.lat, p2.lon)

                # Skip if both points are way out of range
                if dist1 > max_range * 1.5 and dist2 > max_range * 1.5:
                    continue

                brg1 = bearing_between(center_lat, center_lon, p1.lat, p1.lon)
                brg2 = bearing_between(center_lat, center_lon, p2.lat, p2.lon)

                x1, y1 = _geo_to_radar(dist1, brg1, max_range, center_x, center_y, max_radius)
                x2, y2 = _geo_to_radar(dist2, brg2, max_range, center_x, center_y, max_radius)

                # Draw line between points using Bresenham's algorithm
                line_points = _bresenham_line(x1, y1, x2, y2)
                for x, y in line_points:
                    if 0 <= x < radar_width and 0 <= y < radar_height:
                        render_points.append((x, y, '·', color))

    return render_points


def _geo_to_radar(distance: float, bearing: float, max_range: float,
                  center_x: int, center_y: int, max_radius: int) -> Tuple[int, int]:
    """Convert distance/bearing to radar screen coordinates"""
    if distance > max_range:
        # Clamp to edge
        distance = max_range

    radius = (distance / max_range) * max_radius
    angle_rad = math.radians(bearing - 90)  # 0° = North = up

    x = int(center_x + radius * math.cos(angle_rad) * 2)  # *2 for char aspect ratio
    y = int(center_y + radius * math.sin(angle_rad))

    return x, y


def _bresenham_line(x1: int, y1: int, x2: int, y2: int) -> List[Tuple[int, int]]:
    """Generate points along a line using Bresenham's algorithm"""
    points = []
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx - dy

    # Limit points for performance
    max_points = 200
    count = 0

    while count < max_points:
        points.append((x1, y1))
        count += 1

        if x1 == x2 and y1 == y2:
            break

        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x1 += sx
        if e2 < dx:
            err += dx
            y1 += sy

    return points
