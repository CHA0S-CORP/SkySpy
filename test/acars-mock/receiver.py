#!/usr/bin/env python3
"""
Example ACARS Message Receiver

This script demonstrates how to receive ACARS messages from the mock service.
It can receive via:
1. UDP (same as how acarshub receives from decoders)
2. TCP (same as acarshub's relay ports)
3. WebSocket (for web-based consumers)

Usage:
    python receiver.py --mode udp --port 5000
    python receiver.py --mode tcp --host localhost --port 15550
    python receiver.py --mode websocket --host localhost --port 8080
"""

import argparse
import asyncio
import json
import socket
import sys
from datetime import datetime


def format_acars_message(msg: dict) -> str:
    """Format an ACARS message for display"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    
    # Check if it's VDLM2 format
    if "vdl2" in msg:
        acars = msg.get("vdl2", {}).get("avlc", {}).get("acars", {})
        reg = acars.get("reg", "N/A")
        flight = acars.get("flight", "N/A")
        label = acars.get("label", "")
        text = acars.get("msg_text", "")[:60]
        freq = msg.get("vdl2", {}).get("freq", 0) / 1000000
        return f"[{timestamp}] VDLM2 {freq:.3f}MHz | {reg:>8} | {flight:>8} | {label:>2} | {text}"
    
    # ACARS format
    tail = msg.get("tail", "N/A")
    flight = msg.get("flight", "N/A")
    label = msg.get("label", "")
    text = msg.get("text", "")[:60]
    freq = msg.get("freq", 0)
    return f"[{timestamp}] ACARS {freq:.3f}MHz | {tail:>8} | {flight:>8} | {label:>2} | {text}"


async def receive_udp(port: int):
    """Receive messages via UDP"""
    print(f"🛩️  Starting UDP receiver on port {port}...")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('0.0.0.0', port))
    sock.setblocking(False)
    
    loop = asyncio.get_event_loop()
    
    print("Listening for ACARS messages...\n")
    
    while True:
        try:
            data = await loop.sock_recv(sock, 65535)
            if data:
                try:
                    msg = json.loads(data.decode('utf-8'))
                    print(format_acars_message(msg))
                except json.JSONDecodeError:
                    print(f"Invalid JSON: {data[:100]}")
        except Exception as e:
            print(f"Error: {e}")
            await asyncio.sleep(1)


async def receive_tcp(host: str, port: int):
    """Receive messages via TCP"""
    print(f"🛩️  Connecting to TCP relay at {host}:{port}...")
    
    while True:
        try:
            reader, writer = await asyncio.open_connection(host, port)
            print(f"Connected! Listening for ACARS messages...\n")
            
            while True:
                data = await reader.readline()
                if not data:
                    print("Connection closed by server")
                    break
                
                try:
                    msg = json.loads(data.decode('utf-8'))
                    print(format_acars_message(msg))
                except json.JSONDecodeError:
                    print(f"Invalid JSON: {data[:100]}")
                    
        except ConnectionRefusedError:
            print(f"Connection refused. Retrying in 5 seconds...")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"Error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)


async def receive_websocket(host: str, port: int):
    """Receive messages via WebSocket"""
    try:
        import websockets
    except ImportError:
        print("Please install websockets: pip install websockets")
        sys.exit(1)
    
    uri = f"ws://{host}:{port}/ws"
    print(f"🛩️  Connecting to WebSocket at {uri}...")
    
    while True:
        try:
            async with websockets.connect(uri) as ws:
                print("Connected! Listening for ACARS messages...\n")
                
                async for message in ws:
                    try:
                        msg = json.loads(message)
                        print(format_acars_message(msg))
                    except json.JSONDecodeError:
                        print(f"Invalid JSON: {message[:100]}")
                        
        except ConnectionRefusedError:
            print(f"Connection refused. Retrying in 5 seconds...")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"Error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)


def main():
    parser = argparse.ArgumentParser(description="ACARS Message Receiver")
    parser.add_argument("--mode", choices=["udp", "tcp", "websocket"], default="tcp",
                        help="Receive mode (default: tcp)")
    parser.add_argument("--host", default="localhost",
                        help="Host to connect to (for tcp/websocket)")
    parser.add_argument("--port", type=int, default=15550,
                        help="Port to listen on or connect to")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("ACARS Message Receiver")
    print("=" * 60)
    
    try:
        if args.mode == "udp":
            asyncio.run(receive_udp(args.port))
        elif args.mode == "tcp":
            asyncio.run(receive_tcp(args.host, args.port))
        else:
            asyncio.run(receive_websocket(args.host, args.port))
    except KeyboardInterrupt:
        print("\n\nShutting down...")


if __name__ == "__main__":
    main()
