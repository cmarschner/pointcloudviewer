# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based point cloud viewer application built with FastAPI backend and Three.js frontend. It allows users to upload PLY format point cloud files and visualize them with interactive 3D controls.

## Development Commands

### Setup
```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the development server
python run.py
# OR
python main.py
# OR
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Access the Application
- Open http://localhost:8000 in your browser
- The application serves both the API and the web interface

## Architecture

### Backend (FastAPI)
- `main.py`: FastAPI application with endpoints for file upload and point cloud data retrieval
- PLY file parser that extracts vertex coordinates and colors
- In-memory storage for uploaded point clouds (suitable for development)
- RESTful API endpoints:
  - `POST /upload`: Upload PLY files
  - `GET /pointcloud/{file_id}`: Retrieve point cloud data
  - `GET /pointclouds`: List all uploaded point clouds
  - `GET /`: Serve the main HTML interface

### Frontend (Three.js + WebGL)
- `static/index.html`: Single-page application with embedded JavaScript
- Three.js for 3D rendering and WebGL acceleration
- OrbitControls for camera manipulation (pan, zoom, rotate)
- Point cloud rendering with vertex colors
- File upload interface with drag-and-drop support
- Real-time point cloud switching

### Key Features
- PLY format support with automatic vertex and color parsing
- Interactive 3D visualization with orbit controls
- Multiple point cloud management
- Automatic centering and camera positioning
- Grid and axes helpers for spatial reference

## File Structure
```
├── main.py              # FastAPI backend application
├── run.py               # Simple runner script
├── requirements.txt     # Python dependencies
└── static/
    └── index.html       # Frontend application
```

## PLY File Format Support
The parser supports ASCII PLY files with:
- Vertex coordinates (x, y, z)
- RGB colors (optional)
- Automatic color normalization (0-255 → 0-1 range)