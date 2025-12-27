"""
Static US airspace boundary data.

Contains GeoJSON-style polygon data for major controlled airspace areas.
Data represents approximate boundaries - refer to official FAA charts for precise limits.

Airspace Classes:
- Class B: Major hub airports (requires ATC clearance)
- Class C: Busy airports with radar approach control
- Class D: Airports with control towers
- MOA: Military Operations Area (alerts for military training)
- Restricted: Restricted airspace (flight prohibited without permission)
"""

# Major Class B airspace boundaries (simplified polygons)
# Each entry contains: name, icao, class, floor (AGL), ceiling (MSL), polygon coordinates
CLASS_B_AIRSPACE = [
    {
        "name": "Los Angeles Class B",
        "icao": "KLAX",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 10000,
        "center": {"lat": 33.9425, "lon": -118.4081},
        "polygon": [
            [-118.60, 34.10], [-118.20, 34.15], [-117.90, 34.05],
            [-117.85, 33.85], [-117.95, 33.70], [-118.25, 33.65],
            [-118.55, 33.75], [-118.65, 33.95], [-118.60, 34.10]
        ]
    },
    {
        "name": "San Francisco Class B",
        "icao": "KSFO",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 10000,
        "center": {"lat": 37.6213, "lon": -122.3790},
        "polygon": [
            [-122.60, 37.80], [-122.25, 37.85], [-122.05, 37.70],
            [-122.05, 37.45], [-122.25, 37.35], [-122.55, 37.40],
            [-122.65, 37.60], [-122.60, 37.80]
        ]
    },
    {
        "name": "Seattle Class B",
        "icao": "KSEA",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 10000,
        "center": {"lat": 47.4502, "lon": -122.3088},
        "polygon": [
            [-122.55, 47.65], [-122.15, 47.70], [-122.00, 47.55],
            [-122.00, 47.30], [-122.20, 47.15], [-122.50, 47.20],
            [-122.60, 47.40], [-122.55, 47.65]
        ]
    },
    {
        "name": "Denver Class B",
        "icao": "KDEN",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 12000,
        "center": {"lat": 39.8561, "lon": -104.6737},
        "polygon": [
            [-105.00, 40.10], [-104.45, 40.10], [-104.30, 39.90],
            [-104.35, 39.65], [-104.60, 39.55], [-104.95, 39.60],
            [-105.10, 39.85], [-105.00, 40.10]
        ]
    },
    {
        "name": "Chicago O'Hare Class B",
        "icao": "KORD",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 10000,
        "center": {"lat": 41.9742, "lon": -87.9073},
        "polygon": [
            [-88.20, 42.20], [-87.65, 42.25], [-87.45, 42.05],
            [-87.45, 41.75], [-87.70, 41.60], [-88.10, 41.65],
            [-88.30, 41.90], [-88.20, 42.20]
        ]
    },
    {
        "name": "Atlanta Class B",
        "icao": "KATL",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 12500,
        "center": {"lat": 33.6407, "lon": -84.4277},
        "polygon": [
            [-84.70, 33.90], [-84.20, 33.95], [-84.00, 33.75],
            [-84.05, 33.45], [-84.30, 33.30], [-84.65, 33.40],
            [-84.80, 33.65], [-84.70, 33.90]
        ]
    },
    {
        "name": "Dallas/Fort Worth Class B",
        "icao": "KDFW",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 11000,
        "center": {"lat": 32.8998, "lon": -97.0403},
        "polygon": [
            [-97.35, 33.15], [-96.80, 33.20], [-96.60, 33.00],
            [-96.65, 32.70], [-96.90, 32.55], [-97.30, 32.60],
            [-97.50, 32.85], [-97.35, 33.15]
        ]
    },
    {
        "name": "New York Class B",
        "icao": "KJFK",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 7000,
        "center": {"lat": 40.6413, "lon": -73.7781},
        "polygon": [
            [-74.20, 40.90], [-73.60, 40.95], [-73.40, 40.75],
            [-73.45, 40.45], [-73.70, 40.35], [-74.10, 40.40],
            [-74.30, 40.65], [-74.20, 40.90]
        ]
    },
    {
        "name": "Boston Class B",
        "icao": "KBOS",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 7000,
        "center": {"lat": 42.3656, "lon": -71.0096},
        "polygon": [
            [-71.25, 42.55], [-70.80, 42.60], [-70.65, 42.45],
            [-70.70, 42.20], [-70.90, 42.10], [-71.20, 42.15],
            [-71.35, 42.35], [-71.25, 42.55]
        ]
    },
    {
        "name": "Miami Class B",
        "icao": "KMIA",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 7000,
        "center": {"lat": 25.7959, "lon": -80.2870},
        "polygon": [
            [-80.50, 26.00], [-80.10, 26.05], [-79.95, 25.90],
            [-80.00, 25.60], [-80.20, 25.50], [-80.50, 25.55],
            [-80.60, 25.80], [-80.50, 26.00]
        ]
    },
    {
        "name": "Phoenix Class B",
        "icao": "KPHX",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 9000,
        "center": {"lat": 33.4373, "lon": -112.0078},
        "polygon": [
            [-112.30, 33.65], [-111.80, 33.70], [-111.60, 33.50],
            [-111.65, 33.25], [-111.90, 33.15], [-112.25, 33.20],
            [-112.40, 33.45], [-112.30, 33.65]
        ]
    },
    {
        "name": "Las Vegas Class B",
        "icao": "KLAS",
        "class": "B",
        "floor_ft": 0,
        "ceiling_ft": 10000,
        "center": {"lat": 36.0840, "lon": -115.1537},
        "polygon": [
            [-115.40, 36.30], [-114.95, 36.35], [-114.80, 36.15],
            [-114.85, 35.90], [-115.05, 35.80], [-115.40, 35.85],
            [-115.55, 36.10], [-115.40, 36.30]
        ]
    },
]

