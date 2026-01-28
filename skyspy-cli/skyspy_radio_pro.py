#!/usr/bin/env python3
"""
SkySpy Radio PRO - Ultimate Old School CLI Aircraft Monitor
A fully immersive retro terminal interface for live aircraft tracking
"""

import asyncio
import json
import random
import sys
from datetime import datetime
from collections import deque
from typing import Optional
import math

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
from rich.columns import Columns
from rich import box

console = Console()

# Extended ASCII art frames for animation
RADIO_FRAMES = [
    r"""
[bright_green]╔══════════════════════════════════════════════════════════════════════════════╗
║ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ║
║ ▓  ███████╗██╗  ██╗██╗   ██╗███████╗██████╗ ██╗   ██╗  ██████╗  █████╗     ▓ ║
║ ▓  ██╔════╝██║ ██╔╝╚██╗ ██╔╝██╔════╝██╔══██╗╚██╗ ██╔╝  ██╔══██╗██╔══██╗    ▓ ║
║ ▓  ███████╗█████╔╝  ╚████╔╝ ███████╗██████╔╝ ╚████╔╝   ██████╔╝███████║    ▓ ║
║ ▓  ╚════██║██╔═██╗   ╚██╔╝  ╚════██║██╔═══╝   ╚██╔╝    ██╔══██╗██╔══██║    ▓ ║
║ ▓  ███████║██║  ██╗   ██║   ███████║██║        ██║     ██║  ██║██║  ██║    ▓ ║
║ ▓  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝        ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝    ▓ ║
║ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ║
╠══════════════════════════════════════════════════════════════════════════════╣[/]""",
]


class RadioState:
    """Enhanced state with animation data"""
    def __init__(self):
        self.aircraft: dict = {}
        self.acars_messages: deque = deque(maxlen=100)
        self.stats = {
            "messages_received": 0,
            "last_update": None,
            "connected": False,
            "uptime_start": datetime.now(),
            "peak_aircraft": 0,
        }
        self.blink_state = False
        self.frame = 0
        self.scan_pos = 0
        self.vu_left = 0
        self.vu_right = 0
        self.spectrum = [0] * 32
        self.selected_aircraft: Optional[str] = None
        self.view_mode = "aircraft"  # aircraft, acars, spectrum


def create_vu_meter(level: float, width: int = 20) -> Text:
    """Create animated VU meter"""
    bars = "█" * int(level * width)
    empty = "░" * (width - len(bars))

    text = Text()
    green_bars = int(width * 0.6)
    yellow_bars = int(width * 0.8)

    for i, char in enumerate(bars + empty):
        if char == "░":
            text.append(char, style="dim green")
        elif i < green_bars:
            text.append(char, style="bright_green")
        elif i < yellow_bars:
            text.append(char, style="bright_yellow")
        else:
            text.append(char, style="bright_red")

    return text


def create_spectrum_display(state: RadioState) -> Text:
    """Create frequency spectrum analyzer display"""
    lines = []
    height = 6
    width = 32

    # Update spectrum with some randomness based on activity
    activity = min(len(state.aircraft) / 50, 1.0)
    for i in range(width):
        target = random.random() * activity * 0.8
        state.spectrum[i] = state.spectrum[i] * 0.7 + target * 0.3

    # Build spectrum display
    for row in range(height, 0, -1):
        line = Text()
        threshold = row / height
        for col in range(width):
            if state.spectrum[col] >= threshold:
                if row <= 2:
                    line.append("█", style="bright_green")
                elif row <= 4:
                    line.append("█", style="bright_yellow")
                else:
                    line.append("█", style="bright_red")
            else:
                line.append("░", style="dim green")
        lines.append(line)

    # Frequency labels
    freq_line = Text()
    freq_line.append("118", style="dim")
    freq_line.append(" " * 6)
    freq_line.append("128", style="dim")
    freq_line.append(" " * 6)
    freq_line.append("136", style="dim")
    freq_line.append(" " * 6)
    freq_line.append("1090", style="dim")
    lines.append(freq_line)

    return Group(*lines)


def create_scan_display(state: RadioState) -> Text:
    """Create scanning frequency display"""
    freqs = ["118.100", "121.500", "128.825", "132.450", "136.725", "136.900", "1090.00"]
    state.scan_pos = (state.scan_pos + 1) % (len(freqs) * 10)
    current_idx = state.scan_pos // 10

    text = Text()
    text.append("SCAN: ", style="dim green")

    for i, freq in enumerate(freqs):
        if i == current_idx:
            text.append(f"▶{freq}◀", style="bold bright_green blink")
        else:
            text.append(f" {freq} ", style="dim")
        if i < len(freqs) - 1:
            text.append("│", style="dim green")

    return text


