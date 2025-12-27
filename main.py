from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn
import json
import struct
import os
import math
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional

app = FastAPI(title="Point Cloud Viewer", version="1.0.0")

# Global configuration
config = {
    "mode": "upload",  # "upload" or "potree"
    "potree_path": None,
    "potree_name": None
}

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Store uploaded point clouds in memory (in production, use a database)
point_clouds: Dict[str, Dict[str, Any]] = {}

def parse_ply_file(content: bytes) -> Dict[str, Any]:
    """Parse PLY file and extract vertex data (supports both ASCII and binary formats)"""
    # Find header end
    header_end = content.find(b'end_header\n')
    if header_end == -1:
        header_end = content.find(b'end_header\r\n')
        if header_end == -1:
            raise ValueError("Invalid PLY file: no end_header found")
        header_end += 11  # length of 'end_header\r\n'
    else:
        header_end += 11  # length of 'end_header\n'
    
    # Parse header
    try:
        header = content[:header_end].decode('utf-8')
    except UnicodeDecodeError:
        header = content[:header_end].decode('latin-1')
    
    lines = header.split('\n')
    
    vertex_count = 0
    properties = []
    is_ascii = True
    is_little_endian = True
    
    for line in lines:
        line = line.strip()
        if line.startswith('format'):
            parts = line.split()
            if len(parts) >= 2:
                if 'binary_little_endian' in line:
                    is_ascii = False
                    is_little_endian = True
                elif 'binary_big_endian' in line:
                    is_ascii = False
                    is_little_endian = False
                elif 'ascii' in line:
                    is_ascii = True
        elif line.startswith('element vertex'):
            vertex_count = int(line.split()[-1])
        elif line.startswith('property'):
            parts = line.split()
            if len(parts) >= 3 and not line.startswith('property list'):
                prop_type = parts[1]
                prop_name = parts[2]
                properties.append((prop_name, prop_type))
    
    if vertex_count == 0:
        raise ValueError("No vertices found in PLY file")
    
    if is_ascii:
        return parse_ascii_ply(content[header_end:].decode('utf-8'), vertex_count, properties)
    else:
        return parse_binary_ply(content[header_end:], vertex_count, properties, is_little_endian)

def parse_ascii_ply(data: str, vertex_count: int, properties: List[tuple]) -> Dict[str, Any]:
    """Parse ASCII PLY vertex data"""
    lines = data.split('\n')
    
    # Find property indices
    x_idx = y_idx = z_idx = -1
    r_idx = g_idx = b_idx = -1
    
    for idx, (prop_name, prop_type) in enumerate(properties):
        if prop_name == 'x':
            x_idx = idx
        elif prop_name == 'y':
            y_idx = idx
        elif prop_name == 'z':
            z_idx = idx
        elif prop_name in ['red', 'r']:
            r_idx = idx
        elif prop_name in ['green', 'g']:
            g_idx = idx
        elif prop_name in ['blue', 'b']:
            b_idx = idx
    
    print(f"Property indices: x={x_idx}, y={y_idx}, z={z_idx}, r={r_idx}, g={g_idx}, b={b_idx}")
    print(f"Total properties: {len(properties)}")
    if len(properties) > 0:
        print(f"Properties: {[name for name, _ in properties]}")
    
    if x_idx == -1 or y_idx == -1 or z_idx == -1:
        raise ValueError("PLY file must contain x, y, z coordinates")
    
    # Parse vertex data
    vertices = []
    colors = []
    has_colors = r_idx != -1 and g_idx != -1 and b_idx != -1
    
    for i in range(min(vertex_count, len(lines))):
        line = lines[i].strip()
        if not line:
            continue
            
        values = line.split()
        if len(values) < len(properties):
            continue
            
        try:
            # Extract x, y, z coordinates
            x = float(values[x_idx])
            y = float(values[y_idx])
            z = float(values[z_idx])
            
            # Check for invalid values
            if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                continue
                
            vertices.extend([x, y, z])
            
            # Extract colors if available
            if has_colors:
                r = float(values[r_idx])
                g = float(values[g_idx])
                b = float(values[b_idx])
                
                # Check for invalid color values
                if not (math.isfinite(r) and math.isfinite(g) and math.isfinite(b)):
                    r, g, b = 0.7, 0.8, 1.0  # Default to light blue
                else:
                    # Normalize colors to 0-1 range if they're in 0-255 range
                    if r > 1.0 or g > 1.0 or b > 1.0:
                        r, g, b = r/255.0, g/255.0, b/255.0
                    # Clamp colors to valid range
                    r = max(0.0, min(1.0, r))
                    g = max(0.0, min(1.0, g))
                    b = max(0.0, min(1.0, b))
                
                colors.extend([r, g, b])
            else:
                # Default color (light blue)
                colors.extend([0.7, 0.8, 1.0])
                
        except (ValueError, IndexError) as e:
            continue
    
    if len(vertices) == 0:
        raise ValueError("No valid vertices found in PLY file")
    
    # Filter out extreme values and normalize coordinates
    filtered_data = filter_and_normalize_vertices(vertices, colors)
    
    return {
        "vertices": filtered_data["vertices"],
        "colors": filtered_data["colors"],
        "vertex_count": filtered_data["vertex_count"]
    }

