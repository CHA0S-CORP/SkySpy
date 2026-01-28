"""
SkySpy CLI Theme System
Color schemes inspired by vintage and modern radar displays
"""

from dataclasses import dataclass
from typing import Dict
from rich.style import Style


@dataclass
class Theme:
    """Color theme definition"""
    name: str
    description: str

    # Primary colors
    primary: str
    primary_bright: str
    primary_dim: str

    # Secondary/accent colors
    secondary: str
    secondary_bright: str

    # Status colors
    success: str
    warning: str
    error: str
    info: str

    # Special highlights
    military: str
    emergency: str
    selected: str

    # UI elements
    border: str
    border_dim: str
    text: str
    text_dim: str
    background: str

    # Radar specific
    radar_sweep: str
    radar_ring: str
    radar_target: str
    radar_trail: str

    def get_style(self, name: str) -> Style:
        """Get a Rich Style object for the named color"""
        color = getattr(self, name, self.text)
        return Style(color=color)

    def style(self, name: str, bold: bool = False, dim: bool = False, blink: bool = False) -> str:
        """Get style string for Rich markup"""
        color = getattr(self, name, self.text)
        parts = [color]
        if bold:
            parts.append("bold")
        if dim:
            parts.append("dim")
        if blink:
            parts.append("blink")
        return " ".join(parts)


# ══════════════════════════════════════════════════════════════════════════════
# THEME DEFINITIONS
# ══════════════════════════════════════════════════════════════════════════════

THEMES: Dict[str, Theme] = {}


# Classic Green - Old school radar/terminal look
THEMES["classic"] = Theme(
    name="Classic Green",
    description="Traditional green phosphor display",

    primary="green",
    primary_bright="bright_green",
    primary_dim="dark_green",

    secondary="cyan",
    secondary_bright="bright_cyan",

    success="bright_green",
    warning="bright_yellow",
    error="bright_red",
    info="bright_cyan",

    military="bright_magenta",
    emergency="bright_red",
    selected="bright_yellow",

    border="green",
    border_dim="dark_green",
    text="green",
    text_dim="dark_green",
    background="black",

    radar_sweep="bright_green",
    radar_ring="dark_green",
    radar_target="bright_green",
    radar_trail="green",
)


# Amber - Vintage amber monochrome
THEMES["amber"] = Theme(
    name="Amber",
    description="Vintage amber monochrome display",

    primary="yellow",
    primary_bright="bright_yellow",
    primary_dim="dark_orange",

    secondary="bright_yellow",
    secondary_bright="bright_white",

    success="bright_yellow",
    warning="bright_white",
    error="bright_red",
    info="bright_yellow",

    military="bright_magenta",
    emergency="bright_red",
    selected="bright_white",

    border="yellow",
    border_dim="dark_orange",
    text="yellow",
    text_dim="dark_orange",
    background="black",

    radar_sweep="bright_yellow",
    radar_ring="dark_orange",
    radar_target="bright_yellow",
    radar_trail="yellow",
)


# Blue Ice - Cold blue tactical display
THEMES["ice"] = Theme(
    name="Blue Ice",
    description="Cold blue tactical display",

    primary="blue",
    primary_bright="bright_blue",
    primary_dim="dark_blue",

    secondary="cyan",
    secondary_bright="bright_cyan",

    success="bright_cyan",
    warning="bright_yellow",
    error="bright_red",
    info="bright_blue",

    military="bright_magenta",
    emergency="bright_red",
    selected="bright_white",

    border="blue",
    border_dim="dark_blue",
    text="bright_blue",
    text_dim="blue",
    background="black",

    radar_sweep="bright_cyan",
    radar_ring="dark_blue",
    radar_target="bright_cyan",
    radar_trail="blue",
)


# Cyberpunk - Neon pink/cyan futuristic
THEMES["cyberpunk"] = Theme(
    name="Cyberpunk",
    description="Neon futuristic display",

    primary="magenta",
    primary_bright="bright_magenta",
    primary_dim="dark_magenta",

    secondary="cyan",
    secondary_bright="bright_cyan",

    success="bright_cyan",
    warning="bright_yellow",
    error="bright_red",
    info="bright_magenta",

    military="bright_yellow",
    emergency="bright_red",
    selected="bright_white",

    border="bright_magenta",
    border_dim="magenta",
    text="bright_cyan",
    text_dim="cyan",
    background="black",

    radar_sweep="bright_magenta",
    radar_ring="dark_magenta",
    radar_target="bright_cyan",
    radar_trail="magenta",
)


