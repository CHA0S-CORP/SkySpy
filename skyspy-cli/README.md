# SkySpy Radio & Radar - Retro CLI Aircraft Monitor

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ ░░░ SKYSPY RADAR ░░░ ═══════════════════════ ADS-B TACTICAL DISPLAY ═══════ ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                              N                                               ║
║                              │                                               ║
║                    ·    ·    │    ·    ·                                     ║
║               ·              │              ·                                ║
║          ·         ✦UAL123   │                  ·                            ║
║                              │         ◆MIL01                                ║
║     W ──────────────────────╋──────────────────────── E                     ║
║                              │                                               ║
║          ·              ◉DAL456 ←                    ·                       ║
║               ·              │              ·                                ║
║                    ·    ·    │    ·    ·                                     ║
║                              │                                               ║
║                              S                                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

A nostalgic, old-school terminal interface for live aircraft tracking. Three modes available:

- **Radio** - Classic list-based display with signal meters
- **Radio Pro** - Enhanced with VU meters and spectrum analyzer
- **Radar** - Interactive tactical scope with selectable targets

## Features

### All Modes
- **Live Aircraft Tracking** - Real-time ADS-B data
- **ACARS/VDL2 Feed** - Data link messages as they arrive
- **Military Detection** - Highlighted military aircraft
- **Emergency Alerts** - Squawk 7500/7600/7700 detection

### Radar Mode Exclusive
- **Tactical Scope Display** - PPI-style radar with sweep animation
- **Selectable Targets** - Navigate and select aircraft with keyboard
- **Range Rings** - Adjustable range (25/50/100/200/400nm)
- **Target Info Panel** - Detailed data for selected aircraft
- **Bearing/Distance** - Calculated from receiver position
- **Military Filter** - Show only military traffic

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

### Radio Mode (Classic)
```bash
python skyspy_radio.py --host localhost --port 80
```

### Radio Pro Mode (VU Meters)
```bash
python skyspy_radio_pro.py --host localhost --port 80
```

### Radar Mode (Tactical Scope)
```bash
python skyspy_radar.py --host localhost --port 80 --lat 40.7128 --lon -74.0060
```

### After Installation
```bash
skyspy-radio --host localhost --port 80
skyspy-radio-pro --host localhost --port 80
skyspy-radar --host localhost --port 80 --lat YOUR_LAT --lon YOUR_LON
```

## Radar Controls

| Key | Action |
|-----|--------|
| `↑` / `k` | Select previous target |
| `↓` / `j` | Select next target |
| `+` / `=` | Zoom out (increase range) |
| `-` / `_` | Zoom in (decrease range) |
| `L` | Toggle callsign labels |
| `M` | Toggle military-only filter |
| `Q` | Quit |

## Display Elements

### Radar Symbols

```
✦  Normal aircraft target
◉  Selected target (yellow)
◆  Military aircraft (magenta)
!  Emergency squawk (blinking red)
→  Heading indicator for selected target
╋  Receiver/center position
```

### Target Info Panel

```
┌─ TARGET ─────────────┐
│  UAL1234             │  ← Callsign
│  A12345 [MIL]        │  ← ICAO hex + flags
│                      │
│  TYPE   B738         │
│  ALT    FL350        │
│  GS     450 kt       │
│  VS     +500 fpm     │
│  HDG    045°         │
│  DIST   23.4 nm      │
│  BRG    067°         │
│  SQUAWK 1200         │
│  RSSI   █████        │
└──────────────────────┘
```

### Signal Meter
```
█████ = Strong (> -3 dB)
███░░ = Medium
█░░░░ = Weak (< -24 dB)
```

## Range Options

The radar supports these range settings (in nautical miles):
- 25nm - Close range, airport vicinity
- 50nm - Local area
- 100nm - Regional (default)
- 200nm - Extended range
- 400nm - Maximum range

## Requirements

- Python 3.9+
- Terminal with Unicode support (most modern terminals)
- Terminal size: minimum 100x40 characters recommended
- SkySpy backend running

## The Retro Vibe

This CLI is designed to evoke the feel of vintage aviation electronics:

- **Radar Mode**: Inspired by air traffic control PPI scopes
- **Radio Mode**: Classic green phosphor terminal aesthetic
- **Pro Mode**: Adds VU meters like vintage radio equipment

```
┌────────────────────────────────────────┐
│  ● 1090.000 MHz [ADS-B]                │
│  ○ 136.900 MHz [ACARS]                 │
│  ○ 136.725 MHz [VDL2]                  │
│  ○ 121.500 MHz [GUARD]                 │
│                                        │
│  ████████████████████░░░░              │
│        ↑ spectrum analyzer             │
└────────────────────────────────────────┘
```

## Tips

1. **Set your receiver location** with `--lat` and `--lon` for accurate distance/bearing calculations
2. **Use military filter** (`M` key) to focus on interesting traffic
3. **Zoom in** when tracking nearby aircraft for better resolution
4. **Watch the ACARS panel** for decoded aircraft messages

## Troubleshooting

**No aircraft showing?**
- Verify the SkySpy backend is running
- Check the WebSocket URL is correct
- Ensure you have aircraft in range

**Display looks wrong?**
- Increase terminal size (100x40 minimum)
- Use a terminal with good Unicode support
- Try a different terminal emulator

---

73 de SkySpy Radio - Clear skies!
