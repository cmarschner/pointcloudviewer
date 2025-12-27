#!/usr/bin/env python3
"""
Convert LAS file to Potree format using Docker.
"""

import subprocess
import os
import sys
from pathlib import Path

def convert_las_to_potree(las_path, output_dir, project_dir):
    """Convert LAS to Potree format using Docker"""

    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Get absolute paths
    abs_las_path = os.path.abspath(las_path)
    abs_output_dir = os.path.abspath(output_dir)
    abs_project_dir = os.path.abspath(project_dir)

    # Docker command
    docker_cmd = [
        'docker', 'run',
        '--rm',
        '-v', f'{abs_project_dir}:/data',
        'synth3d/potreeconverter',
        'PotreeConverter',
        '-i', f'/data/{os.path.basename(las_path)}',
        '-o', f'/data/{os.path.basename(output_dir)}',
        '--output-attributes', 'RGB',
        '--overwrite',
    ]

    print(f"\nConverting LAS to Potree...")
    print(f"Input:  {abs_las_path}")
    print(f"Output: {abs_output_dir}")
    print(f"\nThis may take 5-15 minutes...\n")

    try:
        # Run conversion with real-time output
        process = subprocess.Popen(
            docker_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        # Print output in real-time
        for line in process.stdout:
            print(line, end='')

        process.wait()

        if process.returncode == 0:
            print("\n✓ Conversion completed successfully!")
            return True
        else:
            print(f"\n✗ Conversion failed with return code {process.returncode}")
            return False

    except Exception as e:
        print(f"\n✗ Conversion failed: {e}")
        return False

def verify_output(output_dir):
    """Verify that Potree files were created"""
    required_files = ['metadata.json', 'octree.bin', 'hierarchy.bin']

    print(f"\nVerifying output in {output_dir}...")

    all_exist = True
    for filename in required_files:
        filepath = os.path.join(output_dir, filename)
        if os.path.exists(filepath):
            size_mb = os.path.getsize(filepath) / (1024**2)
            print(f"  ✓ {filename} ({size_mb:.2f} MB)")
        else:
            print(f"  ✗ {filename} not found")
            all_exist = False

    return all_exist

def main():
    project_dir = Path(__file__).parent
    las_file = project_dir / "Cloud_1.las"
    output_dir = project_dir / "KP_Giesing_Potree"

    if not las_file.exists():
        print(f"Error: LAS file not found: {las_file}")
        print("Please run convert_e57_to_las.py first")
        return 1

    print("=" * 60)
    print("LAS to Potree Converter")
    print("=" * 60)

    if convert_las_to_potree(las_file, output_dir, project_dir):
        if verify_output(output_dir):
            print("\n" + "=" * 60)
            print("SUCCESS! Potree files ready to use.")
            print("=" * 60)
            print(f"\nOutput directory: {output_dir}")
            print("\nNext steps:")
            print("1. Run: python run.py --potree KP_Giesing_Potree")
            print("2. Open: http://localhost:8000")
            return 0
        else:
            return 1
    else:
        return 1

if __name__ == "__main__":
    sys.exit(main())