# Military - Tactical green/tan
THEMES["military"] = Theme(
    name="Military",
    description="Tactical military display",

    primary="green",
    primary_bright="bright_green",
    primary_dim="dark_green",

    secondary="yellow",
    secondary_bright="bright_yellow",

    success="bright_green",
    warning="bright_yellow",
    error="bright_red",
    info="bright_green",

    military="bright_yellow",
    emergency="bright_red",
    selected="bright_white",

    border="green",
    border_dim="dark_green",
    text="bright_green",
    text_dim="green",
    background="black",

    radar_sweep="bright_green",
    radar_ring="dark_green",
    radar_target="bright_yellow",
    radar_trail="green",
)


# High Contrast - White on black for visibility
THEMES["high_contrast"] = Theme(
    name="High Contrast",
    description="Maximum visibility white display",

    primary="white",
    primary_bright="bright_white",
    primary_dim="grey70",

    secondary="bright_cyan",
    secondary_bright="bright_white",

    success="bright_green",
    warning="bright_yellow",
    error="bright_red",
    info="bright_cyan",

    military="bright_magenta",
    emergency="bright_red",
    selected="bright_yellow",

    border="white",
    border_dim="grey50",
    text="bright_white",
    text_dim="grey70",
    background="black",

    radar_sweep="bright_white",
    radar_ring="grey50",
    radar_target="bright_white",
    radar_trail="grey70",
)


# Phosphor - Realistic CRT phosphor with afterglow
THEMES["phosphor"] = Theme(
    name="Phosphor",
    description="Realistic CRT phosphor glow",

    primary="#33ff33",
    primary_bright="#66ff66",
    primary_dim="#116611",

    secondary="#33ffff",
    secondary_bright="#66ffff",

    success="#66ff66",
    warning="#ffff33",
    error="#ff3333",
    info="#33ffff",

    military="#ff33ff",
    emergency="#ff3333",
    selected="#ffff66",

    border="#33ff33",
    border_dim="#116611",
    text="#33ff33",
    text_dim="#116611",
    background="black",

    radar_sweep="#66ff66",
    radar_ring="#114411",
    radar_target="#66ff66",
    radar_trail="#227722",
)


# Sunset - Warm orange/red
THEMES["sunset"] = Theme(
    name="Sunset",
    description="Warm orange sunset tones",

    primary="dark_orange",
    primary_bright="bright_red",
    primary_dim="red",

    secondary="bright_yellow",
    secondary_bright="bright_white",

    success="bright_green",
    warning="bright_yellow",
    error="bright_red",
    info="bright_yellow",

    military="bright_magenta",
    emergency="bright_white",
    selected="bright_white",

    border="dark_orange",
    border_dim="red",
    text="bright_yellow",
    text_dim="dark_orange",
    background="black",

    radar_sweep="bright_red",
    radar_ring="red",
    radar_target="bright_yellow",
    radar_trail="dark_orange",
)


# Matrix - The Matrix inspired green rain
THEMES["matrix"] = Theme(
    name="Matrix",
    description="Matrix digital rain inspired",

    primary="#00ff00",
    primary_bright="#00ff00",
    primary_dim="#003300",

    secondary="#00ff00",
    secondary_bright="#88ff88",

    success="#00ff00",
    warning="#ffff00",
    error="#ff0000",
    info="#00ff00",

    military="#ff00ff",
    emergency="#ff0000",
    selected="#ffffff",

    border="#00ff00",
    border_dim="#004400",
    text="#00ff00",
    text_dim="#006600",
    background="black",

    radar_sweep="#00ff00",
    radar_ring="#003300",
    radar_target="#00ff00",
    radar_trail="#004400",
)


# Ocean - Deep blue oceanic
THEMES["ocean"] = Theme(
    name="Ocean",
    description="Deep blue oceanic display",

    primary="#0066cc",
    primary_bright="#0099ff",
    primary_dim="#003366",

    secondary="#00cccc",
    secondary_bright="#00ffff",

    success="#00cc66",
    warning="#ffcc00",
    error="#ff3333",
    info="#00ccff",

    military="#cc00cc",
    emergency="#ff3333",
    selected="#ffffff",

    border="#0066cc",
    border_dim="#003366",
    text="#0099ff",
    text_dim="#006699",
    background="black",

    radar_sweep="#00ccff",
    radar_ring="#003366",
    radar_target="#00ffff",
    radar_trail="#006699",
)


def get_theme(name: str) -> Theme:
    """Get a theme by name, returns classic if not found"""
    return THEMES.get(name, THEMES["classic"])


def list_themes() -> list:
    """Get list of available theme names"""
    return list(THEMES.keys())


def get_theme_info() -> list:
    """Get list of theme names and descriptions"""
    return [(name, theme.name, theme.description) for name, theme in THEMES.items()]
