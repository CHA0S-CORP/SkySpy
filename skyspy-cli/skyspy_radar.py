#!/usr/bin/env python3
"""
SkySpy Radar Pro - Full-Featured Radar Scope Display
Interactive aircraft tracking with overlays, VU meters, spectrum, and themes
"""

import asyncio
import json
import math
import sys
import os
import random
from datetime import datetime
from collections import deque
from typing import Optional, Tuple, List
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import click
import websockets
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.layout import Layout
from rich.align import Align
from rich.columns import Columns
from rich import box

from config import Config, load_config, save_config, get_overlays_dir
from themes import get_theme, list_themes, get_theme_info, Theme
from geo import (
    OverlayManager, load_overlay, render_overlay_to_radar,
    create_range_ring_overlay, GeoOverlay
)

console = Console()

# Radar dimensions
RADAR_WIDTH = 55
RADAR_HEIGHT = 27
RADAR_CENTER_X = RADAR_WIDTH // 2
RADAR_CENTER_Y = RADAR_HEIGHT // 2


class ViewMode(Enum):
    RADAR = "radar"
    SETTINGS = "settings"
    HELP = "help"
    OVERLAYS = "overlays"


@dataclass
class Target:
    """Radar target"""
    hex: str
    callsign: str
    lat: Optional[float]
    lon: Optional[float]
    alt: Optional[int]
    gs: Optional[float]
    track: Optional[float]
    vs: Optional[float]
    distance: Optional[float]
    bearing: Optional[float]
    rssi: Optional[float]
    squawk: Optional[str]
    ac_type: Optional[str]
    military: bool
    last_seen: datetime
    age: float = 0


class RadarState:
    """Radar scope state with pro features"""
    def __init__(self, config: Config):
        self.config = config
        self.theme = get_theme(config.display.theme)
        self.targets: dict[str, Target] = {}
        self.selected_hex: Optional[str] = None
        self.sorted_targets: List[str] = []
        self.sweep_angle: float = 0
        self.max_range: float = config.radar.default_range
        self.range_idx: int = 2
        self.range_options = [25, 50, 100, 200, 400]
        self.receiver_lat: float = config.connection.receiver_lat
        self.receiver_lon: float = config.connection.receiver_lon
        self.acars_messages: deque = deque(maxlen=100)
        self.connected: bool = False
        self.msg_count: int = 0
        self.blink: bool = False
        self.frame: int = 0
        self.view_mode: ViewMode = ViewMode.RADAR
        self.settings_cursor: int = 0
        self.overlay_cursor: int = 0
        self.notification: Optional[str] = None
        self.notification_time: float = 0

        # Pro features
        self.vu_left: float = 0
        self.vu_right: float = 0
        self.spectrum: List[float] = [0.0] * 24
        self.peak_aircraft: int = 0
        self.session_messages: int = 0
        self.emergency_count: int = 0
        self.military_count: int = 0

        # Overlay manager
        self.overlay_manager = OverlayManager()
        self._load_overlays()

        # Find initial range
        for i, r in enumerate(self.range_options):
            if r >= self.max_range:
                self.range_idx = i
                self.max_range = r
                break

    def _load_overlays(self):
        """Load overlays from config"""
        for ov_config in self.config.overlays.overlays:
            path = ov_config.get("path", "")
            if path and os.path.exists(path):
                overlay = load_overlay(path)
                if overlay:
                    overlay.enabled = ov_config.get("enabled", True)
                    overlay.color = ov_config.get("color")
                    self.overlay_manager.add_overlay(overlay)

    def save_overlays(self):
        """Save overlay config"""
        self.config.overlays.overlays = self.overlay_manager.to_config()
        save_config(self.config)

    def set_theme(self, theme_name: str):
        self.theme = get_theme(theme_name)
        self.config.display.theme = theme_name
        save_config(self.config)
        self.notify(f"Theme: {self.theme.name}")

    def notify(self, message: str):
        self.notification = message
        self.notification_time = 3.0

    def update_stats(self):
        """Update statistics"""
        self.peak_aircraft = max(self.peak_aircraft, len(self.targets))
        self.military_count = sum(1 for t in self.targets.values() if t.military)
        self.emergency_count = sum(1 for t in self.targets.values()
                                   if t.squawk in ("7500", "7600", "7700"))


def haversine_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> Tuple[float, float]:
    """Calculate distance (nm) and bearing between two points"""
    R = 3440.065
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad)*math.cos(lat2_rad)*math.sin(delta_lon/2)**2
    distance = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    y = math.sin(delta_lon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad)*math.sin(lat2_rad) - math.sin(lat1_rad)*math.cos(lat2_rad)*math.cos(delta_lon)
    bearing = (math.degrees(math.atan2(y, x)) + 360) % 360

    return distance, bearing


