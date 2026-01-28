#!/usr/bin/env python3
"""
SkySpy Radar - Old School Radar Scope Display
Interactive aircraft tracking with selectable targets
"""

import asyncio
import json
import math
import sys
from datetime import datetime
from collections import deque
from typing import Optional, Tuple, List
from dataclasses import dataclass

import click
import websockets
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.layout import Layout
from rich.align import Align
from rich.style import Style
from rich import box

console = Console()

# Radar dimensions (characters)
RADAR_WIDTH = 61
RADAR_HEIGHT = 31
RADAR_CENTER_X = RADAR_WIDTH // 2
RADAR_CENTER_Y = RADAR_HEIGHT // 2
MAX_RANGE_NM = 100  # Default max range in nautical miles


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


class RadarState:
    """Radar scope state"""
    def __init__(self):
        self.targets: dict[str, Target] = {}
        self.selected_idx: int = 0
        self.selected_hex: Optional[str] = None
        self.sorted_targets: List[str] = []
        self.sweep_angle: float = 0
        self.max_range: float = MAX_RANGE_NM
        self.range_idx: int = 2  # Index into range options
        self.range_options = [25, 50, 100, 200, 400]
        self.receiver_lat: float = 0
        self.receiver_lon: float = 0
        self.acars_messages: deque = deque(maxlen=50)
        self.connected: bool = False
        self.msg_count: int = 0
        self.blink: bool = False
        self.show_labels: bool = True
        self.show_trails: bool = False
        self.filter_military: bool = False


