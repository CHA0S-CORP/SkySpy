#!/usr/bin/env python3
"""
SkySpy Radio - Old School CLI Aircraft Monitor
A retro terminal interface for live aircraft tracking
"""

import asyncio
import json
import signal
import sys
from datetime import datetime
from collections import deque
from typing import Optional

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

# Retro color scheme
AMBER = Style(color="bright_yellow")
GREEN = Style(color="bright_green")
RED = Style(color="bright_red")
CYAN = Style(color="bright_cyan")
DIM_GREEN = Style(color="green", dim=True)
BLINK_RED = Style(color="bright_red", bold=True)

console = Console()

ASCII_HEADER = r"""
[bright_green]
   _____ _            _____              _____           _ _
  / ____| |          / ____|            |  __ \         | (_)
 | (___ | | ___   _ | (___  _ __  _   _ | |__) |__ _  __| |_  ___
  \___ \| |/ / | | | \___ \| '_ \| | | ||  _  // _` |/ _` | |/ _ \
  ____) |   <| |_| | ____) | |_) | |_| || | \ \ (_| | (_| | | (_) |
 |_____/|_|\_\\__, ||_____/| .__/ \__, ||_|  \_\__,_|\__,_|_|\___/
               __/ |       | |     __/ |
              |___/        |_|    |___/   [dim green]v1.0 - LIVE FEED[/]
[/]
"""

SMALL_HEADER = r"""[bright_green]
 ╔═══════════════════════════════════════════════════════════════════╗
 ║  [bold bright_yellow]■[/] SKYSPY RADIO [bold bright_yellow]■[/]  ──  ADS-B / ACARS MONITOR  ──  [bold cyan]◉ LIVE[/]  ║
 ╚═══════════════════════════════════════════════════════════════════╝[/]"""

RADIO_FRAME_TOP = """[green]
┌─────────────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░  ╔═╗╦╔═╦ ╦╔═╗╔═╗╦ ╦  ╦═╗╔═╗╔╦╗╦╔═╗  ░░░░░  ◉ LIVE  ░░░░░░░░░░░░░ │
│ ░  ╚═╗╠╩╗╚╦╝╚═╗╠═╝╚╦╝  ╠╦╝╠═╣ ║║║║ ║  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░  ╚═╝╩ ╩ ╩ ╚═╝╩   ╩   ╩╚═╩ ╩═╩╝╩╚═╝  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├─────────────────────────────────────────────────────────────────────┤[/]"""

RADIO_FRAME_BOTTOM = """[green]
├─────────────────────────────────────────────────────────────────────┤
│ [dim]FREQ: 1090MHz ADS-B │ 136.9MHz ACARS │ VDL2[/]                      │
└─────────────────────────────────────────────────────────────────────┘[/]"""


class RadioState:
    """Shared state for the radio display"""
    def __init__(self):
        self.aircraft: dict = {}
        self.acars_messages: deque = deque(maxlen=50)
        self.stats = {
            "total_aircraft": 0,
            "military": 0,
            "messages_received": 0,
            "last_update": None,
            "connected": False,
            "uptime_start": datetime.now(),
        }
        self.blink_state = False
        self.signal_bars = 0
        self.scroll_offset = 0


def format_altitude(alt: Optional[int]) -> str:
    """Format altitude with flight level notation"""
    if alt is None:
        return "----"
    if alt >= 18000:
        return f"FL{alt // 100:03d}"
    return f"{alt:,}'"


def format_speed(speed: Optional[float]) -> str:
    """Format ground speed"""
    if speed is None:
        return "---"
    return f"{int(speed):3d}kt"


def format_distance(dist: Optional[float]) -> str:
    """Format distance"""
    if dist is None:
        return "---"
    return f"{dist:.1f}nm"


def format_squawk(squawk: Optional[str]) -> Text:
    """Format squawk with emergency highlighting"""
    if not squawk:
        return Text("----", style=DIM_GREEN)

    text = Text(squawk)
    if squawk in ("7500", "7600", "7700"):
        text.stylize(BLINK_RED)
    elif squawk == "7777":
        text.stylize(Style(color="bright_magenta", bold=True))
    else:
        text.stylize(GREEN)
    return text


def get_signal_meter(rssi: Optional[float]) -> str:
    """Create a retro signal strength meter"""
    if rssi is None:
        return "[dim]▁▁▁▁▁[/]"

    # RSSI typically ranges from -50 (strong) to -30 (very strong) down to -120 (weak)
    # Normalize to 0-5 bars
    if rssi > -3:
        bars = 5
    elif rssi > -6:
        bars = 4
    elif rssi > -12:
        bars = 3
    elif rssi > -18:
        bars = 2
    elif rssi > -24:
        bars = 1
    else:
        bars = 0

    filled = "▆" * bars
    empty = "▁" * (5 - bars)

    if bars >= 4:
        return f"[bright_green]{filled}[/][dim]{empty}[/]"
    elif bars >= 2:
        return f"[bright_yellow]{filled}[/][dim]{empty}[/]"
    else:
        return f"[bright_red]{filled}[/][dim]{empty}[/]"