def target_to_radar_pos(distance: float, bearing: float, max_range: float) -> Tuple[int, int]:
    """Convert distance/bearing to radar coordinates"""
    if distance > max_range:
        return -1, -1
    radius = (distance / max_range) * (min(RADAR_WIDTH, RADAR_HEIGHT * 2) // 2 - 2)
    angle_rad = math.radians(bearing - 90)
    x = int(RADAR_CENTER_X + radius * math.cos(angle_rad) * 2)
    y = int(RADAR_CENTER_Y + radius * math.sin(angle_rad))
    return x, y


def create_vu_meter(level: float, width: int = 15, theme: Theme = None) -> Text:
    """Create VU meter display"""
    text = Text()
    filled = int(level * width)
    for i in range(width):
        if i < filled:
            if i < width * 0.6:
                text.append("█", style=theme.success if theme else "green")
            elif i < width * 0.8:
                text.append("█", style=theme.warning if theme else "yellow")
            else:
                text.append("█", style=theme.error if theme else "red")
        else:
            text.append("░", style=theme.text_dim if theme else "dim")
    return text


def create_spectrum_display(state: RadarState) -> Text:
    """Create spectrum analyzer display"""
    theme = state.theme
    lines = []
    height = 5
    width = len(state.spectrum)

    for row in range(height, 0, -1):
        line = Text()
        threshold = row / height
        for col in range(width):
            if state.spectrum[col] >= threshold:
                if row <= 2:
                    line.append("▄", style=theme.success)
                elif row <= 4:
                    line.append("▄", style=theme.warning)
                else:
                    line.append("▄", style=theme.error)
            else:
                line.append(" ", style=theme.text_dim)
        lines.append(line)

    return Group(*lines)


def create_radar_scope(state: RadarState) -> Text:
    """Create radar scope with overlays"""
    theme = state.theme
    radar = [[' ' for _ in range(RADAR_WIDTH)] for _ in range(RADAR_HEIGHT)]
    colors = [[None for _ in range(RADAR_WIDTH)] for _ in range(RADAR_HEIGHT)]

    cx, cy = RADAR_CENTER_X, RADAR_CENTER_Y
    max_radius = min(RADAR_WIDTH // 2, RADAR_HEIGHT) - 1

    # Draw range rings
    for ring in range(1, state.config.radar.range_rings + 1):
        ring_radius = (ring / state.config.radar.range_rings) * max_radius
        for angle in range(0, 360, 4):
            angle_rad = math.radians(angle)
            x = int(cx + ring_radius * math.cos(angle_rad) * 2)
            y = int(cy + ring_radius * math.sin(angle_rad))
            if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT and radar[y][x] == ' ':
                radar[y][x] = '·'
                colors[y][x] = theme.radar_ring

    # Draw compass
    if state.config.radar.show_compass:
        for i in range(1, max_radius):
            for dy, dx, char in [(-i, 0, '│'), (i, 0, '│'), (0, i*2, '─'), (0, -i*2, '─')]:
                ny, nx = cy + dy, cx + dx
                if 0 <= nx < RADAR_WIDTH and 0 <= ny < RADAR_HEIGHT:
                    radar[ny][nx] = char
                    colors[ny][nx] = theme.radar_ring

        for label, dx, dy in [('N', 0, -max_radius), ('S', 0, max_radius),
                              ('E', max_radius*2, 0), ('W', -max_radius*2, 0)]:
            lx, ly = cx + dx, cy + dy
            if 0 <= lx < RADAR_WIDTH and 0 <= ly < RADAR_HEIGHT:
                radar[ly][lx] = label
                colors[ly][lx] = theme.secondary_bright

    radar[cy][cx] = '╋'
    colors[cy][cx] = theme.primary_bright

    # Draw overlays
    if state.config.radar.show_overlays and state.receiver_lat and state.receiver_lon:
        for overlay in state.overlay_manager.get_enabled_overlays():
            overlay_points = render_overlay_to_radar(
                overlay, state.receiver_lat, state.receiver_lon,
                state.max_range, RADAR_WIDTH, RADAR_HEIGHT,
                overlay.color or state.config.radar.overlay_color
            )
            for x, y, char, color in overlay_points:
                if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT:
                    if radar[y][x] in (' ', '·'):
                        radar[y][x] = char
                        colors[y][x] = color

    # Draw sweep
    sweep_rad = math.radians(state.sweep_angle - 90)
    for i in range(1, max_radius + 1):
        x = int(cx + i * math.cos(sweep_rad) * 2)
        y = int(cy + i * math.sin(sweep_rad))
        if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT:
            radar[y][x] = '░'
            colors[y][x] = theme.radar_sweep

    # Plot targets
    sorted_hexes = []
    for hex_code, target in state.targets.items():
        if target.distance is None or target.bearing is None:
            continue
        if state.config.filters.military_only and not target.military:
            continue
        if state.config.filters.hide_ground and target.alt and target.alt <= 0:
            continue

        x, y = target_to_radar_pos(target.distance, target.bearing, state.max_range)
        if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT:
            sorted_hexes.append((target.distance, hex_code, x, y))

    sorted_hexes.sort(key=lambda t: t[0])
    state.sorted_targets = [h[1] for h in sorted_hexes]

    for dist, hex_code, x, y in sorted_hexes:
        target = state.targets[hex_code]
        is_selected = hex_code == state.selected_hex

        if target.squawk in ("7500", "7600", "7700"):
            symbol = '!' if state.blink else '✖'
            color = theme.emergency
        elif target.military:
            symbol = '◆'
            color = theme.military
        elif is_selected:
            symbol = '◉'
            color = theme.selected
        else:
            symbol = '✦'
            color = theme.radar_target

        radar[y][x] = symbol
        colors[y][x] = color

        if state.config.display.show_labels and (is_selected or dist < state.max_range * 0.2):
            label = (target.callsign or hex_code)[:5]
            for j, ch in enumerate(label):
                lx = x + 1 + j
                if lx < RADAR_WIDTH:
                    radar[y][lx] = ch
                    colors[y][lx] = theme.selected if is_selected else theme.text_dim

        if is_selected and target.track is not None:
            hdg_rad = math.radians(target.track - 90)
            for v in range(1, 3):
                hx = int(x + v * math.cos(hdg_rad) * 2)
                hy = int(y + v * math.sin(hdg_rad))
                if 0 <= hx < RADAR_WIDTH and 0 <= hy < RADAR_HEIGHT:
                    radar[hy][hx] = '›' if v == 2 else '─'
                    colors[hy][hx] = theme.selected

    # Build output
    output = Text()
    range_str = f" {int(state.max_range)}nm "
    pad = (RADAR_WIDTH - len(range_str)) // 2
    output.append(f"╔{'═'*pad}{range_str}{'═'*(RADAR_WIDTH-pad-len(range_str))}╗\n", style=theme.border)

    for y in range(RADAR_HEIGHT):
        output.append("║", style=theme.border)
        for x in range(RADAR_WIDTH):
            output.append(radar[y][x], style=colors[y][x] or theme.text_dim)
        output.append("║\n", style=theme.border)

    output.append("╚" + "═" * RADAR_WIDTH + "╝", style=theme.border)
    return output


def create_target_panel(state: RadarState) -> Panel:
    """Target info panel"""
    theme = state.theme
    content = Text()

    if not state.selected_hex or state.selected_hex not in state.targets:
        content.append("  No target selected\n\n", style=theme.text_dim)
        content.append("  [↑↓] Select  [+-] Range\n", style=theme.text_dim)
        content.append("  [T] Themes   [O] Overlays\n", style=theme.text_dim)
        content.append("  [?] Help     [Q] Quit\n", style=theme.text_dim)
        return Panel(content, title=f"[{theme.primary_bright}]TARGET[/]",
                     border_style=theme.border, box=box.ROUNDED)

    t = state.targets[state.selected_hex]
    cs = t.callsign or "-------"

    content.append(f"  {cs}\n", style=f"bold {theme.selected}")
    content.append(f"  {t.hex.upper()}", style=theme.secondary_bright)
    if t.military:
        content.append(" MIL", style=f"bold {theme.military}")
    content.append("\n\n")

    rows = [
        ("TYPE", t.ac_type or "----", theme.primary_bright),
        ("ALT", f"FL{t.alt//100:03d}" if t.alt and t.alt >= 18000 else f"{t.alt:,}'" if t.alt else "----", theme.primary_bright),
        ("GS", f"{int(t.gs)} kt" if t.gs else "---", theme.primary_bright),
        ("VS", f"{'+' if t.vs>0 else ''}{int(t.vs)}" if t.vs else "---",
         theme.success if t.vs and t.vs > 0 else theme.error if t.vs else theme.text_dim),
        ("HDG", f"{int(t.track):03d}°" if t.track else "---", theme.primary_bright),
        ("DST", f"{t.distance:.1f}nm" if t.distance else "---", theme.secondary_bright),
        ("BRG", f"{int(t.bearing):03d}°" if t.bearing else "---", theme.secondary_bright),
        ("SQ", t.squawk or "----", theme.emergency if t.squawk in ("7500","7600","7700") else theme.primary_bright),
    ]

    for label, value, color in rows:
        content.append(f"  {label:4} ", style=theme.text_dim)
        content.append(f"{value}\n", style=color)

    content.append(f"  {'SIG':4} ", style=theme.text_dim)
    if t.rssi is not None:
        bars = min(5, max(0, int((t.rssi + 30) / 6)))
        content.append("█" * bars, style=theme.success if bars > 2 else theme.warning)
        content.append("░" * (5 - bars), style=theme.text_dim)
    else:
        content.append("░░░░░", style=theme.text_dim)

    return Panel(content, title=f"[{theme.primary_bright}]◄ TARGET ►[/]",
                 border_style=theme.border, box=box.ROUNDED)


def create_stats_panel(state: RadarState) -> Panel:
    """Statistics panel with VU meters"""
    theme = state.theme
    content = Text()

    # Connection
    if state.connected:
        ind = "◉" if state.blink else "○"
        content.append(f"  {ind} ", style=theme.success)
        content.append("RECEIVING\n", style=f"bold {theme.success}")
    else:
        content.append("  ○ ", style=theme.error)
        content.append("OFFLINE\n", style=f"bold {theme.error}")

    content.append("\n")

    # Stats
    stats = [
        ("TGT", f"{len(state.targets):3d}", theme.secondary_bright),
        ("PEAK", f"{state.peak_aircraft:3d}", theme.warning),
        ("MIL", f"{state.military_count:3d}", theme.military),
        ("EMRG", f"{state.emergency_count:3d}", theme.emergency if state.emergency_count else theme.text_dim),
        ("MSG", f"{state.session_messages}", theme.info),
    ]

    for label, value, color in stats:
        content.append(f"  {label:4} ", style=theme.text_dim)
        content.append(f"{value}\n", style=color)

    # VU Meters
    if state.config.display.show_vu_meters:
        content.append("\n  VU L ", style=theme.text_dim)
        content.append_text(create_vu_meter(state.vu_left, 10, theme))
        content.append("\n  VU R ", style=theme.text_dim)
        content.append_text(create_vu_meter(state.vu_right, 10, theme))
        content.append("\n")

    return Panel(content, title=f"[{theme.primary_bright}]STATUS[/]",
                 border_style=theme.border, box=box.ROUNDED)


def create_freq_panel(state: RadarState) -> Panel:
    """Frequency panel with spectrum"""
    theme = state.theme
    content = Text()

    freqs = [
        ("1090.000", "ADS-B", theme.success),
        ("136.900", "ACARS", theme.info),
        ("136.725", "VDL2", theme.secondary_bright),
        ("121.500", "GUARD", theme.error),
    ]

    for freq, label, color in freqs:
        ind = "●" if state.blink and random.random() > 0.7 else "○"
        content.append(f"  {ind} ", style=color if ind == "●" else theme.text_dim)
        content.append(f"{freq} ", style=color)
        content.append(f"[{label}]\n", style=theme.text_dim)

    if state.config.display.show_spectrum:
        content.append("\n  ")
        content.append_text(create_spectrum_display(state))

    return Panel(content, title=f"[{theme.primary_bright}]FREQ[/]",
                 border_style=theme.border, box=box.ROUNDED)


def create_target_list(state: RadarState) -> Panel:
    """Target list panel"""
    theme = state.theme
    table = Table(box=None, padding=(0, 0), expand=True, show_header=True,
                  header_style=f"bold {theme.primary}")
    table.add_column("", width=1)
    table.add_column("CALL", width=7)
    table.add_column("ALT", width=4, justify="right")
    table.add_column("D", width=3, justify="right")

    for hex_code in state.sorted_targets[:8]:
        if hex_code not in state.targets:
            continue
        t = state.targets[hex_code]
        is_sel = hex_code == state.selected_hex

        marker = Text("▶" if is_sel else " ", style=theme.selected if is_sel else "")
        cs = Text((t.callsign or t.hex)[:6], style=f"bold {theme.selected}" if is_sel else theme.secondary)
        alt = f"{t.alt//100}" if t.alt and t.alt >= 1000 else "GND" if t.alt == 0 else "---"
        dist = f"{t.distance:.0f}" if t.distance else "-"

        table.add_row(marker, cs, alt, dist)

    return Panel(table, title=f"[{theme.primary_bright}]LIST ({len(state.targets)})[/]",
                 border_style=theme.border, box=box.ROUNDED)


def create_acars_panel(state: RadarState) -> Panel:
    """ACARS feed panel"""
    theme = state.theme
    lines = []

    for msg in list(state.acars_messages)[-6:]:
        line = Text()
        cs = (msg.get("callsign") or msg.get("flight", ""))[:6]
        label = msg.get("label", "--")
        text = (msg.get("text", "") or "-")[:30]

        line.append(f"{cs:<6} ", style=theme.secondary_bright)
        line.append(f"{label:2} ", style=theme.primary)
        line.append(text, style=theme.text_dim)
        lines.append(line)

    if not lines:
        lines.append(Text("  Awaiting ACARS...", style=theme.text_dim))

    return Panel(Group(*lines), title=f"[{theme.info}]ACARS[/]",
                 border_style=theme.info, box=box.ROUNDED)


def create_overlay_panel(state: RadarState) -> Panel:
    """Overlay management panel"""
    theme = state.theme
    content = Text()

    content.append("  ╔══════════════════════════════════╗\n", style=theme.border)
    content.append("  ║         OVERLAY MANAGER          ║\n", style=f"bold {theme.primary_bright}")
    content.append("  ╚══════════════════════════════════╝\n\n", style=theme.border)

    overlays = state.overlay_manager.get_overlay_list()

    if overlays:
        content.append("  LOADED OVERLAYS\n", style=f"bold {theme.secondary_bright}")
        content.append("  " + "─" * 34 + "\n", style=theme.border_dim)

        for i, (key, name, enabled) in enumerate(overlays):
            is_cursor = i == state.overlay_cursor
            prefix = "▶ " if is_cursor else "  "
            marker = "●" if enabled else "○"

            style = f"bold {theme.selected}" if is_cursor else theme.text
            marker_style = theme.success if enabled else theme.text_dim

            content.append(f"  {prefix}", style=style)
            content.append(f"{marker} ", style=marker_style)
            content.append(f"{name[:25]}\n", style=style)
    else:
        content.append("  No overlays loaded\n\n", style=theme.text_dim)

    content.append("\n")
    content.append("  " + "─" * 34 + "\n", style=theme.border_dim)
    content.append("  [↑/↓] Navigate  [Enter] Toggle\n", style=theme.text_dim)
    content.append("  [D] Delete  [O/Esc] Close\n", style=theme.text_dim)
    content.append("\n  Add overlays:\n", style=theme.text_dim)
    content.append("  --overlay /path/to/file.geojson\n", style=theme.info)

    return Panel(content, title=f"[{theme.primary_bright}]OVERLAYS[/]",
                 border_style=theme.border, box=box.DOUBLE)


def create_settings_panel(state: RadarState) -> Panel:
    """Settings/theme panel"""
    theme = state.theme
    content = Text()

    content.append("  ╔══════════════════════════════════╗\n", style=theme.border)
    content.append("  ║         SETTINGS & THEMES        ║\n", style=f"bold {theme.primary_bright}")
    content.append("  ╚══════════════════════════════════╝\n\n", style=theme.border)

    themes_info = get_theme_info()
    content.append("  THEMES\n", style=f"bold {theme.secondary_bright}")
    content.append("  " + "─" * 34 + "\n", style=theme.border_dim)

    for i, (key, name, desc) in enumerate(themes_info):
        is_current = key == state.config.display.theme
        is_cursor = i == state.settings_cursor

        prefix = "▶ " if is_cursor else "  "
        marker = "●" if is_current else "○"

        style = f"bold {theme.selected}" if is_cursor else theme.text
        marker_style = theme.success if is_current else theme.text_dim

        content.append(f"  {prefix}", style=style)
        content.append(f"{marker} ", style=marker_style)
        content.append(f"{name[:14]:<14}", style=style)
        content.append(f" {desc[:16]}\n", style=theme.text_dim)

    content.append("\n  " + "─" * 34 + "\n", style=theme.border_dim)
    content.append("  [↑/↓] Navigate  [Enter] Apply\n", style=theme.text_dim)
    content.append("  [T/Esc] Close\n", style=theme.text_dim)

    return Panel(content, title=f"[{theme.primary_bright}]SETTINGS[/]",
                 border_style=theme.border, box=box.DOUBLE)


def create_help_panel(state: RadarState) -> Panel:
    """Help panel"""
    theme = state.theme
    content = Text()

    content.append("  ╔══════════════════════════════════════════╗\n", style=theme.border)
    content.append("  ║           SKYSPY RADAR HELP              ║\n", style=f"bold {theme.primary_bright}")
    content.append("  ╚══════════════════════════════════════════╝\n\n", style=theme.border)

    sections = [
        ("NAVIGATION", [("↑/↓ j/k", "Select target"), ("+/-", "Zoom range")]),
        ("DISPLAY", [("L", "Labels"), ("M", "Military only"), ("G", "Ground filter"),
                     ("A", "ACARS"), ("V", "VU meters"), ("S", "Spectrum")]),
        ("PANELS", [("T", "Themes"), ("O", "Overlays"), ("?", "Help"), ("Q", "Quit")]),
        ("SYMBOLS", [("✦", "Aircraft"), ("◉", "Selected"), ("◆", "Military"), ("!", "Emergency")]),
    ]

    for section, items in sections:
        content.append(f"  {section}\n", style=f"bold {theme.secondary_bright}")
        content.append("  " + "─" * 40 + "\n", style=theme.border_dim)
        for key, desc in items:
            content.append(f"   [{key:^7}] ", style=theme.primary_bright)
            content.append(f"{desc}\n", style=theme.text)
        content.append("\n")

    content.append("  Press any key to close\n", style=theme.text_dim)

    return Panel(content, title=f"[{theme.info}]HELP[/]",
                 border_style=theme.info, box=box.DOUBLE)


def create_status_bar(state: RadarState) -> Text:
    """Status bar"""
    theme = state.theme
    text = Text()

    if state.connected:
        ind = "◉" if state.blink else "○"
        text.append(f" {ind} ON ", style=f"bold {theme.success}")
    else:
        text.append(" ○ OFF ", style=f"bold {theme.error}")

    text.append("│", style=theme.border_dim)
    text.append(f" {len(state.targets):3d} ", style=theme.secondary_bright)
    text.append("│", style=theme.border_dim)
    text.append(f" {int(state.max_range)}nm ", style=theme.primary_bright)
    text.append("│", style=theme.border_dim)

    # Active filters
    filters = []
    if state.config.filters.military_only:
        filters.append("MIL")
    if state.config.filters.hide_ground:
        filters.append("AIR")

    if filters:
        text.append(f" {'/'.join(filters)} ", style=theme.warning)
        text.append("│", style=theme.border_dim)

    # Overlays
    enabled_overlays = len([o for o in state.overlay_manager.overlays.values() if o.enabled])
    if enabled_overlays:
        text.append(f" OVL:{enabled_overlays} ", style=theme.info)
        text.append("│", style=theme.border_dim)

    text.append(f" {theme.name[:12]} ", style=theme.text_dim)
    text.append("│", style=theme.border_dim)
    text.append(f" {datetime.now().strftime('%H:%M:%S')} ", style=theme.secondary_bright)

    if state.notification and state.notification_time > 0:
        text.append("│", style=theme.border_dim)
        text.append(f" {state.notification} ", style=f"bold {theme.info}")

    return text


def create_header(state: RadarState) -> Text:
    """Header bar"""
    theme = state.theme
    text = Text()

    text.append("╔" + "═" * 98 + "╗\n", style=theme.border)
    text.append("║ ", style=theme.border)
    text.append("░░ ", style=theme.text_dim)
    text.append("SKYSPY RADAR PRO", style=f"bold {theme.primary_bright} reverse")
    text.append(" ░░ ", style=theme.text_dim)
    text.append("═" * 18, style=theme.border)
    text.append(" ADS-B TACTICAL DISPLAY ", style=f"bold {theme.secondary_bright}")
    text.append("═" * 18, style=theme.border)

    spinners = ["◐", "◓", "◑", "◒"]
    spin = spinners[state.frame % 4]
    text.append(f" {spin} ", style=theme.info)
    text.append("LIVE", style=f"bold {theme.info}")
    text.append(f" {spin}  ", style=theme.info)
    text.append("║\n", style=theme.border)
    text.append("╠" + "═" * 98 + "╣", style=theme.border)

    return text


def create_display(state: RadarState) -> Group:
    """Create complete display"""
    theme = state.theme
    header = create_header(state)

    # Build sidebar based on view mode
    if state.view_mode == ViewMode.SETTINGS:
        sidebar = create_settings_panel(state)
    elif state.view_mode == ViewMode.HELP:
        sidebar = create_help_panel(state)
    elif state.view_mode == ViewMode.OVERLAYS:
        sidebar = create_overlay_panel(state)
    else:
        # Normal view - stack panels
        panels = [create_target_panel(state)]

        if state.config.display.show_stats_panel:
            panels.append(create_stats_panel(state))

        if state.config.display.show_target_list:
            panels.append(create_target_list(state))

        if state.config.display.show_frequencies:
            panels.append(create_freq_panel(state))

        sidebar = Group(*panels)

    # ACARS at bottom if enabled
    bottom = None
    if state.config.display.show_acars and state.view_mode == ViewMode.RADAR:
        bottom = create_acars_panel(state)

    # Main layout
    radar_panel = Panel(create_radar_scope(state), border_style=theme.border, box=box.SIMPLE)

    if bottom:
        main_content = Group(
            Columns([radar_panel, sidebar], expand=True),
            bottom
        )
    else:
        main_content = Columns([radar_panel, sidebar], expand=True)

    status = create_status_bar(state)
    status_panel = Panel(Align.center(status), box=box.HORIZONTALS, border_style=theme.border)

    footer = Text()
    footer.append("╚" + "═" * 98 + "╝", style=theme.border)

    return Group(header, main_content, status_panel, footer)


class InputHandler:
    """Keyboard input handler"""
    def __init__(self, state: RadarState):
        self.state = state

    def handle(self, key: str) -> bool:
        """Handle key, return True to quit"""
        state = self.state

        if key in ('q', 'Q', '\x03'):
            return True

        if state.view_mode == ViewMode.SETTINGS:
            return self._handle_settings(key)
        elif state.view_mode == ViewMode.HELP:
            state.view_mode = ViewMode.RADAR
            return False
        elif state.view_mode == ViewMode.OVERLAYS:
            return self._handle_overlays(key)
        else:
            return self._handle_radar(key)

    def _handle_radar(self, key: str) -> bool:
        state = self.state

        if key in ('up', 'k'):
            self._select_prev()
        elif key in ('down', 'j'):
            self._select_next()
        elif key in ('+', '='):
            self._zoom_out()
        elif key in ('-', '_'):
            self._zoom_in()
        elif key in ('l', 'L'):
            state.config.display.show_labels = not state.config.display.show_labels
            state.notify(f"Labels: {'ON' if state.config.display.show_labels else 'OFF'}")
        elif key in ('m', 'M'):
            state.config.filters.military_only = not state.config.filters.military_only
            state.notify(f"Military: {'ON' if state.config.filters.military_only else 'OFF'}")
        elif key in ('g', 'G'):
            state.config.filters.hide_ground = not state.config.filters.hide_ground
            state.notify(f"Ground: {'HIDE' if state.config.filters.hide_ground else 'SHOW'}")
        elif key in ('a', 'A'):
            state.config.display.show_acars = not state.config.display.show_acars
        elif key in ('v', 'V'):
            state.config.display.show_vu_meters = not state.config.display.show_vu_meters
        elif key in ('s', 'S'):
            state.config.display.show_spectrum = not state.config.display.show_spectrum
        elif key in ('t', 'T'):
            state.view_mode = ViewMode.SETTINGS
            state.settings_cursor = 0
        elif key in ('o', 'O'):
            state.view_mode = ViewMode.OVERLAYS
            state.overlay_cursor = 0
        elif key in ('?', 'h', 'H'):
            state.view_mode = ViewMode.HELP

        return False

    def _handle_settings(self, key: str) -> bool:
        state = self.state
        themes = list_themes()

        if key in ('t', 'T', '\x1b'):
            state.view_mode = ViewMode.RADAR
        elif key in ('up', 'k'):
            state.settings_cursor = (state.settings_cursor - 1) % len(themes)
        elif key in ('down', 'j'):
            state.settings_cursor = (state.settings_cursor + 1) % len(themes)
        elif key in ('\r', '\n', ' '):
            state.set_theme(themes[state.settings_cursor])

        return False

    def _handle_overlays(self, key: str) -> bool:
        state = self.state
        overlays = state.overlay_manager.get_overlay_list()

        if key in ('o', 'O', '\x1b'):
            state.view_mode = ViewMode.RADAR
        elif key in ('up', 'k') and overlays:
            state.overlay_cursor = (state.overlay_cursor - 1) % len(overlays)
        elif key in ('down', 'j') and overlays:
            state.overlay_cursor = (state.overlay_cursor + 1) % len(overlays)
        elif key in ('\r', '\n', ' ') and overlays:
            key_name = overlays[state.overlay_cursor][0]
            enabled = state.overlay_manager.toggle_overlay(key_name)
            state.notify(f"Overlay: {'ON' if enabled else 'OFF'}")
            state.save_overlays()
        elif key in ('d', 'D') and overlays:
            key_name = overlays[state.overlay_cursor][0]
            state.overlay_manager.remove_overlay(key_name)
            state.overlay_cursor = min(state.overlay_cursor, len(overlays) - 2)
            state.notify("Overlay removed")
            state.save_overlays()

        return False

    def _select_next(self):
        if not self.state.sorted_targets:
            return
        if self.state.selected_hex is None:
            self.state.selected_hex = self.state.sorted_targets[0]
        else:
            try:
                idx = self.state.sorted_targets.index(self.state.selected_hex)
                self.state.selected_hex = self.state.sorted_targets[(idx + 1) % len(self.state.sorted_targets)]
            except ValueError:
                self.state.selected_hex = self.state.sorted_targets[0]

    def _select_prev(self):
        if not self.state.sorted_targets:
            return
        if self.state.selected_hex is None:
            self.state.selected_hex = self.state.sorted_targets[-1]
        else:
            try:
                idx = self.state.sorted_targets.index(self.state.selected_hex)
                self.state.selected_hex = self.state.sorted_targets[(idx - 1) % len(self.state.sorted_targets)]
            except ValueError:
                self.state.selected_hex = self.state.sorted_targets[-1]

    def _zoom_in(self):
        if self.state.range_idx > 0:
            self.state.range_idx -= 1
            self.state.max_range = self.state.range_options[self.state.range_idx]
            self.state.notify(f"Range: {int(self.state.max_range)}nm")

    def _zoom_out(self):
        if self.state.range_idx < len(self.state.range_options) - 1:
            self.state.range_idx += 1
            self.state.max_range = self.state.range_options[self.state.range_idx]
            self.state.notify(f"Range: {int(self.state.max_range)}nm")


def update_target(state: RadarState, ac: dict):
    """Update target from aircraft data"""
    hex_code = ac.get("hex")
    if not hex_code:
        return

    lat, lon = ac.get("lat"), ac.get("lon")
    distance, bearing = ac.get("distance_nm"), ac.get("bearing")

    if lat and lon and (state.receiver_lat or state.receiver_lon):
        distance, bearing = haversine_bearing(state.receiver_lat, state.receiver_lon, lat, lon)

    state.targets[hex_code] = Target(
        hex=hex_code,
        callsign=ac.get("flight", "").strip(),
        lat=lat, lon=lon,
        alt=ac.get("alt_baro") or ac.get("alt"),
        gs=ac.get("gs"),
        track=ac.get("track"),
        vs=ac.get("baro_rate") or ac.get("vr"),
        distance=distance,
        bearing=bearing,
        rssi=ac.get("rssi"),
        squawk=ac.get("squawk"),
        ac_type=ac.get("t") or ac.get("type"),
        military=ac.get("military", False),
        last_seen=datetime.now(),
    )


async def websocket_handler(state: RadarState):
    """WebSocket connections"""
    host, port = state.config.connection.host, state.config.connection.port

    async def handle_aircraft():
        url = f"ws://{host}:{port}/ws/aircraft/?topics=aircraft"
        while True:
            try:
                async with websockets.connect(url) as ws:
                    state.connected = True
                    state.notify("Connected")
                    await ws.send(json.dumps({"action": "subscribe", "topics": ["aircraft"]}))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            msg_type = data.get("type", "")

                            if msg_type == "aircraft:snapshot":
                                ac_data = data.get("data", {})
                                aircraft_list = list(ac_data.get("aircraft", {}).values()) if isinstance(ac_data, dict) else ac_data if isinstance(ac_data, list) else []
                                for ac in aircraft_list:
                                    update_target(state, ac)
                            elif msg_type in ("aircraft:update", "aircraft:new"):
                                update_target(state, data.get("data", {}))
                                state.session_messages += 1
                            elif msg_type == "aircraft:remove":
                                state.targets.pop(data.get("data", {}).get("hex"), None)
                        except json.JSONDecodeError:
                            pass
            except Exception:
                state.connected = False
                await asyncio.sleep(state.config.connection.reconnect_delay)

    async def handle_acars():
        url = f"ws://{host}:{port}/ws/acars/?topics=messages"
        while True:
            try:
                async with websockets.connect(url) as ws:
                    await ws.send(json.dumps({"action": "subscribe", "topics": ["messages"]}))
                    async for message in ws:
                        try:
                            data = json.loads(message)
                            if data.get("type") in ("acars:message", "acars:snapshot"):
                                msg_data = data.get("data", {})
                                if isinstance(msg_data, list):
                                    state.acars_messages.extend(msg_data)
                                else:
                                    state.acars_messages.append(msg_data)
                        except json.JSONDecodeError:
                            pass
            except Exception:
                await asyncio.sleep(2)

    await asyncio.gather(handle_aircraft(), handle_acars())


async def animation_task(state: RadarState):
    """Animations and meters"""
    while True:
        state.sweep_angle = (state.sweep_angle + state.config.radar.sweep_speed) % 360
        state.blink = not state.blink
        state.frame += 1

        # Update VU meters
        activity = min(len(state.targets) / 30, 1.0)
        state.vu_left = state.vu_left * 0.8 + (activity + random.random() * 0.2) * 0.2
        state.vu_right = state.vu_right * 0.8 + (activity + random.random() * 0.2) * 0.2

        # Update spectrum
        for i in range(len(state.spectrum)):
            target = random.random() * activity * 0.7
            state.spectrum[i] = max(0, state.spectrum[i] * 0.7 + target * 0.3)

        # Update stats
        state.update_stats()

        # Notification timer
        if state.notification_time > 0:
            state.notification_time -= 0.15
            if state.notification_time <= 0:
                state.notification = None

        await asyncio.sleep(0.15)


async def keyboard_task(state: RadarState, handler: InputHandler):
    """Keyboard input"""
    import tty, termios, select

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)

    try:
        tty.setraw(fd)
        while True:
            if select.select([sys.stdin], [], [], 0.05)[0]:
                ch = sys.stdin.read(1)
                if ch == '\x1b':
                    if select.select([sys.stdin], [], [], 0.05)[0]:
                        ch2 = sys.stdin.read(1)
                        if ch2 == '[':
                            ch3 = sys.stdin.read(1)
                            ch = 'up' if ch3 == 'A' else 'down' if ch3 == 'B' else '\x1b'
                        else:
                            ch = '\x1b'
                    else:
                        ch = '\x1b'

                if handler.handle(ch):
                    return
            await asyncio.sleep(0.02)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


async def run_radar(config: Config):
    """Main loop"""
    state = RadarState(config)
    handler = InputHandler(state)

    ws_task = asyncio.create_task(websocket_handler(state))
    anim_task = asyncio.create_task(animation_task(state))
    key_task = asyncio.create_task(keyboard_task(state, handler))

    theme = state.theme
    console.print(f"[{theme.primary_bright}]")
    console.print("  ╔════════════════════════════════════════════╗")
    console.print("  ║     SKYSPY RADAR PRO - INITIALIZING...     ║")
    console.print("  ╚════════════════════════════════════════════╝")
    console.print("[/]")
    console.print(f"[{theme.text_dim}]  Theme: {theme.name}[/]")
    console.print(f"[{theme.text_dim}]  Overlays: {len(state.overlay_manager.overlays)}[/]")
    console.print(f"[{theme.text_dim}]  Connecting to {config.connection.host}:{config.connection.port}...[/]")
    await asyncio.sleep(1)

    try:
        with Live(create_display(state), console=console,
                  refresh_per_second=config.display.refresh_rate,
                  screen=True, transient=True) as live:
            while not key_task.done():
                live.update(create_display(state))
                await asyncio.sleep(0.1)
    except KeyboardInterrupt:
        pass
    finally:
        ws_task.cancel()
        anim_task.cancel()
        key_task.cancel()
        save_config(config)
        console.print(f"\n[{theme.secondary_bright}]  Settings saved. Clear skies![/]\n")


@click.command()
@click.option("--host", default=None, help="Server hostname")
@click.option("--port", default=None, type=int, help="Server port")
@click.option("--lat", default=None, type=float, help="Receiver latitude")
@click.option("--lon", default=None, type=float, help="Receiver longitude")
@click.option("--range", "max_range", default=None, type=int, help="Initial range (nm)")
@click.option("--theme", default=None, help="Color theme")
@click.option("--overlay", multiple=True, help="Load overlay file (GeoJSON/Shapefile)")
@click.option("--list-themes", is_flag=True, help="List themes")
def main(host, port, lat, lon, max_range, theme, overlay, list_themes):
    """
    SkySpy Radar Pro - Full-Featured Aircraft Display

    Interactive radar with overlays, VU meters, spectrum, and themes.
    Settings saved to ~/.config/skyspy/settings.json

    Examples:
      skyspy-radar --theme cyberpunk
      skyspy-radar --overlay airspace.geojson --overlay coastline.shp
      skyspy-radar --lat 40.7128 --lon -74.0060 --range 50
    """
    if list_themes:
        console.print("\n[bold]Available Themes:[/]\n")
        for key, name, desc in get_theme_info():
            console.print(f"  [cyan]{key:15}[/] {name:15} - {desc}")
        console.print()
        return

    config = load_config()

    if host:
        config.connection.host = host
    if port:
        config.connection.port = port
    if lat:
        config.connection.receiver_lat = lat
    if lon:
        config.connection.receiver_lon = lon
    if max_range:
        config.radar.default_range = max_range
    if theme:
        config.display.theme = theme

    # Add command-line overlays to config
    for ov_path in overlay:
        if os.path.exists(ov_path):
            config.overlays.overlays.append({"path": os.path.abspath(ov_path), "enabled": True})

    try:
        asyncio.run(run_radar(config))
    except KeyboardInterrupt:
        console.print("\n[bright_yellow]  73 de SkySpy Radar[/]\n")


if __name__ == "__main__":
    main()