# Sample Class C airspace (busy airports with radar)
CLASS_C_AIRSPACE = [
    {
        "name": "San Diego Class C",
        "icao": "KSAN",
        "class": "C",
        "floor_ft": 0,
        "ceiling_ft": 4200,
        "center": {"lat": 32.7336, "lon": -117.1897},
        "polygon": [
            [-117.30, 32.85], [-117.10, 32.87], [-117.00, 32.78],
            [-117.02, 32.62], [-117.15, 32.55], [-117.30, 32.60],
            [-117.38, 32.73], [-117.30, 32.85]
        ]
    },
    {
        "name": "Portland Class C",
        "icao": "KPDX",
        "class": "C",
        "floor_ft": 0,
        "ceiling_ft": 4100,
        "center": {"lat": 45.5898, "lon": -122.5951},
        "polygon": [
            [-122.75, 45.70], [-122.50, 45.72], [-122.40, 45.62],
            [-122.42, 45.48], [-122.55, 45.42], [-122.75, 45.47],
            [-122.82, 45.58], [-122.75, 45.70]
        ]
    },
    {
        "name": "Austin Class C",
        "icao": "KAUS",
        "class": "C",
        "floor_ft": 0,
        "ceiling_ft": 4600,
        "center": {"lat": 30.1975, "lon": -97.6664},
        "polygon": [
            [-97.80, 30.32], [-97.55, 30.35], [-97.45, 30.25],
            [-97.47, 30.08], [-97.60, 30.00], [-97.80, 30.05],
            [-97.88, 30.18], [-97.80, 30.32]
        ]
    },
    {
        "name": "Nashville Class C",
        "icao": "KBNA",
        "class": "C",
        "floor_ft": 0,
        "ceiling_ft": 4600,
        "center": {"lat": 36.1263, "lon": -86.6774},
        "polygon": [
            [-86.82, 36.25], [-86.55, 36.28], [-86.45, 36.18],
            [-86.48, 36.00], [-86.62, 35.92], [-86.82, 35.97],
            [-86.90, 36.10], [-86.82, 36.25]
        ]
    },
    {
        "name": "Raleigh-Durham Class C",
        "icao": "KRDU",
        "class": "C",
        "floor_ft": 0,
        "ceiling_ft": 4500,
        "center": {"lat": 35.8801, "lon": -78.7880},
        "polygon": [
            [-78.92, 36.00], [-78.67, 36.03], [-78.57, 35.93],
            [-78.60, 35.75], [-78.73, 35.68], [-78.92, 35.72],
            [-79.00, 35.85], [-78.92, 36.00]
        ]
    },
]

