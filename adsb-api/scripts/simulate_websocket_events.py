#!/usr/bin/env python3
"""
WebSocket Event Simulator for SkySpyAPI

This script simulates real-time WebSocket events for testing the frontend UI
without requiring actual ADS-B data. Run this while the API is running and
the frontend is connected to see live updates.

Usage:
    # Run full scenario (all event types)
    python scripts/simulate_websocket_events.py

    # Run specific simulations
    python scripts/simulate_websocket_events.py --aircraft 10
    python scripts/simulate_websocket_events.py --emergency
    python scripts/simulate_websocket_events.py --conflict
    python scripts/simulate_websocket_events.py --airspace TURB
    python scripts/simulate_websocket_events.py --acars "DEPARTURE CLEARANCE"

    # Continuous simulation mode (new events every N seconds)
    python scripts/simulate_websocket_events.py --continuous --interval 5

Requirements:
    The API server must be running. This script imports from the app modules.
"""
import argparse
import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.websocket import get_ws_manager, ConnectionManager


class WebSocketEventSimulator:
    """Simulates WebSocket events for frontend testing."""

    def __init__(self):
        self.manager = get_ws_manager()
        self._aircraft_counter = 0

    def _generate_icao(self) -> str:
        """Generate a unique ICAO hex code."""
        self._aircraft_counter += 1
        return f"SIM{self._aircraft_counter:04X}"

    async def simulate_new_aircraft(self, count: int = 1) -> list[dict]:
        """Simulate new aircraft appearing."""
        import random
        from datetime import datetime

        aircraft_types = ["B738", "A320", "E170", "CRJ2", "B77W", "A321", "B739"]
        airlines = [
            ("UAL", "United"), ("DAL", "Delta"), ("AAL", "American"),
            ("SWA", "Southwest"), ("ASA", "Alaska"), ("JBU", "JetBlue"),
        ]

        generated = []
        for _ in range(count):
            icao = self._generate_icao()
            airline = random.choice(airlines)
            flight_num = random.randint(100, 9999)

            aircraft = {
                "hex": icao,
                "flight": f"{airline[0]}{flight_num}",
                "lat": 47.0 + random.uniform(0, 2),
                "lon": -122.5 + random.uniform(0, 1),
                "alt_baro": random.randint(5000, 40000),
                "gs": random.randint(150, 500),
                "track": random.randint(0, 359),
                "baro_rate": random.randint(-2000, 2000),
                "squawk": "1200",
                "category": random.choice(["A1", "A2", "A3", "A4", "A5"]),
                "t": random.choice(aircraft_types),
            }
            generated.append(aircraft)

        all_aircraft = list(self.manager._last_aircraft_state.values()) + generated
        await self.manager.publish_aircraft_update(all_aircraft)

        print(f"[AIRCRAFT] Simulated {count} new aircraft: {[a['hex'] for a in generated]}")
        return generated

    async def simulate_military_aircraft(self, count: int = 1) -> list[dict]:
        """Simulate military aircraft appearing."""
        import random

        military_types = ["C17", "C130", "KC135", "F15", "F16", "F18", "F22"]
        callsigns = ["RCH", "EVAC", "REACH", "DUKE", "VIPER", "EAGLE"]

        generated = []
        for _ in range(count):
            icao = self._generate_icao()
            aircraft = {
                "hex": icao,
                "flight": f"{random.choice(callsigns)}{random.randint(1, 999):03d}",
                "lat": 47.0 + random.uniform(0, 2),
                "lon": -122.5 + random.uniform(0, 1),
                "alt_baro": random.randint(15000, 45000),
                "gs": random.randint(250, 550),
                "track": random.randint(0, 359),
                "baro_rate": random.randint(-1000, 1000),
                "squawk": f"{random.randint(4000, 4777)}",
                "category": "A5",
                "t": random.choice(military_types),
                "dbFlags": 1,
            }
            generated.append(aircraft)

        all_aircraft = list(self.manager._last_aircraft_state.values()) + generated
        await self.manager.publish_aircraft_update(all_aircraft)

        print(f"[MILITARY] Simulated {count} military aircraft: {[a['hex'] for a in generated]}")
        return generated

    async def simulate_emergency_squawk(self, squawk: str = "7700") -> dict:
        """Simulate aircraft with emergency squawk."""
        icao = self._generate_icao()
        aircraft = {
            "hex": icao,
            "flight": "EMG999",
            "lat": 47.9,
            "lon": -122.0,
            "alt_baro": 8000,
            "gs": 180,
            "track": 180,
            "baro_rate": -1500,
            "squawk": squawk,
            "category": "A1",
            "t": "C172",
        }

        all_aircraft = list(self.manager._last_aircraft_state.values()) + [aircraft]
        await self.manager.publish_aircraft_update(all_aircraft)

        squawk_names = {"7500": "HIJACK", "7600": "RADIO FAILURE", "7700": "EMERGENCY"}
        print(f"[EMERGENCY] Simulated {squawk_names.get(squawk, 'UNKNOWN')} squawk: {icao}")
        return aircraft

    async def simulate_safety_conflict(self) -> dict:
        """Simulate proximity conflict between two aircraft."""
        import random

        icao_1, icao_2 = self._generate_icao(), self._generate_icao()
        distance = round(random.uniform(0.3, 0.9), 2)
        alt_diff = random.randint(100, 800)

        event = {
            "event_type": "proximity_conflict",
            "severity": "critical",
            "icao": icao_1,
            "icao_2": icao_2,
            "callsign": f"AAL{random.randint(100, 999)}",
            "callsign_2": f"DAL{random.randint(100, 999)}",
            "message": f"Proximity conflict: {distance}nm lateral, {alt_diff}ft vertical",
            "details": {
                "distance_nm": distance,
                "altitude_diff_ft": alt_diff,
                "closure_rate_kts": random.randint(200, 600),
            }
        }

        await self.manager.publish_safety_event(event)
        print(f"[SAFETY] Simulated proximity conflict: {icao_1} vs {icao_2}")
        return event

    async def simulate_tcas_ra(self) -> dict:
        """Simulate TCAS Resolution Advisory detection."""
        import random

        icao = self._generate_icao()
        prev_rate = random.randint(1000, 3000)
        curr_rate = -random.randint(2000, 4000)

        event = {
            "event_type": "tcas_ra_detected",
            "severity": "critical",
            "icao": icao,
            "callsign": f"UAL{random.randint(100, 999)}",
            "message": "Possible TCAS RA: Rapid vertical rate reversal detected",
            "details": {
                "previous_rate": prev_rate,
                "current_rate": curr_rate,
                "rate_change": abs(prev_rate - curr_rate),
                "altitude": random.randint(20000, 38000),
            }
        }

        await self.manager.publish_safety_event(event)
        print(f"[TCAS] Simulated TCAS RA: {icao}")
        return event

    async def simulate_extreme_vertical_rate(self, rate: int = -5500) -> dict:
        """Simulate extreme vertical rate event."""
        import random

        icao = self._generate_icao()
        direction = "descent" if rate < 0 else "climb"

        event = {
            "event_type": "extreme_vertical_rate",
            "severity": "critical" if abs(rate) > 6000 else "warning",
            "icao": icao,
            "callsign": f"SWA{random.randint(100, 999)}",
            "message": f"Extreme {direction} rate: {rate} ft/min",
            "details": {"vertical_rate": rate, "altitude": random.randint(10000, 35000)}
        }

        await self.manager.publish_safety_event(event)
        print(f"[SAFETY] Simulated extreme vertical rate: {icao} @ {rate} ft/min")
        return event

    async def simulate_alert_triggered(self, rule_name: str = "Test Alert", priority: str = "warning") -> dict:
        """Simulate custom alert rule trigger."""
        import random

        icao = self._generate_icao()
        aircraft_data = {
            "hex": icao,
            "flight": f"TEST{random.randint(100, 999)}",
            "alt": random.randint(3000, 10000),
            "lat": 47.95,
            "lon": -121.95,
            "gs": random.randint(150, 350),
            "track": random.randint(0, 359),
            "military": False,
            "distance_nm": round(random.uniform(5, 30), 1),
        }

        await self.manager.publish_alert_triggered(
            rule_id=random.randint(1, 100),
            rule_name=rule_name,
            icao=icao,
            callsign=aircraft_data["flight"],
            message=f"Alert triggered: {rule_name}",
            priority=priority,
            aircraft_data=aircraft_data
        )

        print(f"[ALERT] Simulated alert '{rule_name}' ({priority}): {icao}")
        return aircraft_data

    async def simulate_airspace_advisory(self, hazard: str = "IFR") -> list[dict]:
        """Simulate airspace advisory update."""
        import random
        from datetime import datetime, timedelta

        hazard_configs = {
            "IFR": {"lower": 0, "upper": 8000, "severity": "LIFR"},
            "TURB": {"lower": 15000, "upper": 40000, "severity": "MOD"},
            "ICE": {"lower": 5000, "upper": 20000, "severity": "MOD"},
            "MTN_OBSCN": {"lower": 0, "upper": 12000, "severity": "warning"},
        }
        config = hazard_configs.get(hazard, {"lower": 0, "upper": 10000, "severity": "warning"})

        advisory = {
            "advisory_id": f"GAIRMET-{hazard}-{random.randint(1, 99)}",
            "advisory_type": "GAIRMET",
            "hazard": hazard,
            "severity": config["severity"],
            "valid_from": datetime.utcnow().isoformat() + "Z",
            "valid_to": (datetime.utcnow() + timedelta(hours=6)).isoformat() + "Z",
            "lower_alt_ft": config["lower"],
            "upper_alt_ft": config["upper"],
            "region": "PACIFIC",
            "polygon": {
                "type": "Polygon",
                "coordinates": [[[-123, 47], [-121, 47], [-121, 49], [-123, 49], [-123, 47]]]
            },
        }

        await self.manager.publish_advisory_update([advisory])
        print(f"[AIRSPACE] Simulated {hazard} advisory: {advisory['advisory_id']}")
        return [advisory]

    async def simulate_acars_message(self, text: str = "TEST MESSAGE", source: str = "acars") -> dict:
        """Simulate ACARS/VDL2 message reception."""
        import random

        icao = self._generate_icao()
        msg = {
            "source": source,
            "icao_hex": icao,
            "registration": f"N{icao[1:]}",
            "callsign": f"UAL{random.randint(100, 999)}",
            "label": "H1",
            "text": text,
            "frequency": 130.025 if source == "acars" else 136.975,
            "signal_level": round(random.uniform(-50, -25), 1),
        }

        await self.manager.publish_acars_message(msg)
        print(f"[ACARS] Simulated {source.upper()} message: {icao}")
        return msg

    async def simulate_full_scenario(self, delay: float = 1.0) -> dict:
        """Run a complete scenario with all event types."""
        print("\n=== Starting Full WebSocket Simulation Scenario ===\n")

        # Commercial aircraft
        await self.simulate_new_aircraft(5)
        await asyncio.sleep(delay)

        # Military
        await self.simulate_military_aircraft(2)
        await asyncio.sleep(delay)

        # Airspace
        await self.simulate_airspace_advisory("TURB")
        await asyncio.sleep(delay)
        await self.simulate_airspace_advisory("IFR")
        await asyncio.sleep(delay)

        # Safety events
        await self.simulate_safety_conflict()
        await asyncio.sleep(delay)
        await self.simulate_tcas_ra()
        await asyncio.sleep(delay)
        await self.simulate_extreme_vertical_rate(-5500)
        await asyncio.sleep(delay)

        # Alerts
        await self.simulate_alert_triggered("Low Altitude", "warning")
        await asyncio.sleep(delay)
        await self.simulate_alert_triggered("Military Aircraft", "info")
        await asyncio.sleep(delay)

        # Emergency
        await self.simulate_emergency_squawk("7700")
        await asyncio.sleep(delay)

        # ACARS
        await self.simulate_acars_message("ATIS INFO ALPHA KSEA WIND 180@10 VIS 10SM")
        await asyncio.sleep(delay)
        await self.simulate_acars_message("POSITION REPORT FL350 47.5N 122.3W", "vdlm2")

        print("\n=== Simulation Complete ===")
        return {"status": "complete"}

    async def clear_all_aircraft(self):
        """Remove all aircraft from tracking."""
        self.manager._last_aircraft_state = {}
        await self.manager.publish_aircraft_update([])
        print("[CLEAR] All aircraft removed from tracking")


