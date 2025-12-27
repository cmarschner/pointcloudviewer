#!/usr/bin/env python3
"""
Convert E57 file to LAS format using pye57 library.
LAS format is more widely supported and can then be converted to Potree.
"""

import pye57
import laspy
import numpy as np
import sys
from pathlib import Path

def convert_e57_to_las(e57_path, las_path):
    """Convert E57 to LAS format"""
    print(f"Opening E57 file: {e57_path}")
    e57 = pye57.E57(e57_path)

    print(f"Number of scans in E57: {e57.scan_count}")

    # We'll merge all scans into one LAS file
    all_points = []
    all_colors = []

    for scan_index in range(e57.scan_count):
        print(f"\nReading scan {scan_index + 1}/{e57.scan_count}...")

        try:
            data = e57.read_scan(scan_index, colors=True)

            # Get coordinates
            x = data["cartesianX"]
            y = data["cartesianY"]
            z = data["cartesianZ"]

            points = np.column_stack((x, y, z))
            all_points.append(points)

            print(f"  Points: {len(x):,}")

            # Get colors if available
            if "colorRed" in data and "colorGreen" in data and "colorBlue" in data:
                r = data["colorRed"]
                g = data["colorGreen"]
                b = data["colorBlue"]
                colors = np.column_stack((r, g, b))
                all_colors.append(colors)
                print(f"  Colors: Yes")
            else:
                # Create default white colors
                colors = np.ones((len(x), 3), dtype=np.uint16) * 65535
                all_colors.append(colors)
                print(f"  Colors: No (using white)")

        except Exception as e:
            print(f"  Warning: Could not read scan {scan_index}: {e}")
            continue

    if not all_points:
        print("Error: No points could be read from E57 file")
        return False

    # Merge all scans
    print("\nMerging all scans...")
    points = np.vstack(all_points)
    colors = np.vstack(all_colors)

    total_points = len(points)
    print(f"Total points: {total_points:,}")

    # Create LAS file
    print(f"\nCreating LAS file: {las_path}")

    # Create LAS header
    header = laspy.LasHeader(point_format=2, version="1.2")
    header.offsets = np.min(points, axis=0)
    header.scales = np.array([0.001, 0.001, 0.001])  # 1mm precision

    # Create LAS file
    las = laspy.LasData(header)

    # Set coordinates
    las.x = points[:, 0]
    las.y = points[:, 1]
    las.z = points[:, 2]

    # Set colors (LAS expects 16-bit RGB values)
    # If colors are 8-bit, scale them to 16-bit
    if colors.max() <= 255:
        colors = colors.astype(np.uint16) * 257  # Scale 0-255 to 0-65535

    las.red = colors[:, 0].astype(np.uint16)
    las.green = colors[:, 1].astype(np.uint16)
    las.blue = colors[:, 2].astype(np.uint16)

    # Write to file
    las.write(las_path)

    print(f"✓ LAS file created successfully")
    print(f"  File size: {Path(las_path).stat().st_size / (1024**3):.2f} GB")

    return True

def main():
    project_dir = Path(__file__).parent
    e57_file = project_dir / "Cloud_1.e57"
    las_file = project_dir / "Cloud_1.las"

    if not e57_file.exists():
        print(f"Error: E57 file not found: {e57_file}")
        return 1

    print("=" * 60)
    print("E57 to LAS Converter")
    print("=" * 60)
    print()

    success = convert_e57_to_las(str(e57_file), str(las_file))

    if success:
        print("\n" + "=" * 60)
        print("SUCCESS!")
        print("=" * 60)
        print(f"\nOutput: {las_file}")
        print("\nNext step:")
        print("Run: python3 convert_las_to_potree.py")
        return 0
    else:
        print("\n" + "=" * 60)
        print("FAILED")
        print("=" * 60)
        return 1

if __name__ == "__main__":
    sys.exit(main())