def create_aircraft_table(state: RadioState) -> Table:
    """Create the aircraft tracking table"""
    table = Table(
        box=box.SIMPLE,
        border_style="green",
        header_style="bold bright_green",
        row_styles=["", "dim"],
        padding=(0, 1),
        expand=True,
    )

    table.add_column("ICAO", style="bright_cyan", width=7)
    table.add_column("CALL", style="bright_yellow", width=8)
    table.add_column("ALT", justify="right", width=7)
    table.add_column("SPD", justify="right", width=6)
    table.add_column("HDG", justify="right", width=4)
    table.add_column("DIST", justify="right", width=7)
    table.add_column("SQ", width=5)
    table.add_column("SIG", width=6)
    table.add_column("TYPE", width=5)

    # Sort by distance
    sorted_aircraft = sorted(
        state.aircraft.values(),
        key=lambda x: x.get("distance_nm") or 999
    )

    for ac in sorted_aircraft[:20]:  # Show top 20
        icao = ac.get("hex", "------").upper()
        callsign = ac.get("flight", "").strip() or "-------"
        alt = format_altitude(ac.get("alt_baro") or ac.get("alt"))
        speed = format_speed(ac.get("gs"))
        heading = f"{int(ac.get('track', 0)):03d}" if ac.get("track") else "---"
        dist = format_distance(ac.get("distance_nm"))
        squawk = format_squawk(ac.get("squawk"))
        signal = get_signal_meter(ac.get("rssi"))
        ac_type = ac.get("t", ac.get("type", ""))[:4] or "----"

        # Highlight military aircraft
        style = None
        if ac.get("military"):
            style = "bold bright_magenta"
            icao = f"[bold bright_magenta]{icao}[/]"

        table.add_row(icao, callsign, alt, speed, heading, dist, squawk, signal, ac_type)

    return table


def create_acars_panel(state: RadioState) -> Panel:
    """Create the ACARS message feed panel"""
    lines = []

    for msg in list(state.acars_messages)[-8:]:  # Show last 8 messages
        timestamp = msg.get("timestamp", "")
        if timestamp:
            try:
                dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                time_str = dt.strftime("%H:%M:%S")
            except:
                time_str = timestamp[:8]
        else:
            time_str = "--:--:--"

        callsign = msg.get("callsign", msg.get("flight", "")).strip()[:7] or "-------"
        label = msg.get("label", "--")
        text = msg.get("text", "")[:40] or "[no message]"
        freq = msg.get("frequency", "")
        source = msg.get("source", "ACARS")[:4]

        line = Text()
        line.append(f"{time_str} ", style="dim green")
        line.append(f"[{source}] ", style="cyan")
        line.append(f"{callsign:<7} ", style="bright_yellow")
        line.append(f"L:{label:<3} ", style="bright_green")
        line.append(text, style="green")
        lines.append(line)

    if not lines:
        lines.append(Text("  Waiting for ACARS messages...", style="dim green"))

    content = Group(*lines)

    return Panel(
        content,
        title="[bold bright_green]◄ ACARS/VDL2 FEED ►[/]",
        border_style="green",
        box=box.ROUNDED,
    )


def create_stats_bar(state: RadioState) -> Text:
    """Create the status bar"""
    text = Text()

    # Connection status
    if state.stats["connected"]:
        blink = "◉" if state.blink_state else "○"
        text.append(f" {blink} CONNECTED ", style="bold bright_green on dark_green")
    else:
        text.append(" ○ DISCONNECTED ", style="bold bright_red on dark_red")

    text.append("  │  ", style="dim green")

    # Aircraft count
    total = len(state.aircraft)
    military = sum(1 for ac in state.aircraft.values() if ac.get("military"))
    text.append(f"AIRCRAFT: ", style="dim green")
    text.append(f"{total:3d}", style="bold bright_green")
    if military:
        text.append(f" (MIL:{military})", style="bright_magenta")

    text.append("  │  ", style="dim green")

    # Messages
    text.append(f"MSGS: ", style="dim green")
    text.append(f"{state.stats['messages_received']}", style="bright_cyan")

    text.append("  │  ", style="dim green")

    # Time
    now = datetime.now().strftime("%H:%M:%S")
    text.append(f"UTC: ", style="dim green")
    text.append(now, style="bright_yellow")

    # Uptime
    uptime = datetime.now() - state.stats["uptime_start"]
    hours, remainder = divmod(int(uptime.total_seconds()), 3600)
    minutes, seconds = divmod(remainder, 60)
    text.append("  │  ", style="dim green")
    text.append(f"UP: ", style="dim green")
    text.append(f"{hours:02d}:{minutes:02d}:{seconds:02d}", style="green")

    return text