async def continuous_simulation(simulator: WebSocketEventSimulator, interval: float):
    """Run continuous simulation with random events."""
    import random

    print(f"\n=== Starting Continuous Simulation (interval: {interval}s) ===")
    print("Press Ctrl+C to stop\n")

    event_functions = [
        lambda: simulator.simulate_new_aircraft(random.randint(1, 3)),
        lambda: simulator.simulate_safety_conflict(),
        lambda: simulator.simulate_extreme_vertical_rate(random.randint(-6000, -4000)),
        lambda: simulator.simulate_alert_triggered("Random Alert", random.choice(["info", "warning"])),
        lambda: simulator.simulate_airspace_advisory(random.choice(["IFR", "TURB", "ICE"])),
        lambda: simulator.simulate_acars_message(f"MSG {random.randint(1000, 9999)}"),
    ]

    try:
        while True:
            event_fn = random.choice(event_functions)
            await event_fn()
            await asyncio.sleep(interval)
    except KeyboardInterrupt:
        print("\n\n=== Continuous Simulation Stopped ===")


def main():
    parser = argparse.ArgumentParser(
        description="Simulate WebSocket events for SkySpyAPI frontend testing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                           Run full scenario
  %(prog)s --aircraft 10             Simulate 10 new aircraft
  %(prog)s --military 2              Simulate 2 military aircraft
  %(prog)s --emergency               Simulate emergency squawk (7700)
  %(prog)s --conflict                Simulate proximity conflict
  %(prog)s --tcas                    Simulate TCAS RA
  %(prog)s --airspace TURB           Simulate turbulence advisory
  %(prog)s --acars "CLEARANCE"       Simulate ACARS message
  %(prog)s --alert "Low Alt" warning Simulate custom alert
  %(prog)s --continuous --interval 3 Continuous random events
  %(prog)s --clear                   Clear all aircraft
        """
    )

    parser.add_argument("--aircraft", type=int, metavar="N", help="Simulate N new aircraft")
    parser.add_argument("--military", type=int, metavar="N", help="Simulate N military aircraft")
    parser.add_argument("--emergency", action="store_true", help="Simulate emergency squawk")
    parser.add_argument("--squawk", default="7700", help="Emergency squawk code (default: 7700)")
    parser.add_argument("--conflict", action="store_true", help="Simulate proximity conflict")
    parser.add_argument("--tcas", action="store_true", help="Simulate TCAS RA")
    parser.add_argument("--vertical-rate", type=int, metavar="FPM", help="Simulate extreme vertical rate")
    parser.add_argument("--airspace", metavar="HAZARD", help="Simulate airspace advisory (IFR, TURB, ICE)")
    parser.add_argument("--acars", metavar="TEXT", help="Simulate ACARS message")
    parser.add_argument("--alert", nargs=2, metavar=("NAME", "PRIORITY"), help="Simulate alert trigger")
    parser.add_argument("--continuous", action="store_true", help="Run continuous simulation")
    parser.add_argument("--interval", type=float, default=5.0, help="Interval for continuous mode (default: 5s)")
    parser.add_argument("--clear", action="store_true", help="Clear all aircraft")
    parser.add_argument("--full", action="store_true", help="Run full scenario (default if no args)")

    args = parser.parse_args()

    simulator = WebSocketEventSimulator()

    async def run():
        any_action = False

        if args.clear:
            await simulator.clear_all_aircraft()
            any_action = True

        if args.aircraft:
            await simulator.simulate_new_aircraft(args.aircraft)
            any_action = True

        if args.military:
            await simulator.simulate_military_aircraft(args.military)
            any_action = True

        if args.emergency:
            await simulator.simulate_emergency_squawk(args.squawk)
            any_action = True

        if args.conflict:
            await simulator.simulate_safety_conflict()
            any_action = True

        if args.tcas:
            await simulator.simulate_tcas_ra()
            any_action = True

        if args.vertical_rate:
            await simulator.simulate_extreme_vertical_rate(args.vertical_rate)
            any_action = True

        if args.airspace:
            await simulator.simulate_airspace_advisory(args.airspace)
            any_action = True

        if args.acars:
            await simulator.simulate_acars_message(args.acars)
            any_action = True

        if args.alert:
            await simulator.simulate_alert_triggered(args.alert[0], args.alert[1])
            any_action = True

        if args.continuous:
            await continuous_simulation(simulator, args.interval)
            any_action = True

        if args.full or not any_action:
            await simulator.simulate_full_scenario()

    asyncio.run(run())


if __name__ == "__main__":
    main()
