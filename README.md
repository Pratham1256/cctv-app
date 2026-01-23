# Live CCTV Stream App

A real-time camera streaming web application built with Flask, WebRTC, and Socket.IO.

## Features

- 📹 Live camera streaming from any device with a webcam
- 🌐 Multiple concurrent streams supported
- 👥 Multiple viewers per stream
- 🎯 Automatic random camera naming
- 🔴 Real-time viewer count
- 📱 Responsive design

## Tech Stack

- **Backend**: Flask, Flask-SocketIO
- **Frontend**: HTML, CSS, JavaScript, Jinja2
- **Streaming**: WebRTC for peer-to-peer video
- **Real-time Communication**: Socket.IO

## Local Development

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python app.py
```

3. Open browser and navigate to `http://localhost:5000`

## How It Works

1. **Home Page** (`/`): Shows all active camera streams
2. **Stream Page** (`/stream`): Start broadcasting from your webcam
3. **View Page** (`/camera/<id>`): Watch a specific camera stream

## Deployment on Render

See deployment instructions below.

## Notes

- HTTPS is required for webcam access in production
- Uses STUN servers for NAT traversal
- In-memory storage (cameras cleared on restart)