def filter_and_normalize_vertices(vertices: List[float], colors: List[float]) -> Dict[str, Any]:
    """Filter out extreme values and normalize coordinates for better rendering"""
    if len(vertices) == 0:
        return {"vertices": [], "colors": [], "vertex_count": 0}
    
    # Define reasonable coordinate limits (adjust based on your data)
    MAX_COORD = 250  # Filter out coordinates larger than this
    
    print(f"Filtering vertices with coordinates outside +/- {MAX_COORD}")
    
    filtered_vertices = []
    filtered_colors = []
    
    # Filter vertices with extreme coordinates
    for i in range(0, len(vertices), 3):
        x, y, z = vertices[i], vertices[i+1], vertices[i+2]
        
        # Check if coordinates are within reasonable bounds
        if (abs(x) < MAX_COORD and abs(y) < MAX_COORD and abs(z) < MAX_COORD):
            filtered_vertices.extend([x, y, z])
            # Copy corresponding colors
            if i < len(colors):
                filtered_colors.extend(colors[i:i+3])
            else:
                filtered_colors.extend([0.7, 0.8, 1.0])  # Default color
    
    if len(filtered_vertices) == 0:
        raise ValueError("No vertices within reasonable coordinate bounds")
    
    # Calculate bounding box of filtered vertices
    x_coords = [filtered_vertices[i] for i in range(0, len(filtered_vertices), 3)]
    y_coords = [filtered_vertices[i] for i in range(1, len(filtered_vertices), 3)]
    z_coords = [filtered_vertices[i] for i in range(2, len(filtered_vertices), 3)]
    
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    min_z, max_z = min(z_coords), max(z_coords)
    
    # Calculate center and scale
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    center_z = (min_z + max_z) / 2
    
    # Calculate scale factor to fit in a reasonable range (e.g., -10 to 10)
    max_extent = max(max_x - min_x, max_y - min_y, max_z - min_z)
    scale_factor = 10.0 / max_extent if max_extent > 0 else 1.0
    
    # Normalize coordinates
    normalized_vertices = []
    for i in range(0, len(filtered_vertices), 3):
        x = (filtered_vertices[i] - center_x) * scale_factor
        y = (filtered_vertices[i+1] - center_y) * scale_factor
        z = (filtered_vertices[i+2] - center_z) * scale_factor
        normalized_vertices.extend([x, y, z])
    
    print(f"Filtered {len(filtered_vertices)//3} vertices from {len(vertices)//3}")
    print(f"Normalized coordinates to range approximately -10 to 10")
    
    if len(filtered_vertices) == 0:
        print("No vertices passed the filter - all coordinates were outside the acceptable range")
        # Show some sample coordinates from the original data
        print("Sample original coordinates:")
        for i in range(0, min(15, len(vertices)), 3):
            x, y, z = vertices[i], vertices[i+1], vertices[i+2]
            print(f"  Vertex {i//3}: ({x}, {y}, {z})")
        raise ValueError("No vertices within reasonable coordinate bounds")
    
    return {
        "vertices": normalized_vertices,
        "colors": filtered_colors,
        "vertex_count": len(normalized_vertices) // 3
    }