def haversine_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> Tuple[float, float]:
    """Calculate distance (nm) and bearing between two points"""
    R = 3440.065  # Earth radius in nautical miles

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    # Haversine formula for distance
    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance = R * c

    # Bearing
    y = math.sin(delta_lon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    bearing = math.degrees(math.atan2(y, x))
    bearing = (bearing + 360) % 360

    return distance, bearing


def target_to_radar_pos(distance: float, bearing: float, max_range: float) -> Tuple[int, int]:
    """Convert distance/bearing to radar screen coordinates"""
    if distance > max_range:
        return -1, -1

    # Normalize distance to radar radius
    radius = (distance / max_range) * (min(RADAR_WIDTH, RADAR_HEIGHT * 2) // 2 - 2)

    # Convert bearing to radians (0 = North = up)
    angle_rad = math.radians(bearing - 90)  # Adjust so 0° is up

    # Calculate position (account for character aspect ratio ~2:1)
    x = int(RADAR_CENTER_X + radius * math.cos(angle_rad) * 2)
    y = int(RADAR_CENTER_Y + radius * math.sin(angle_rad))

    return x, y


def create_radar_scope(state: RadarState) -> Text:
    """Create the radar scope display"""
    # Initialize radar buffer
    radar = [[' ' for _ in range(RADAR_WIDTH)] for _ in range(RADAR_HEIGHT)]
    colors = [[None for _ in range(RADAR_WIDTH)] for _ in range(RADAR_HEIGHT)]

    center_x = RADAR_CENTER_X
    center_y = RADAR_CENTER_Y
    max_radius = min(RADAR_WIDTH // 2, RADAR_HEIGHT) - 1

    # Draw range rings
    for ring in range(1, 5):
        ring_radius = (ring / 4) * max_radius
        for angle in range(0, 360, 3):
            angle_rad = math.radians(angle)
            x = int(center_x + ring_radius * math.cos(angle_rad) * 2)
            y = int(center_y + ring_radius * math.sin(angle_rad))
            if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT:
                if radar[y][x] == ' ':
                    radar[y][x] = '·'
                    colors[y][x] = "dim green"

    # Draw compass lines (N, E, S, W)
    for i in range(1, max_radius):
        # North
        if center_y - i >= 0:
            radar[center_y - i][center_x] = '│'
            colors[center_y - i][center_x] = "dim green"
        # South
        if center_y + i < RADAR_HEIGHT:
            radar[center_y + i][center_x] = '│'
            colors[center_y + i][center_x] = "dim green"
        # East
        if center_x + i * 2 < RADAR_WIDTH:
            radar[center_y][center_x + i * 2] = '─'
            colors[center_y][center_x + i * 2] = "dim green"
        # West
        if center_x - i * 2 >= 0:
            radar[center_y][center_x - i * 2] = '─'
            colors[center_y][center_x - i * 2] = "dim green"

    # Draw center point
    radar[center_y][center_x] = '╋'
    colors[center_y][center_x] = "bright_green"

    # Draw compass labels
    if center_y - max_radius >= 0:
        radar[center_y - max_radius][center_x] = 'N'
        colors[center_y - max_radius][center_x] = "bright_cyan"
    if center_y + max_radius < RADAR_HEIGHT:
        radar[center_y + max_radius][center_x] = 'S'
        colors[center_y + max_radius][center_x] = "bright_cyan"
    if center_x + max_radius * 2 < RADAR_WIDTH:
        radar[center_y][center_x + max_radius * 2] = 'E'
        colors[center_y][center_x + max_radius * 2] = "bright_cyan"
    if center_x - max_radius * 2 >= 0:
        radar[center_y][center_x - max_radius * 2] = 'W'
        colors[center_y][center_x - max_radius * 2] = "bright_cyan"

    # Draw sweep line
    sweep_rad = math.radians(state.sweep_angle - 90)
    for i in range(1, max_radius + 1):
        x = int(center_x + i * math.cos(sweep_rad) * 2)
        y = int(center_y + i * math.sin(sweep_rad))
        if 0 <= x < RADAR_WIDTH and 0 <= y < RADAR_HEIGHT:
            # Fade effect behind sweep
            intensity = 1.0 - (i / max_radius) * 0.5
            if intensity > 0.7:
                radar[y][x] = '░'
                colors[y][x] = "bright_green"
            elif intensity > 0.4:
                radar[y][x] = '░'
                colors[y][x] = "green"

    # Plot aircraft targets
    sorted_hexes = []
    for hex_code, target in state.targets.items():
        if target.distance is None or target.bearing is None:
            continue
        if state.filter_military and not target.military:
            continue

        x, y = target_to_radar_pos(target.distance, target.bearing, state.max_range)
        if x < 0 or y < 0 or x >= RADAR_WIDTH or y >= RADAR_HEIGHT:
            continue

        sorted_hexes.append((target.distance, hex_code, x, y))

    # Sort by distance for selection order
    sorted_hexes.sort(key=lambda t: t[0])
    state.sorted_targets = [h[1] for h in sorted_hexes]

    # Draw targets
    for i, (dist, hex_code, x, y) in enumerate(sorted_hexes):
        target = state.targets[hex_code]
        is_selected = hex_code == state.selected_hex

        # Determine target symbol and color
        if target.squawk in ("7500", "7600", "7700"):
            symbol = '!' if state.blink else '✖'
            color = "bright_red bold"
        elif target.military:
            symbol = '◆'
            color = "bright_magenta"
        elif is_selected:
            symbol = '◉'
            color = "bright_yellow bold"
        else:
            symbol = '✦'
            color = "bright_green"

        radar[y][x] = symbol
        colors[y][x] = color

        # Draw callsign label if enabled and selected or close
        if state.show_labels and (is_selected or dist < state.max_range * 0.3):
            label = target.callsign[:6] if target.callsign else hex_code[:6]
            label_x = x + 1
            if label_x + len(label) < RADAR_WIDTH and y > 0:
                for j, ch in enumerate(label[:6]):
                    if label_x + j < RADAR_WIDTH:
                        radar[y][label_x + j] = ch
                        colors[y][label_x + j] = "bright_cyan" if is_selected else "dim cyan"

        # Draw heading indicator for selected target
        if is_selected and target.track is not None:
            hdg_rad = math.radians(target.track - 90)
            hx = int(x + 2 * math.cos(hdg_rad) * 2)
            hy = int(y + 2 * math.sin(hdg_rad))
            if 0 <= hx < RADAR_WIDTH and 0 <= hy < RADAR_HEIGHT:
                radar[hy][hx] = '→'
                colors[hy][hx] = "bright_yellow"

    # Build text output
    output = Text()

    # Top border with range info
    range_str = f" RANGE: {int(state.max_range)}nm "
    border_top = "╔" + "═" * ((RADAR_WIDTH - len(range_str)) // 2 - 1)
    border_top += range_str
    border_top += "═" * (RADAR_WIDTH - len(border_top) - 1) + "╗"
    output.append(border_top + "\n", style="green")

    # Radar content
    for y in range(RADAR_HEIGHT):
        output.append("║", style="green")
        for x in range(RADAR_WIDTH):
            char = radar[y][x]
            color = colors[y][x] or "dim green"
            output.append(char, style=color)
        output.append("║\n", style="green")

    # Bottom border
    output.append("╚" + "═" * RADAR_WIDTH + "╝", style="green")

    return output


def create_target_info(state: RadarState) -> Panel:
    """Create selected target information panel"""
    if not state.selected_hex or state.selected_hex not in state.targets:
        content = Text()
        content.append("  No target selected\n\n", style="dim")
        content.append("  [↑/↓] Select target\n", style="dim green")
        content.append("  [+/-] Adjust range\n", style="dim green")
        content.append("  [L]   Toggle labels\n", style="dim green")
        content.append("  [M]   Military filter\n", style="dim green")
        return Panel(content, title="[bold green]TARGET INFO[/]", border_style="green", box=box.ROUNDED)

    target = state.targets[state.selected_hex]

    content = Text()

    # Header with callsign
    cs = target.callsign or "-------"
    content.append(f"  {cs}\n", style="bold bright_yellow")
    content.append(f"  {target.hex.upper()}", style="bright_cyan")
    if target.military:
        content.append(" [MIL]", style="bright_magenta bold")
    content.append("\n\n", style="")

    # Type
    content.append("  TYPE   ", style="dim")
    content.append(f"{target.ac_type or '----'}\n", style="bright_green")

    # Altitude
    content.append("  ALT    ", style="dim")
    if target.alt:
        if target.alt >= 18000:
            content.append(f"FL{target.alt // 100:03d}\n", style="bright_green")
        else:
            content.append(f"{target.alt:,}'\n", style="bright_green")
    else:
        content.append("----\n", style="dim")

    # Ground speed
    content.append("  GS     ", style="dim")
    content.append(f"{int(target.gs) if target.gs else '---'} kt\n", style="bright_green")

    # Vertical speed
    content.append("  VS     ", style="dim")
    if target.vs:
        vs_style = "bright_green" if target.vs > 0 else "bright_red"
        content.append(f"{'+' if target.vs > 0 else ''}{int(target.vs)} fpm\n", style=vs_style)
    else:
        content.append("--- fpm\n", style="dim")

    # Heading
    content.append("  HDG    ", style="dim")
    content.append(f"{int(target.track):03d}°\n" if target.track else "---°\n", style="bright_green")

    # Distance
    content.append("  DIST   ", style="dim")
    content.append(f"{target.distance:.1f} nm\n" if target.distance else "--- nm\n", style="bright_cyan")

    # Bearing
    content.append("  BRG    ", style="dim")
    content.append(f"{int(target.bearing):03d}°\n" if target.bearing else "---°\n", style="bright_cyan")

    # Squawk
    content.append("  SQUAWK ", style="dim")
    sq = target.squawk or "----"
    sq_style = "bright_red bold" if sq in ("7500", "7600", "7700") else "bright_green"
    content.append(f"{sq}\n", style=sq_style)

    # Signal
    content.append("  RSSI   ", style="dim")
    if target.rssi is not None:
        bars = min(5, max(0, int((target.rssi + 30) / 6)))
        content.append("█" * bars + "░" * (5 - bars) + "\n", style="bright_green" if bars > 2 else "bright_yellow")
    else:
        content.append("░░░░░\n", style="dim")

    return Panel(content, title="[bold bright_green]◄ TARGET ►[/]", border_style="green", box=box.ROUNDED)


def create_target_list(state: RadarState) -> Panel:
    """Create scrollable target list"""
    table = Table(box=None, padding=(0, 1), expand=True, show_header=True, header_style="bold green")
    table.add_column("", width=1)
    table.add_column("CALL", width=8)
    table.add_column("ALT", width=6, justify="right")
    table.add_column("DIST", width=5, justify="right")

    # Get visible targets
    visible = []
    for hex_code in state.sorted_targets[:12]:
        if hex_code in state.targets:
            visible.append((hex_code, state.targets[hex_code]))

    for hex_code, target in visible:
        is_selected = hex_code == state.selected_hex
        marker = "▶" if is_selected else " "
        marker_style = "bright_yellow" if is_selected else ""

        cs = (target.callsign or target.hex)[:7]
        cs_style = "bright_yellow bold" if is_selected else "bright_cyan"

        alt = ""
        if target.alt:
            alt = f"FL{target.alt // 100}" if target.alt >= 18000 else f"{target.alt // 100}'"

        dist = f"{target.distance:.1f}" if target.distance else "---"

        table.add_row(
            Text(marker, style=marker_style),
            Text(cs, style=cs_style),
            alt,
            dist
        )

    return Panel(table, title=f"[bold green]TARGETS ({len(state.targets)})[/]", border_style="green", box=box.ROUNDED)


def create_acars_mini(state: RadarState) -> Panel:
    """Create mini ACARS feed"""
    lines = []
    for msg in list(state.acars_messages)[-4:]:
        line = Text()
        cs = (msg.get("callsign") or msg.get("flight", ""))[:6]
        label = msg.get("label", "--")
        line.append(f"{cs:<6} ", style="bright_yellow")
        line.append(f"L:{label} ", style="cyan")
        line.append((msg.get("text", "")[:20] or "-"), style="dim green")
        lines.append(line)

    if not lines:
        lines.append(Text("  Waiting for ACARS...", style="dim"))

    return Panel(Group(*lines), title="[bold cyan]ACARS[/]", border_style="cyan", box=box.ROUNDED)


def create_status_bar(state: RadarState) -> Text:
    """Create status bar"""
    text = Text()

    # Connection
    if state.connected:
        ind = "◉" if state.blink else "○"
        text.append(f" {ind} ONLINE ", style="bold bright_green")
    else:
        text.append(" ○ OFFLINE ", style="bold bright_red")

    text.append("│", style="dim")

    # Stats
    text.append(f" TGT:{len(state.targets):3d} ", style="bright_cyan")
    text.append("│", style="dim")
    text.append(f" RNG:{int(state.max_range):3d}nm ", style="bright_green")
    text.append("│", style="dim")

    # Filters
    if state.filter_military:
        text.append(" [MIL] ", style="bright_magenta")
    if state.show_labels:
        text.append(" [LBL] ", style="dim green")

    text.append("│", style="dim")

    # Time
    text.append(f" {datetime.now().strftime('%H:%M:%S')} ", style="bright_yellow")

    # Help
    text.append("│", style="dim")
    text.append(" ↑↓:sel +/-:rng L:lbl M:mil Q:quit ", style="dim")

    return text


def create_full_display(state: RadarState) -> Group:
    """Create the complete radar display"""
    # Header
    header = Text()
    header.append("╔══════════════════════════════════════════════════════════════════════════════════════════════╗\n", style="bright_green")
    header.append("║", style="bright_green")
    header.append(" ░░░ ", style="dim green")
    header.append("SKYSPY RADAR", style="bold bright_green reverse")
    header.append(" ░░░ ", style="dim green")
    header.append("═══════════════════════ ", style="bright_green")
    header.append("ADS-B TACTICAL DISPLAY", style="bold bright_cyan")
    header.append(" ═══════════════════════ ", style="bright_green")
    spin = ["◐", "◓", "◑", "◒"][int(state.sweep_angle / 90) % 4]
    header.append(f"{spin} LIVE {spin}", style="bold bright_yellow")
    header.append(" ║\n", style="bright_green")
    header.append("╠══════════════════════════════════════════════════════════════════════════════════════════════╣", style="bright_green")

    # Main content - radar scope on left, info on right
    radar = create_radar_scope(state)
    target_info = create_target_info(state)
    target_list = create_target_list(state)
    acars = create_acars_mini(state)

    # Right side panels
    right_side = Group(
        target_info,
        target_list,
        acars,
    )

    # Status bar
    status = create_status_bar(state)
    status_panel = Panel(Align.center(status), box=box.HORIZONTALS, border_style="green")

    # Footer
    footer = Text()
    footer.append("╚══════════════════════════════════════════════════════════════════════════════════════════════╝", style="bright_green")

    from rich.columns import Columns
    main_area = Columns([
        Panel(radar, border_style="green", box=box.SIMPLE),
        right_side
    ], expand=True)

    return Group(header, main_area, status_panel, footer)


class KeyboardHandler:
    """Handle keyboard input"""
    def __init__(self, state: RadarState):
        self.state = state

    def handle_key(self, key: str):
        if key in ('up', 'k'):
            self.select_prev()
        elif key in ('down', 'j'):
            self.select_next()
        elif key in ('+', '='):
            self.zoom_out()
        elif key in ('-', '_'):
            self.zoom_in()
        elif key in ('l', 'L'):
            self.state.show_labels = not self.state.show_labels
        elif key in ('m', 'M'):
            self.state.filter_military = not self.state.filter_military

    def select_next(self):
        if not self.state.sorted_targets:
            return
        if self.state.selected_hex is None:
            self.state.selected_hex = self.state.sorted_targets[0]
        else:
            try:
                idx = self.state.sorted_targets.index(self.state.selected_hex)
                idx = (idx + 1) % len(self.state.sorted_targets)
                self.state.selected_hex = self.state.sorted_targets[idx]
            except ValueError:
                self.state.selected_hex = self.state.sorted_targets[0]

    def select_prev(self):
        if not self.state.sorted_targets:
            return
        if self.state.selected_hex is None:
            self.state.selected_hex = self.state.sorted_targets[-1]
        else:
            try:
                idx = self.state.sorted_targets.index(self.state.selected_hex)
                idx = (idx - 1) % len(self.state.sorted_targets)
                self.state.selected_hex = self.state.sorted_targets[idx]
            except ValueError:
                self.state.selected_hex = self.state.sorted_targets[-1]

    def zoom_in(self):
        if self.state.range_idx > 0:
            self.state.range_idx -= 1
            self.state.max_range = self.state.range_options[self.state.range_idx]

    def zoom_out(self):
        if self.state.range_idx < len(self.state.range_options) - 1:
            self.state.range_idx += 1
            self.state.max_range = self.state.range_options[self.state.range_idx]


async def websocket_handler(state: RadarState, host: str, port: int):
    """Handle WebSocket connections"""
    aircraft_url = f"ws://{host}:{port}/ws/aircraft/?topics=aircraft"
    acars_url = f"ws://{host}:{port}/ws/acars/?topics=messages"

    async def handle_aircraft():
        while True:
            try:
                async with websockets.connect(aircraft_url) as ws:
                    state.connected = True
                    await ws.send(json.dumps({"action": "subscribe", "topics": ["aircraft"]}))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            msg_type = data.get("type", "")

                            if msg_type == "aircraft:snapshot":
                                ac_data = data.get("data", {})
                                aircraft_list = []
                                if isinstance(ac_data, dict):
                                    aircraft_list = list(ac_data.get("aircraft", {}).values())
                                    # Try to get receiver location
                                    if "receiver" in ac_data:
                                        state.receiver_lat = ac_data["receiver"].get("lat", 0)
                                        state.receiver_lon = ac_data["receiver"].get("lon", 0)
                                elif isinstance(ac_data, list):
                                    aircraft_list = ac_data

                                for ac in aircraft_list:
                                    update_target(state, ac)

                            elif msg_type in ("aircraft:update", "aircraft:new"):
                                ac = data.get("data", {})
                                update_target(state, ac)
                                state.msg_count += 1

                            elif msg_type == "aircraft:remove":
                                hex_code = data.get("data", {}).get("hex")
                                if hex_code:
                                    state.targets.pop(hex_code, None)

                        except json.JSONDecodeError:
                            pass
            except Exception:
                state.connected = False
                await asyncio.sleep(2)

    async def handle_acars():
        while True:
            try:
                async with websockets.connect(acars_url) as ws:
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


def update_target(state: RadarState, ac: dict):
    """Update a target from aircraft data"""
    hex_code = ac.get("hex")
    if not hex_code:
        return

    lat = ac.get("lat")
    lon = ac.get("lon")

    # Calculate distance and bearing if we have position
    distance = ac.get("distance_nm")
    bearing = ac.get("bearing")

    if lat and lon and (state.receiver_lat or state.receiver_lon):
        distance, bearing = haversine_bearing(state.receiver_lat, state.receiver_lon, lat, lon)

    target = Target(
        hex=hex_code,
        callsign=ac.get("flight", "").strip(),
        lat=lat,
        lon=lon,
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

    state.targets[hex_code] = target


async def animation_task(state: RadarState):
    """Handle radar sweep animation"""
    while True:
        state.sweep_angle = (state.sweep_angle + 6) % 360
        state.blink = not state.blink
        await asyncio.sleep(0.1)


async def keyboard_task(state: RadarState, kbd: KeyboardHandler):
    """Handle keyboard input (non-blocking)"""
    import sys
    import tty
    import termios
    import select

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)

    try:
        tty.setraw(fd)
        while True:
            if select.select([sys.stdin], [], [], 0.1)[0]:
                ch = sys.stdin.read(1)
                if ch == '\x1b':  # Escape sequence
                    if select.select([sys.stdin], [], [], 0.1)[0]:
                        ch2 = sys.stdin.read(1)
                        if ch2 == '[':
                            ch3 = sys.stdin.read(1)
                            if ch3 == 'A':
                                kbd.handle_key('up')
                            elif ch3 == 'B':
                                kbd.handle_key('down')
                elif ch in ('q', 'Q', '\x03'):  # q or Ctrl+C
                    return
                elif ch in ('+', '=', '-', '_', 'l', 'L', 'm', 'M', 'j', 'k'):
                    kbd.handle_key(ch)
            await asyncio.sleep(0.05)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


async def run_radar(host: str, port: int, lat: float, lon: float):
    """Main radar loop"""
    state = RadarState()
    state.receiver_lat = lat
    state.receiver_lon = lon
    kbd = KeyboardHandler(state)

    ws_task = asyncio.create_task(websocket_handler(state, host, port))
    anim_task = asyncio.create_task(animation_task(state))
    key_task = asyncio.create_task(keyboard_task(state, kbd))

    # Startup
    console.print("[bold bright_green]")
    console.print("  ╔════════════════════════════════════════╗")
    console.print("  ║     SKYSPY RADAR - INITIALIZING...     ║")
    console.print("  ╚════════════════════════════════════════╝")
    console.print("[/]")
    console.print(f"[dim green]  Connecting to {host}:{port}...[/]")
    if lat and lon:
        console.print(f"[dim green]  Receiver: {lat:.4f}, {lon:.4f}[/]")
    await asyncio.sleep(1)

    try:
        with Live(
            create_full_display(state),
            console=console,
            refresh_per_second=10,
            screen=True,
            transient=True,
        ) as live:
            while not key_task.done():
                live.update(create_full_display(state))
                await asyncio.sleep(0.1)
    except KeyboardInterrupt:
        pass
    finally:
        ws_task.cancel()
        anim_task.cancel()
        key_task.cancel()
        console.print("\n[bright_yellow]  Radar offline. Clear skies![/]\n")


@click.command()
@click.option("--host", default="localhost", help="Server hostname")
@click.option("--port", default=80, type=int, help="Server port")
@click.option("--lat", default=0.0, type=float, help="Receiver latitude")
@click.option("--lon", default=0.0, type=float, help="Receiver longitude")
@click.option("--range", "max_range", default=100, type=int, help="Initial range in nm")
def main(host: str, port: int, lat: float, lon: float, max_range: int):
    """
    SkySpy Radar - Tactical Aircraft Display

    Interactive radar scope with selectable targets.

    Controls:
      ↑/↓ or j/k  - Select target
      +/-         - Zoom in/out
      L           - Toggle labels
      M           - Military filter
      Q           - Quit
    """
    try:
        asyncio.run(run_radar(host, port, lat, lon))
    except KeyboardInterrupt:
        console.print("\n[bright_yellow]  73 de SkySpy Radar[/]\n")


if __name__ == "__main__":
    main()
