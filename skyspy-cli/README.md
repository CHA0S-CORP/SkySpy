# SkySpy Radio & Radar - Retro CLI Aircraft Monitor

```
╔══════════════════════════════════════════════════════════════════════════════════════════════╗
║ ░░░ SKYSPY RADAR ░░░ ═══════════════════════ ADS-B TACTICAL DISPLAY ═══════════ ◐ LIVE ◐   ║
╠══════════════════════════════════════════════════════════════════════════════════════════════╣
║                              N                                    ┌─ TARGET ───────────┐    ║
║                    ·    ·    │    ·    ·                          │  UAL1234           │    ║
║               ·              │              ·                     │  A12345 MIL        │    ║
║          ·         ✦UAL123   │                  ·                 │                    │    ║
║                              │         ◆MIL01                     │  TYPE   B738       │    ║
║     W ──────────────────────╋──────────────────────── E          │  ALT    FL350      │    ║
║                         ░░░░░│                                    │  GS     450 kt     │    ║
║          ·              ◉DAL456 ─›                 ·              │  VS     +500 fpm   │    ║
║               ·              │              ·                     │  DIST   23.4 nm    │    ║
║                    ·    ·    │    ·    ·                          │  SIG    █████      │    ║
║                              S                                    └────────────────────┘    ║
╠══════════════════════════════════════════════════════════════════════════════════════════════╣
║          ◉ ONLINE │ TGT: 42 │ RNG: 100nm │ Classic Green │ 14:32:01                         ║
╚══════════════════════════════════════════════════════════════════════════════════════════════╝
```

A nostalgic, old-school terminal interface for live aircraft tracking with **9 color themes**, persistent settings, and a full-featured interactive radar scope.

## Features

### Display Modes
- **Radar Scope** - PPI-style tactical display with animated sweep
- **Settings Menu** - In-app theme selection and configuration
- **Help Overlay** - Quick reference for all commands

### Theming System
Choose from 9 built-in color themes:

| Theme | Description |
|-------|-------------|
| `classic` | Traditional green phosphor display |
| `amber` | Vintage amber monochrome |
| `ice` | Cold blue tactical display |
| `cyberpunk` | Neon pink/cyan futuristic |
| `military` | Tactical green/tan |
| `high_contrast` | Maximum visibility white |
| `phosphor` | Realistic CRT phosphor glow |
| `sunset` | Warm orange tones |
| `matrix` | Matrix digital rain inspired |
| `ocean` | Deep blue oceanic |

### Persistent Settings
Settings are saved to `~/.config/skyspy/settings.json`:
- Selected theme
- Display preferences (labels, ACARS panel)
- Radar settings (range, sweep speed)
- Filter settings (military only, hide ground)
- Connection settings (host, port, receiver location)

### Interactive Features
- **Selectable Targets** - Navigate and select aircraft
- **Adjustable Range** - 25/50/100/200/400nm
- **Live Filters** - Military only, hide ground traffic
- **ACARS Feed** - Real-time data link messages
- **Notifications** - Temporary status messages

## Installation

```bash
cd skyspy-cli
pip install -e .
```

Or install dependencies directly:

```bash
pip install rich websockets httpx click
```

## Usage

### Basic Usage
```bash
python skyspy_radar.py
```

### With Options
```bash
python skyspy_radar.py --host localhost --port 80 --lat 40.7128 --lon -74.0060
```

### List Themes
```bash
python skyspy_radar.py --list-themes
```

### Start with Theme
```bash
python skyspy_radar.py --theme cyberpunk
```

### After Installation
```bash
skyspy-radar --host localhost --port 80
skyspy-radar --theme matrix
skyspy-radar --list-themes
```

## Keyboard Controls

### Navigation
| Key | Action |
|-----|--------|
| `↑` / `k` | Select previous target |
| `↓` / `j` | Select next target |
| `+` / `=` | Zoom out (increase range) |
| `-` / `_` | Zoom in (decrease range) |

### Display
| Key | Action |
|-----|--------|
| `L` | Toggle callsign labels |
| `M` | Toggle military-only filter |
| `G` | Toggle ground traffic filter |
| `A` | Toggle ACARS panel |

### Settings
| Key | Action |
|-----|--------|
| `T` | Open theme settings |
| `?` / `H` | Show help overlay |
| `Q` | Quit (saves settings) |

### In Settings Menu
| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate themes |
| `Enter` / `Space` | Apply theme |
| `T` / `Esc` | Close settings |

## Radar Symbols

```
✦  Normal aircraft (theme color)
◉  Selected target (yellow)
◆  Military aircraft (magenta)
!  Emergency squawk (blinking red)
─› Heading vector for selected target
╋  Receiver position (center)
·  Range ring marker
```

## Theme Preview

### Classic Green
```
╔═══════════════╗
║    ·  N  ·    ║  Traditional green phosphor
║  ·    │    ·  ║  like vintage radar displays
║ W ────╋──── E ║
║  · ✦DAL ·     ║
║    ·  S  ·    ║
╚═══════════════╝
```

### Cyberpunk
```
╔═══════════════╗
║    ·  N  ·    ║  Neon magenta/cyan
║  ·    │    ·  ║  futuristic aesthetic
║ W ────╋──── E ║
║  · ✦DAL ·     ║
║    ·  S  ·    ║
╚═══════════════╝
```

## Configuration File

Settings are persisted at `~/.config/skyspy/settings.json`:

```json
{
  "display": {
    "theme": "classic",
    "show_labels": true,
    "show_acars": true,
    "refresh_rate": 10
  },
  "radar": {
    "default_range": 100,
    "range_rings": 4,
    "sweep_speed": 6,
    "show_compass": true
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
  }
}
```

## CLI Options

```
Options:
  --host TEXT          Server hostname
  --port INTEGER       Server port
  --lat FLOAT          Receiver latitude
  --lon FLOAT          Receiver longitude
  --range INTEGER      Initial range in nm
  --theme TEXT         Color theme
  --list-themes        List available themes
  --help               Show this message and exit
```

## Requirements

- Python 3.9+
- Terminal with Unicode and color support
- Terminal size: 100x40 characters recommended
- SkySpy backend running

## Project Structure

```
skyspy-cli/
├── skyspy_radar.py      # Main radar application
├── skyspy_radio.py      # Classic radio display
├── skyspy_radio_pro.py  # Pro radio with VU meters
├── config.py            # Configuration management
├── themes.py            # Theme definitions
├── requirements.txt     # Python dependencies
├── pyproject.toml       # Package configuration
└── README.md            # This file
```

## Tips

1. **Set receiver location** with `--lat` and `--lon` for accurate distance/bearing
2. **Press T** to quickly switch themes without restarting
3. **Settings auto-save** when you quit with Q
4. **Military filter (M)** is great for spotting interesting traffic
5. **Use themes** to match your terminal or reduce eye strain

## Troubleshooting

**No aircraft showing?**
- Verify the SkySpy backend is running
- Check host/port settings
- Ensure receiver coordinates are set

**Colors look wrong?**
- Ensure terminal supports 256 colors
- Try `high_contrast` theme for basic terminals
- Check terminal color scheme compatibility

**Display too small?**
- Increase terminal size (100x40 minimum)
- Some themes work better at larger sizes

---

73 de SkySpy Radio - Clear skies!