def create_compass(heading: float) -> str:
    """Create a mini compass display"""
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    idx = int((heading + 22.5) / 45) % 8
    return directions[idx]


def create_aircraft_display(state: RadioState) -> Panel:
    """Create enhanced aircraft display with more details"""
    table = Table(
        box=box.SIMPLE_HEAD,
        border_style="green",
        header_style="bold bright_green reverse",
        row_styles=["", "dim"],
        padding=(0, 1),
        expand=True,
    )

    table.add_column("■", width=1)  # Status indicator
    table.add_column("ICAO", style="bright_cyan", width=7)
    table.add_column("CALLSIGN", style="bright_yellow", width=9)
    table.add_column("TYPE", width=5)
    table.add_column("ALT", justify="right", width=7)
    table.add_column("GS", justify="right", width=5)
    table.add_column("VS", justify="right", width=6)
    table.add_column("HDG", width=4)
    table.add_column("DST", justify="right", width=6)
    table.add_column("SIG", width=7)
    table.add_column("SQ", width=5)

    sorted_aircraft = sorted(
        state.aircraft.values(),
        key=lambda x: x.get("distance_nm") or 999
    )

    for ac in sorted_aircraft[:15]:
        hex_code = ac.get("hex", "------").upper()
        callsign = ac.get("flight", "").strip()[:8] or "--------"
        ac_type = ac.get("t", ac.get("type", ""))[:4] or "----"

        alt = ac.get("alt_baro") or ac.get("alt")
        if alt:
            alt_str = f"FL{alt // 100:03d}" if alt >= 18000 else f"{alt:,}'"
        else:
            alt_str = "----"

        gs = ac.get("gs")
        gs_str = f"{int(gs)}" if gs else "---"

        vs = ac.get("baro_rate") or ac.get("vr")
        if vs:
            vs_str = f"{'+' if vs > 0 else ''}{int(vs)}"
            vs_style = "bright_green" if vs > 100 else "bright_red" if vs < -100 else "dim"
        else:
            vs_str = "---"
            vs_style = "dim"

        track = ac.get("track")
        hdg_str = create_compass(track) if track else "---"

        dist = ac.get("distance_nm")
        dist_str = f"{dist:.1f}" if dist else "---"

        rssi = ac.get("rssi")
        if rssi is not None:
            bars = min(5, max(0, int((rssi + 30) / 6)))
            sig_str = "█" * bars + "░" * (5 - bars)
            if bars >= 4:
                sig_style = "bright_green"
            elif bars >= 2:
                sig_style = "bright_yellow"
            else:
                sig_style = "bright_red"
        else:
            sig_str = "░░░░░"
            sig_style = "dim"

        squawk = ac.get("squawk", "----")
        sq_style = "bright_red bold" if squawk in ("7500", "7600", "7700") else "green"

        # Status indicator
        if ac.get("military"):
            status = Text("◆", style="bright_magenta")
        elif ac.get("alert") or squawk in ("7500", "7600", "7700"):
            status = Text("!", style="bright_red blink")
        else:
            status = Text("●", style="bright_green" if state.blink_state else "green")

        table.add_row(
            status,
            hex_code,
            callsign,
            ac_type,
            alt_str,
            gs_str,
            Text(vs_str, style=vs_style),
            hdg_str,
            dist_str,
            Text(sig_str, style=sig_style),
            Text(squawk, style=sq_style),
        )

    return Panel(
        table,
        title="[bold bright_green]◄◄ LIVE TRAFFIC ►►[/]",
        subtitle=f"[dim]{len(state.aircraft)} aircraft tracked[/]",
        border_style="green",
        box=box.DOUBLE,
    )


