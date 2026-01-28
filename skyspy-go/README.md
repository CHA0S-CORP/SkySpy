# SkySpy Radar Pro (Go)

A native Go implementation of the SkySpy CLI radar display, providing real-time aircraft tracking with a terminal-based radar scope interface.

## Features

- **Real-time Radar Display**: Animated radar scope with sweep effect
- **WebSocket Integration**: Live aircraft data via WebSocket connection
- **10 Color Themes**: Classic green, Amber, Ice, Cyberpunk, Military, High Contrast, Phosphor, Sunset, Matrix, Ocean
- **Geographic Overlays**: Load GeoJSON files for airspace boundaries, coastlines, etc.
- **ACARS Display**: View decoded ACARS messages
- **VU Meters & Spectrum**: Visual activity indicators
- **Target Selection**: Navigate and select aircraft for detailed information
- **Filters**: Military-only mode, ground filtering
- **Persistent Settings**: Configuration saved to `~/.config/skyspy/settings.json`

## Installation

### From Source

```bash
# Clone and build
cd skyspy-go
go build -o skyspy ./cmd/skyspy

# Run
./skyspy --host localhost --port 80
```

### Cross-Platform Builds

```bash
# Linux
GOOS=linux GOARCH=amd64 go build -o skyspy-linux ./cmd/skyspy

# Windows
GOOS=windows GOARCH=amd64 go build -o skyspy.exe ./cmd/skyspy

# macOS (Intel)
GOOS=darwin GOARCH=amd64 go build -o skyspy-mac-intel ./cmd/skyspy

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o skyspy-mac-arm ./cmd/skyspy
```

## Usage

```bash
# Basic usage (connects to localhost:80)
./skyspy

# Connect to specific server
./skyspy --host 192.168.1.100 --port 8080

# Set receiver location for distance/bearing calculations
./skyspy --lat 40.7128 --lon -74.0060

# Set initial range
./skyspy --range 50

# Use specific theme
./skyspy --theme cyberpunk

# Load geographic overlays
./skyspy --overlay /path/to/airspace.geojson

# List available themes
./skyspy --list-themes
```

## Keyboard Controls

### Navigation
| Key | Action |
|-----|--------|
| `↑`/`k` | Select previous target |
| `↓`/`j` | Select next target |
| `+`/`=` | Zoom out (increase range) |
| `-`/`_` | Zoom in (decrease range) |

### Display Toggles
| Key | Action |
|-----|--------|
| `L` | Toggle labels |
| `M` | Toggle military-only filter |
| `G` | Toggle ground aircraft filter |
| `A` | Toggle ACARS panel |
| `V` | Toggle VU meters |
| `S` | Toggle spectrum display |

### Panels
| Key | Action |
|-----|--------|
| `T` | Open themes/settings |
| `O` | Open overlays manager |
| `?`/`H` | Open help |
| `Q` | Quit |

## Radar Symbols

| Symbol | Meaning |
|--------|---------|
| `✦` | Normal aircraft |
| `◉` | Selected aircraft |
| `◆` | Military aircraft |
| `!`/`✖` | Emergency (squawk 7500/7600/7700) |

## Architecture

```
skyspy-go/
├── cmd/skyspy/
│   └── main.go           # CLI entry point (Cobra)
├── internal/
│   ├── app/
│   │   ├── app.go        # Bubble Tea model
│   │   └── view.go       # View rendering
│   ├── radar/
│   │   └── scope.go      # Radar scope rendering
│   ├── ws/
│   │   └── client.go     # WebSocket client
│   ├── config/
│   │   └── config.go     # Configuration management
│   ├── theme/
│   │   └── theme.go      # Theme definitions
│   └── geo/
│       └── overlay.go    # Geographic overlay support
├── go.mod
├── go.sum
└── README.md
```

## Dependencies

- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - TUI framework
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Styling
- [Gorilla WebSocket](https://github.com/gorilla/websocket) - WebSocket client
- [Cobra](https://github.com/spf13/cobra) - CLI framework

## Configuration

Settings are stored in `~/.config/skyspy/settings.json`:

```json
{
  "display": {
    "theme": "classic",
    "show_labels": true,
    "refresh_rate": 10,
    "show_acars": true,
    "show_vu_meters": true,
    "show_spectrum": true
  },
  "radar": {
    "default_range": 100,
    "range_rings": 4,
    "sweep_speed": 6,
    "show_compass": true,
    "show_overlays": true
  },
  "filters": {
    "military_only": false,
    "hide_ground": false
  },
  "connection": {
    "host": "localhost",
    "port": 80,
    "receiver_lat": 0.0,
    "receiver_lon": 0.0
  },
  "overlays": {
    "overlays": []
  }
}
```

## Compared to Python Version

| Feature | Python | Go |
|---------|--------|----|
| Binary size | N/A (requires Python) | ~12MB single binary |
| Startup time | Slower | Fast |
| Dependencies | pip install | None (static binary) |
| Cross-platform | Via Python | Native binaries |
| Memory usage | Higher | Lower |

## License

MIT
