#!/usr/bin/env python3
"""
Simple script to run the Point Cloud Viewer application
"""
import uvicorn

if __name__ == "__main__":
    print("Starting Point Cloud Viewer...")
    print("Open http://localhost:8000 in your browser")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)