# NetGuard

A comprehensive network monitoring and security application for Windows.

> **Warning**: This project is currently in active development and is **not production ready**. Features may be incomplete, unstable, or subject to change. Use at your own risk.

## Overview

NetGuard provides real-time network traffic monitoring, device detection, firewall management, and security alerts for Windows systems. It combines a modern React-based UI with a Go backend that interfaces directly with Windows native APIs.

## Features

### Network Monitoring
- Real-time traffic statistics (upload/download speeds)
- Active network connections with process information
- Per-application bandwidth usage tracking
- Traffic history with multiple time ranges (1h, 24h, 7d, 30d)

### Connection Management
- View and filter active connections (established, listening, etc.)
- Kill active connections
- Block specific IP:port combinations
- Geographic mapping of connections via GeoIP

### Firewall Management
- Windows Firewall integration
- View, enable, and disable firewall rules
- Block or allow specific applications
- Filter by direction (inbound/outbound) and action

### Network Device Discovery
- Scan local network for devices
- Track device online/offline status
- Custom device naming and vendor identification
- Port scanning capabilities

### Security Features
- Real-time alert system for security events
- New application and device detection
- Evil twin WiFi detection
- RDP session monitoring
- Customizable notifications

### User Interface
- Dark theme with accent color customization
- Interactive world map of connections
- Animated transitions with Framer Motion
- Mini floating widget for quick stats

## Tech Stack

### Frontend
- React 18 with TypeScript
- Zustand (state management)
- Tailwind CSS (styling)
- Recharts (charts)
- Leaflet (maps)
- Framer Motion (animations)
- Vite (build tool)

### Desktop
- Electron 33

### Backend
- Go 1.21
- SQLite (data persistence)
- Windows native APIs (iphlpapi, wlanapi, wtsapi32)

## Prerequisites

- Windows 10 or later
- Node.js (v18 or later recommended)
- npm
- Go 1.21+ (for backend development)
- Administrator privileges (required for network monitoring)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd GlassWire

# Install dependencies
npm install
```

### Building the Go Backend (Optional)

A pre-compiled backend binary is included. To rebuild:

```bash
cd backend
go build -o netguard-backend.exe
cd ..
```

## Usage

### Development Mode

```bash
npm run electron:dev
```

This starts the Vite dev server with hot reload and launches the Electron app. The Go backend will be started with admin elevation.

### Production Build

```bash
npm run electron:build
```

This compiles TypeScript, builds the React app, and packages the Electron application as a Windows installer.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server only |
| `npm run build` | Full production build |
| `npm run preview` | Preview production build |
| `npm run electron:dev` | Development with Electron |
| `npm run electron:build` | Production build with packaging |

## Project Structure

```
GlassWire/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   ├── pages/              # Page components
│   ├── store/              # Zustand state stores
│   └── styles/             # Global CSS
├── electron/               # Electron main process
│   ├── services/           # Backend services
│   └── utils/              # Utility functions
├── backend/                # Go backend
├── public/                 # Static assets
└── dist/                   # Build output
```

## Architecture

The application follows a three-tier architecture:

1. **Frontend (React)**: Handles UI rendering and user interactions
2. **Electron Main Process**: Manages windows, IPC communication, and service orchestration
3. **Go Backend**: Interfaces with Windows APIs for network monitoring, running on port 8899

Data flows from the Go backend through Electron's IPC bridge to the React frontend, with Zustand managing application state.

## Configuration

The application stores configuration in a local SQLite database. Settings can be modified through the Settings page in the application.

## Security Notes

- The Go backend requires administrator privileges to access network statistics
- Context isolation is enabled in Electron for security
- All IPC communication goes through a secure preload bridge

## Known Limitations

- Windows only (no macOS or Linux support)
- Requires administrator privileges for full functionality
- GeoIP lookups use external API (ip-api.com) with rate limiting

## Contributing

Contributions are welcome. Please note that this project is in early development, and the API and architecture may change significantly.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Disclaimer

This software is provided as-is for educational and development purposes. The developers are not responsible for any misuse or damage caused by this application. Always ensure you have proper authorization before monitoring network traffic.