def parse_binary_ply(data: bytes, vertex_count: int, properties: List[tuple], is_little_endian: bool) -> Dict[str, Any]:
    """Parse binary PLY vertex data"""
    # Map PLY types to struct format codes
    type_map = {
        'float': 'f',
        'double': 'd', 
        'int': 'i',
        'uint': 'I',
        'short': 'h',
        'ushort': 'H',
        'char': 'b',
        'uchar': 'B',
        'int8': 'b',
        'uint8': 'B',
        'int16': 'h',
        'uint16': 'H',
        'int32': 'i',
        'uint32': 'I',
        'float32': 'f',
        'float64': 'd'
    }
    
    # Build struct format string
    endian_char = '<' if is_little_endian else '>'
    format_chars = []
    prop_info = []
    
    for prop_name, prop_type in properties:
        if prop_type in type_map:
            format_chars.append(type_map[prop_type])
            prop_info.append((prop_name, prop_type))
        else:
            raise ValueError(f"Unsupported property type: {prop_type}")
    
    struct_format = endian_char + ''.join(format_chars)
    vertex_size = struct.calcsize(struct_format)
    
    # Find property indices
    x_idx = y_idx = z_idx = -1
    r_idx = g_idx = b_idx = -1
    
    for idx, (prop_name, prop_type) in enumerate(prop_info):
        if prop_name == 'x':
            x_idx = idx
        elif prop_name == 'y':
            y_idx = idx
        elif prop_name == 'z':
            z_idx = idx
        elif prop_name in ['red', 'r']:
            r_idx = idx
        elif prop_name in ['green', 'g']:
            g_idx = idx
        elif prop_name in ['blue', 'b']:
            b_idx = idx
    
    if x_idx == -1 or y_idx == -1 or z_idx == -1:
        raise ValueError("PLY file must contain x, y, z coordinates")
    
    # Parse vertex data
    vertices = []
    colors = []
    has_colors = r_idx != -1 and g_idx != -1 and b_idx != -1
    
    for i in range(vertex_count):
        offset = i * vertex_size
        if offset + vertex_size > len(data):
            break
            
        try:
            vertex_data = struct.unpack(struct_format, data[offset:offset + vertex_size])
            
            # Extract x, y, z coordinates
            x = float(vertex_data[x_idx])
            y = float(vertex_data[y_idx])
            z = float(vertex_data[z_idx])
            
            # Check for invalid values
            if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                continue
                
            vertices.extend([x, y, z])
            
            # Extract colors if available
            if has_colors:
                r = float(vertex_data[r_idx])
                g = float(vertex_data[g_idx])
                b = float(vertex_data[b_idx])
                
                # Check for invalid color values
                if not (math.isfinite(r) and math.isfinite(g) and math.isfinite(b)):
                    r, g, b = 0.7, 0.8, 1.0  # Default to light blue
                else:
                    # Normalize colors to 0-1 range if they're in 0-255 range
                    if r > 1.0 or g > 1.0 or b > 1.0:
                        r, g, b = r/255.0, g/255.0, b/255.0
                    # Clamp colors to valid range
                    r = max(0.0, min(1.0, r))
                    g = max(0.0, min(1.0, g))
                    b = max(0.0, min(1.0, b))
                
                colors.extend([r, g, b])
            else:
                # Default color (light blue)
                colors.extend([0.7, 0.8, 1.0])
                
        except struct.error as e:
            continue
        except (ValueError, IndexError) as e:
            continue
    
    if len(vertices) == 0:
        raise ValueError("No valid vertices found in PLY file")
    
    # Filter out extreme values and normalize coordinates
    filtered_data = filter_and_normalize_vertices(vertices, colors)
    
    return {
        "vertices": filtered_data["vertices"],
        "colors": filtered_data["colors"],
        "vertex_count": filtered_data["vertex_count"]
    }

