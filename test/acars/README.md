# ACARSHUB Mock Service

A mock implementation of [sdr-enthusiasts/docker-acarshub](https://github.com/sdr-enthusiasts/docker-acarshub) for testing and development purposes.

## Features

- **Mock Message Generation**: Generates realistic ACARS and VDLM2 messages with proper JSON format
- **UDP Receiver**: Accepts messages on the same ports as real ACARSHUB (5550, 5555, etc.)
- **TCP Relay**: Streams messages to connected clients (ports 15550, 15555, etc.)
- **Message Relay**: Forwards all messages to a configurable downstream service
- **Web Interface**: Live message viewing and statistics at port 8080
- **WebSocket API**: Real-time message streaming
- **REST API**: Control and monitoring endpoints

## Quick Start

### Using Docker

```bash
# Build the image
docker build -t acarshub-mock .

# Run with mock generation
docker run -d \
  --name acarshub-mock \
  -p 8080:8080 \
  -p 5550:5550/udp \
  -p 5555:5555/udp \
  -p 15550:15550 \
  -p 15555:15555 \
  -e MOCK_ENABLED=true \
  -e RELAY_HOST=your-service \
  -e RELAY_PORT=5000 \
  acarshub-mock
```

### Using Python Directly

```bash
# Install dependencies
pip install -r requirements.txt

# Run the service
python app.py
```

## Port Mapping

| Port | Protocol | Purpose | Real ACARSHUB Equivalent |
|------|----------|---------|--------------------------|
| 5550 | UDP | ACARS input (acarsdec) | ✅ Same |
| 5555 | UDP | VDLM2 input (dumpvdl2) | ✅ Same |
| 5556 | UDP | HFDL input (dumphfdl) | ✅ Same |
| 5557 | UDP | IMSL input (Inmarsat) | ✅ Same |
| 5558 | UDP | IRDM input (Iridium) | ✅ Same |
| 15550 | TCP | ACARS relay output | ✅ Same |
| 15555 | TCP | VDLM2 relay output | ✅ Same |
| 15556 | TCP | HFDL relay output | ✅ Same |
| 15557 | TCP | IMSL relay output | ✅ Same |
| 15558 | TCP | IRDM relay output | ✅ Same |
| 8080 | HTTP | Web interface & API | 80 in real ACARSHUB |

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_ENABLED` | `true` | Enable mock message generation |
| `MOCK_INTERVAL_MIN` | `1.0` | Minimum seconds between messages |
| `MOCK_INTERVAL_MAX` | `5.0` | Maximum seconds between messages |
| `RELAY_HOST` | `` | Hostname/IP to relay messages to |
| `RELAY_PORT` | `0` | Port to relay messages to |
| `RELAY_PROTOCOL` | `udp` | Protocol for relay (udp/tcp) |
| `STATION_ID` | `MOCK-STATION` | Station identifier in messages |
| `WEB_PORT` | `8080` | Web interface port |

## API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web interface |
| `/api/stats` | GET | Service statistics |
| `/api/messages` | GET | Recent messages (limit param) |
| `/api/mock/start` | POST | Start mock generation |
| `/api/mock/stop` | POST | Stop mock generation |
| `/api/inject` | POST | Inject a custom message |

### WebSocket

Connect to `/ws` for real-time message streaming.

## Message Formats

### ACARS (acarsdec format)

```json
{
  "timestamp": 1703001234.567,
  "station_id": "MOCK-STATION",
  "channel": 0,
  "freq": 131.55,
  "level": -32,
  "error": 0,
  "mode": "2",
  "label": "SA",
  "block_id": "1",
  "ack": "!",
  "tail": "N12345",
  "flight": "AAL123",
  "msgno": "S01A",
  "text": "POSITION REPORT...",
  "end": true
}
```

### VDLM2 (dumpvdl2 format)

```json
{
  "vdl2": {
    "app": {
      "name": "dumpvdl2",
      "ver": "2.5.0"
    },
    "t": {
      "sec": 1703001234,
      "usec": 567000
    },
    "freq": 136975000,
    "sig_level": -28,
    "noise_level": -48,
    "station": "MOCK-STATION",
    "avlc": {
      "src": {
        "addr": "N12345",
        "type": "Aircraft",
        "status": "Airborne"
      },
      "dst": {
        "addr": "GROUND",
        "type": "Ground station"
      },
      "acars": {
        "err": true,
        "crc_ok": true,
        "mode": "2",
        "reg": ".N12345",
        "label": "SA",
        "flight": "AAL123",
        "msg_text": "POSITION REPORT..."
      }
    }
  }
}
```

## Integration Examples

### Relay to Your Service

```yaml
# docker-compose.yaml
services:
  acarshub-mock:
    build: .
    environment:
      - RELAY_HOST=my-acars-processor
      - RELAY_PORT=5000
      - RELAY_PROTOCOL=udp

  my-acars-processor:
    image: your-image
    ports:
      - "5000:5000/udp"
```

### Receive via TCP

```python
import socket
import json

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(('localhost', 15550))  # ACARS relay port

while True:
    data = sock.recv(4096)
    if data:
        for line in data.decode().strip().split('\n'):
            msg = json.loads(line)
            print(f"Received: {msg['flight']} - {msg['text']}")
```

### Receive via WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('Received:', msg);
};
```

### Using the Receiver Script

```bash
# TCP mode (connects to relay port)
python receiver.py --mode tcp --host localhost --port 15550

# UDP mode (listens for direct messages)
python receiver.py --mode udp --port 5000

# WebSocket mode
python receiver.py --mode websocket --host localhost --port 8080
```

## Development

### Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run with debug logging
MOCK_ENABLED=true python app.py
```

### Build Multi-Arch Docker Image

```bash
# Create builder
docker buildx create --name multiarch --use

# Build for both architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry/acarshub-mock:latest \
  --push .
```

## Use Cases

1. **Testing ACARS Processing Pipelines**: Generate realistic traffic without needing SDR hardware
2. **Development**: Build and test ACARS-consuming applications locally
3. **Load Testing**: Generate high volumes of messages to test system performance
4. **Demonstrations**: Show ACARS data flow without needing live aircraft traffic
5. **CI/CD**: Automated testing of ACARS processing systems

## License

MIT License - See LICENSE file for details.

## Related Projects

- [sdr-enthusiasts/docker-acarshub](https://github.com/sdr-enthusiasts/docker-acarshub) - The real ACARSHUB
- [sdr-enthusiasts/docker-acarsdec](https://github.com/sdr-enthusiasts/docker-acarsdec) - ACARS decoder
- [szpajder/dumpvdl2](https://github.com/szpajder/dumpvdl2) - VDL2 decoder