def create_display(state: RadioState) -> Group:
    """Create the complete display"""
    # Header
    header = Text.from_markup(SMALL_HEADER)

    # Aircraft table in a panel
    aircraft_table = create_aircraft_table(state)
    aircraft_panel = Panel(
        aircraft_table,
        title="[bold bright_green]◄ LIVE AIRCRAFT TRACKING ►[/]",
        subtitle="[dim]sorted by distance[/]",
        border_style="green",
        box=box.ROUNDED,
    )

    # ACARS panel
    acars_panel = create_acars_panel(state)

    # Stats bar
    stats = create_stats_bar(state)
    stats_panel = Panel(
        Align.center(stats),
        border_style="green",
        box=box.HORIZONTALS,
    )

    # Frequency display
    freq_text = Text()
    freq_text.append("  ▸ 1090 MHz ", style="bright_green")
    freq_text.append("[ADS-B]", style="dim")
    freq_text.append("  ▸ 136.900 MHz ", style="bright_cyan")
    freq_text.append("[ACARS]", style="dim")
    freq_text.append("  ▸ 136.725 MHz ", style="bright_yellow")
    freq_text.append("[VDL2]", style="dim")

    return Group(
        header,
        "",
        aircraft_panel,
        "",
        acars_panel,
        "",
        stats_panel,
        Align.center(freq_text),
    )


async def websocket_handler(state: RadioState, host: str, port: int):
    """Handle WebSocket connection and updates"""
    aircraft_url = f"ws://{host}:{port}/ws/aircraft/?topics=aircraft"
    acars_url = f"ws://{host}:{port}/ws/acars/?topics=messages"

    async def handle_aircraft():
        while True:
            try:
                async with websockets.connect(aircraft_url) as ws:
                    state.stats["connected"] = True

                    # Subscribe
                    await ws.send(json.dumps({
                        "action": "subscribe",
                        "topics": ["aircraft"]
                    }))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            msg_type = data.get("type", "")

                            if msg_type == "aircraft:snapshot":
                                aircraft_data = data.get("data", {})
                                if isinstance(aircraft_data, dict):
                                    state.aircraft = aircraft_data.get("aircraft", {})
                                elif isinstance(aircraft_data, list):
                                    state.aircraft = {ac.get("hex"): ac for ac in aircraft_data if ac.get("hex")}

                            elif msg_type == "aircraft:update":
                                ac = data.get("data", {})
                                if ac.get("hex"):
                                    state.aircraft[ac["hex"]] = ac
                                state.stats["messages_received"] += 1

                            elif msg_type == "aircraft:new":
                                ac = data.get("data", {})
                                if ac.get("hex"):
                                    state.aircraft[ac["hex"]] = ac
                                state.stats["messages_received"] += 1

                            elif msg_type == "aircraft:remove":
                                hex_code = data.get("data", {}).get("hex")
                                if hex_code and hex_code in state.aircraft:
                                    del state.aircraft[hex_code]

                            state.stats["last_update"] = datetime.now()
                        except json.JSONDecodeError:
                            pass

            except Exception as e:
                state.stats["connected"] = False
                await asyncio.sleep(2)

    async def handle_acars():
        while True:
            try:
                async with websockets.connect(acars_url) as ws:
                    await ws.send(json.dumps({
                        "action": "subscribe",
                        "topics": ["messages"]
                    }))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            msg_type = data.get("type", "")

                            if msg_type in ("acars:message", "acars:snapshot"):
                                msg_data = data.get("data", {})
                                if isinstance(msg_data, list):
                                    for msg in msg_data:
                                        state.acars_messages.append(msg)
                                else:
                                    state.acars_messages.append(msg_data)
                                state.stats["messages_received"] += 1
                        except json.JSONDecodeError:
                            pass
            except Exception:
                await asyncio.sleep(2)

    await asyncio.gather(handle_aircraft(), handle_acars())


async def blink_task(state: RadioState):
    """Blink the connection indicator"""
    while True:
        state.blink_state = not state.blink_state
        await asyncio.sleep(0.5)


async def run_radio(host: str, port: int):
    """Main radio display loop"""
    state = RadioState()

    # Start WebSocket handlers
    ws_task = asyncio.create_task(websocket_handler(state, host, port))
    blink = asyncio.create_task(blink_task(state))

    # Startup banner
    console.print(ASCII_HEADER)
    console.print("[dim green]Initializing radio receiver...[/]")
    console.print(f"[dim green]Connecting to {host}:{port}...[/]\n")
    await asyncio.sleep(1)

    try:
        with Live(
            create_display(state),
            console=console,
            refresh_per_second=4,
            screen=True,
        ) as live:
            while True:
                live.update(create_display(state))
                await asyncio.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        ws_task.cancel()
        blink.cancel()
        console.print("\n[bright_yellow]Radio signing off...[/]")


@click.command()
@click.option("--host", default="localhost", help="Server hostname")
@click.option("--port", default=80, type=int, help="Server port")
def main(host: str, port: int):
    """
    SkySpy Radio - Old School Aircraft Monitor

    A retro terminal interface for live ADS-B and ACARS tracking.
    """
    try:
        asyncio.run(run_radio(host, port))
    except KeyboardInterrupt:
        console.print("\n[bright_yellow]73s de SkySpy Radio[/]")


if __name__ == "__main__":
    main()