@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page"""
    with open("static/index.html", "r") as f:
        return HTMLResponse(content=f.read())

@app.post("/upload")
async def upload_point_cloud(file: UploadFile = File(...)):
    """Upload and parse a PLY point cloud file"""
    if not file.filename.lower().endswith('.ply'):
        raise HTTPException(status_code=400, detail="Only PLY files are supported")
    
    try:
        content = await file.read()
        print(f"File size: {len(content)} bytes")
        
        point_cloud_data = parse_ply_file(content)
        print(f"Parsed {point_cloud_data['vertex_count']} vertices")
        
        if point_cloud_data['vertex_count'] > 0:
            # Print some sample vertices for debugging
            vertices = point_cloud_data['vertices']
            print(f"First vertex: {vertices[0:3]}")
            if len(vertices) >= 6:
                print(f"Second vertex: {vertices[3:6]}")
            
            # Print bounding box info
            x_coords = [vertices[i] for i in range(0, len(vertices), 3)]
            y_coords = [vertices[i] for i in range(1, len(vertices), 3)]
            z_coords = [vertices[i] for i in range(2, len(vertices), 3)]
            
            print(f"X range: {min(x_coords)} to {max(x_coords)}")
            print(f"Y range: {min(y_coords)} to {max(y_coords)}")
            print(f"Z range: {min(z_coords)} to {max(z_coords)}")
        
        # Store the point cloud data
        file_id = file.filename
        point_clouds[file_id] = point_cloud_data
        
        return {
            "message": "Point cloud uploaded successfully",
            "file_id": file_id,
            "vertex_count": point_cloud_data["vertex_count"]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PLY file: {str(e)}")

@app.get("/pointcloud/{file_id}")
async def get_point_cloud(file_id: str):
    """Retrieve point cloud data by file ID"""
    if file_id not in point_clouds:
        raise HTTPException(status_code=404, detail="Point cloud not found")
    
    return point_clouds[file_id]

@app.get("/pointclouds")
async def list_point_clouds():
    """List all uploaded point clouds"""
    return {
        "point_clouds": [
            {"file_id": file_id, "vertex_count": data["vertex_count"]}
            for file_id, data in point_clouds.items()
        ]
    }

@app.get("/api/config")
async def get_config():
    """Get application configuration"""
    return {
        "mode": config["mode"],
        "potree_name": config["potree_name"],
        "potree_path": config["potree_path"]
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Point Cloud Viewer")
    parser.add_argument("--potree", type=str, help="Path to Potree directory (enables potree mode)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    args = parser.parse_args()

    # Configure potree mode if path is provided
    if args.potree:
        potree_path = Path(args.potree)
        if not potree_path.exists():
            print(f"Error: Potree directory not found: {potree_path}")
            exit(1)

        # Check for required files (support both Potree 1.x and 2.x formats)
        cloud_js = potree_path / "cloud.js"  # Potree 1.x
        metadata_json = potree_path / "pointclouds" / "index" / "metadata.json"  # Potree 2.x

        if cloud_js.exists():
            print(f"  Format: Potree 1.x (cloud.js)")
        elif metadata_json.exists():
            print(f"  Format: Potree 2.x (metadata.json)")
        else:
            print(f"Error: No Potree files found in {potree_path}")
            print(f"  Looked for: cloud.js (1.x) or pointclouds/index/metadata.json (2.x)")
            exit(1)

        config["mode"] = "potree"
        config["potree_path"] = str(potree_path.absolute())
        config["potree_name"] = potree_path.name

        # Mount the Potree directory
        app.mount("/potree", StaticFiles(directory=str(potree_path)), name="potree")

        print(f"✓ Potree mode enabled")
        print(f"  Directory: {config['potree_path']}")
        print(f"  Name: {config['potree_name']}")
    else:
        print(f"✓ Upload mode enabled")
        print(f"  Users can upload PLY files")

    print(f"\nStarting server on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)