def create_acars_display(state: RadioState) -> Panel:
    """Create ACARS message display"""
    lines = []

    for msg in list(state.acars_messages)[-12:]:
        ts = msg.get("timestamp", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            time_str = dt.strftime("%H:%M:%S")
        except:
            time_str = "--:--:--"

        line = Text()
        line.append(f"[{time_str}] ", style="dim green")
        line.append(f"{msg.get('source', 'ACARS')[:4]:4s} ", style="cyan")
        line.append(f"{(msg.get('callsign') or msg.get('flight', ''))[:7]:7s} ", style="bright_yellow")
        line.append(f"L:{msg.get('label', '--'):2s} ", style="bright_green")

        text = msg.get("text", "")[:50]
        if text:
            line.append(text, style="green")
        else:
            line.append("[no text]", style="dim")

        lines.append(line)

    if not lines:
        lines.append(Text("  ◇ Awaiting ACARS/VDL2 transmissions...", style="dim green"))
        lines.append(Text("  ◇ Monitoring 136.900 MHz ACARS", style="dim"))
        lines.append(Text("  ◇ Monitoring 136.725 MHz VDL Mode 2", style="dim"))

    return Panel(
        Group(*lines),
        title="[bold bright_cyan]◄ DATA LINK FEED ►[/]",
        border_style="cyan",
        box=box.ROUNDED,
    )


def create_status_panel(state: RadioState) -> Panel:
    """Create system status panel"""
    uptime = datetime.now() - state.stats["uptime_start"]
    h, rem = divmod(int(uptime.total_seconds()), 3600)
    m, s = divmod(rem, 60)

    status = Text()

    # Connection indicator with animation
    if state.stats["connected"]:
        indicator = "◉" if state.blink_state else "○"
        status.append(f"  {indicator} RECEIVING ", style="bold bright_green")
    else:
        status.append("  ○ SCANNING ", style="bold bright_yellow blink")

    status.append("\n")

    # Stats
    status.append(f"  TARGETS: ", style="dim")
    status.append(f"{len(state.aircraft):3d}\n", style="bright_green")

    peak = max(state.stats.get("peak_aircraft", 0), len(state.aircraft))
    state.stats["peak_aircraft"] = peak
    status.append(f"  PEAK:    ", style="dim")
    status.append(f"{peak:3d}\n", style="bright_yellow")

    status.append(f"  MSGS:    ", style="dim")
    status.append(f"{state.stats['messages_received']}\n", style="bright_cyan")

    status.append(f"  UPTIME:  ", style="dim")
    status.append(f"{h:02d}:{m:02d}:{s:02d}\n", style="green")

    # VU Meters
    activity = min(len(state.aircraft) / 30, 1.0)
    state.vu_left = state.vu_left * 0.8 + (activity + random.random() * 0.2) * 0.2
    state.vu_right = state.vu_right * 0.8 + (activity + random.random() * 0.2) * 0.2

    status.append("\n  VU L ", style="dim")
    status.append_text(create_vu_meter(state.vu_left, 10))
    status.append("\n  VU R ", style="dim")
    status.append_text(create_vu_meter(state.vu_right, 10))

    return Panel(
        status,
        title="[bold green]STATUS[/]",
        border_style="green",
        box=box.ROUNDED,
        width=28,
    )


def create_freq_panel(state: RadioState) -> Panel:
    """Create frequency/tuning panel"""
    content = Text()

    # Current frequencies being monitored
    freqs = [
        ("1090.000", "ADS-B", "bright_green"),
        ("136.900", "ACARS", "bright_cyan"),
        ("136.725", "VDL2", "bright_yellow"),
        ("121.500", "GUARD", "bright_red"),
    ]

    for freq, label, style in freqs:
        indicator = "●" if state.blink_state and random.random() > 0.7 else "○"
        content.append(f"  {indicator} ", style=style if indicator == "●" else "dim")
        content.append(f"{freq} MHz ", style=style)
        content.append(f"[{label}]\n", style="dim")

    # Spectrum mini-display
    content.append("\n  ")
    for i in range(20):
        level = state.spectrum[i] if i < len(state.spectrum) else 0
        if level > 0.6:
            content.append("█", style="bright_red")
        elif level > 0.3:
            content.append("▄", style="bright_yellow")
        else:
            content.append("▁", style="dim green")
    content.append("\n")

    return Panel(
        content,
        title="[bold green]FREQUENCIES[/]",
        border_style="green",
        box=box.ROUNDED,
        width=28,
    )


def create_full_display(state: RadioState) -> Group:
    """Create the complete retro radio display"""
    # Update animation frame
    state.frame = (state.frame + 1) % 100

    # Mini header
    header = Text()
    header.append("╔════════════════════════════════════════════════════════════════════════════════╗\n", style="bright_green")
    header.append("║ ", style="bright_green")
    header.append("░░░", style="dim green")
    header.append(" SKYSPY RADIO ", style="bold bright_green reverse")
    header.append("░░░", style="dim green")
    header.append(" ── ADS-B & ACARS MONITOR ── ", style="bright_green")

    # Animated indicator
    indicators = ["◐", "◓", "◑", "◒"]
    header.append(indicators[state.frame % 4], style="bright_cyan")
    header.append(" LIVE ", style="bold bright_cyan")
    header.append(indicators[(state.frame + 2) % 4], style="bright_cyan")

    header.append(" ░░░ ", style="dim green")
    header.append(datetime.now().strftime("%H:%M:%S"), style="bright_yellow")
    header.append(" ║\n", style="bright_green")
    header.append("╠════════════════════════════════════════════════════════════════════════════════╣", style="bright_green")

    # Create layout
    layout = Layout()
    layout.split_row(
        Layout(name="main", ratio=3),
        Layout(name="sidebar", ratio=1),
    )

    # Main content - aircraft and ACARS stacked
    main_content = Group(
        create_aircraft_display(state),
        create_acars_display(state),
    )

    # Sidebar - status and frequencies
    sidebar_content = Group(
        create_status_panel(state),
        create_freq_panel(state),
    )

    # Footer with scan display
    footer = Text()
    footer.append("╠════════════════════════════════════════════════════════════════════════════════╣\n", style="bright_green")
    footer.append("║ ", style="bright_green")
    footer.append_text(create_scan_display(state))
    footer.append(" ║\n", style="bright_green")
    footer.append("╚════════════════════════════════════════════════════════════════════════════════╝", style="bright_green")

    return Group(
        header,
        Columns([main_content, sidebar_content], expand=True, padding=(0, 1)),
        footer,
    )


async def websocket_handler(state: RadioState, host: str, port: int):
    """Handle WebSocket connections"""
    aircraft_url = f"ws://{host}:{port}/ws/aircraft/?topics=aircraft"
    acars_url = f"ws://{host}:{port}/ws/acars/?topics=messages"

    async def handle_aircraft():
        while True:
            try:
                async with websockets.connect(aircraft_url) as ws:
                    state.stats["connected"] = True
                    await ws.send(json.dumps({"action": "subscribe", "topics": ["aircraft"]}))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            msg_type = data.get("type", "")

                            if msg_type == "aircraft:snapshot":
                                ac_data = data.get("data", {})
                                if isinstance(ac_data, dict):
                                    state.aircraft = ac_data.get("aircraft", {})
                                elif isinstance(ac_data, list):
                                    state.aircraft = {ac["hex"]: ac for ac in ac_data if ac.get("hex")}
                            elif msg_type in ("aircraft:update", "aircraft:new"):
                                ac = data.get("data", {})
                                if ac.get("hex"):
                                    state.aircraft[ac["hex"]] = ac
                                state.stats["messages_received"] += 1
                            elif msg_type == "aircraft:remove":
                                hex_code = data.get("data", {}).get("hex")
                                state.aircraft.pop(hex_code, None)

                        except json.JSONDecodeError:
                            pass
            except Exception:
                state.stats["connected"] = False
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
                                state.stats["messages_received"] += 1
                        except json.JSONDecodeError:
                            pass
            except Exception:
                await asyncio.sleep(2)

    await asyncio.gather(handle_aircraft(), handle_acars())


async def animation_task(state: RadioState):
    """Handle animations"""
    while True:
        state.blink_state = not state.blink_state
        # Update spectrum randomly
        for i in range(len(state.spectrum)):
            state.spectrum[i] = max(0, state.spectrum[i] - 0.05 + random.random() * 0.1)
        await asyncio.sleep(0.3)


async def run_radio(host: str, port: int):
    """Main radio loop"""
    state = RadioState()

    ws_task = asyncio.create_task(websocket_handler(state, host, port))
    anim_task = asyncio.create_task(animation_task(state))

    # Startup sequence
    console.print("[bold bright_green]")
    console.print("  ████████████████████████████████████████████")
    console.print("  █                                          █")
    console.print("  █   SKYSPY RADIO PRO - INITIALIZING...     █")
    console.print("  █                                          █")
    console.print("  ████████████████████████████████████████████")
    console.print("[/]")
    console.print(f"\n[dim green]  Connecting to {host}:{port}...[/]")
    await asyncio.sleep(1.5)

    try:
        with Live(
            create_full_display(state),
            console=console,
            refresh_per_second=4,
            screen=True,
            transient=True,
        ) as live:
            while True:
                live.update(create_full_display(state))
                await asyncio.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        ws_task.cancel()
        anim_task.cancel()


@click.command()
@click.option("--host", default="localhost", help="Server hostname")
@click.option("--port", default=80, type=int, help="Server port")
def main(host: str, port: int):
    """
    SkySpy Radio PRO - Ultimate Aircraft Monitor

    A fully immersive retro terminal interface for live
    ADS-B and ACARS tracking with VU meters and spectrum display.
    """
    try:
        asyncio.run(run_radio(host, port))
    except KeyboardInterrupt:
        console.print("\n[bright_yellow]  73 de SkySpy Radio - Clear skies![/]\n")


if __name__ == "__main__":
    main()