# Sample Military Operations Areas (MOAs)
MOA_AIRSPACE = [
    {
        "name": "Warning Area W-237",
        "class": "MOA",
        "floor_ft": 0,
        "ceiling_ft": 50000,
        "center": {"lat": 33.50, "lon": -117.80},
        "polygon": [
            [-118.20, 33.80], [-117.50, 33.80], [-117.40, 33.20],
            [-118.10, 33.20], [-118.20, 33.80]
        ],
        "schedule": "Published NOTAMs",
        "controlling_agency": "Los Angeles Center"
    },
    {
        "name": "Fallon MOA",
        "class": "MOA",
        "floor_ft": 100,
        "ceiling_ft": 50000,
        "center": {"lat": 39.50, "lon": -118.50},
        "polygon": [
            [-119.00, 40.00], [-118.00, 40.00], [-117.80, 39.00],
            [-118.80, 39.00], [-119.00, 40.00]
        ],
        "schedule": "Published NOTAMs",
        "controlling_agency": "Oakland Center"
    },
    {
        "name": "Nellis Range Complex",
        "class": "Restricted",
        "floor_ft": 0,
        "ceiling_ft": 99999,
        "center": {"lat": 37.00, "lon": -116.00},
        "polygon": [
            [-116.50, 37.50], [-115.50, 37.50], [-115.30, 36.50],
            [-116.30, 36.50], [-116.50, 37.50]
        ],
        "schedule": "Continuous",
        "controlling_agency": "Nellis AFB"
    },
]

# Sample Class D airspace (smaller towered airports)
CLASS_D_AIRSPACE = [
    {
        "name": "Santa Monica Class D",
        "icao": "KSMO",
        "class": "D",
        "floor_ft": 0,
        "ceiling_ft": 2500,
        "center": {"lat": 34.0158, "lon": -118.4513},
        "radius_nm": 4.4
    },
    {
        "name": "Torrance Class D",
        "icao": "KTOA",
        "class": "D",
        "floor_ft": 0,
        "ceiling_ft": 2500,
        "center": {"lat": 33.8034, "lon": -118.3396},
        "radius_nm": 4.3
    },
    {
        "name": "Van Nuys Class D",
        "icao": "KVNY",
        "class": "D",
        "floor_ft": 0,
        "ceiling_ft": 2900,
        "center": {"lat": 34.2098, "lon": -118.4899},
        "radius_nm": 4.3
    },
    {
        "name": "Long Beach Class D",
        "icao": "KLGB",
        "class": "D",
        "floor_ft": 0,
        "ceiling_ft": 2600,
        "center": {"lat": 33.8177, "lon": -118.1516},
        "radius_nm": 5.0
    },
    {
        "name": "Palo Alto Class D",
        "icao": "KPAO",
        "class": "D",
        "floor_ft": 0,
        "ceiling_ft": 2500,
        "center": {"lat": 37.4611, "lon": -122.1150},
        "radius_nm": 3.7
    },
]


def get_all_airspace_boundaries():
    """Return all static airspace boundaries."""
    return {
        "class_b": CLASS_B_AIRSPACE,
        "class_c": CLASS_C_AIRSPACE,
        "class_d": CLASS_D_AIRSPACE,
        "moa": MOA_AIRSPACE,
    }


def get_airspaces_near_point(lat: float, lon: float, radius_nm: float = 100):
    """
    Filter airspaces within a radius of a point.
    Uses a simple bounding box check for performance.
    """
    # Approximate degrees per NM at given latitude
    nm_per_deg_lat = 60
    nm_per_deg_lon = 60 * abs(cos(radians(lat)))

    lat_range = radius_nm / nm_per_deg_lat
    lon_range = radius_nm / nm_per_deg_lon if nm_per_deg_lon > 0 else radius_nm / 60

    results = []

    all_airspaces = [
        *CLASS_B_AIRSPACE,
        *CLASS_C_AIRSPACE,
        *CLASS_D_AIRSPACE,
        *MOA_AIRSPACE,
    ]

    for airspace in all_airspaces:
        center = airspace.get("center", {})
        a_lat = center.get("lat", 0)
        a_lon = center.get("lon", 0)

        # Simple bounding box check
        if (abs(a_lat - lat) <= lat_range and abs(a_lon - lon) <= lon_range):
            results.append(airspace)

    return results


from math import radians, cos
