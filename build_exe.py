#!/usr/bin/env python3
"""
Build script for MedScan Pro.
Empaqueta backend + frontend en un solo .exe para Windows.

Uso:
    python build_exe.py

Requiere:
    pip install pyinstaller
    npm install (en frontend/)

Genera:
    dist/MedScanPro.exe
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
DIST = ROOT / "dist"
BUILD = ROOT / "build"


def build_frontend():
    """Build React frontend with Vite."""
    print("=== Building frontend ===")
    subprocess.run(["npm", "install"], cwd=FRONTEND, check=True)
    subprocess.run(["npm", "run", "build"], cwd=FRONTEND, check=True)
    print("Frontend built OK")


def build_backend():
    """Build backend with PyInstaller, including frontend static files."""
    print("=== Building backend .exe ===")
    
    frontend_dist = FRONTEND / "dist"
    if not frontend_dist.exists():
        print("ERROR: Frontend not built. Run build_frontend() first.")
        sys.exit(1)

    # Clean previous builds
    if DIST.exists():
        shutil.rmtree(DIST)
    if BUILD.exists():
        shutil.rmtree(BUILD)

    # Copy frontend build into backend for embedding
    static_dir = BACKEND / "static"
    if static_dir.exists():
        shutil.rmtree(static_dir)
    shutil.copytree(frontend_dist, static_dir)

    # PyInstaller command
    cmd = [
        "pyinstaller",
        "--noconfirm",
        "--onefile",
        "--windowed",
        "--name", "MedScanPro",
        "--add-data", f"{static_dir}{os.pathsep}static",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "cv2",
        "--hidden-import", "pytesseract",
        "--hidden-import", "fitz",
        "--icon", str(ROOT / "icon.ico") if (ROOT / "icon.ico").exists() else "",
        str(BACKEND / "main.py"),
    ]
    # Remove empty icon arg
    cmd = [c for c in cmd if c]

    subprocess.run(cmd, cwd=ROOT, check=True)
    print(f"Executable created: {DIST / 'MedScanPro.exe'}")


def clean():
    """Clean build artifacts."""
    for d in [BUILD, DIST]:
        if d.exists():
            shutil.rmtree(d)
    static = BACKEND / "static"
    if static.exists():
        shutil.rmtree(static)
    spec = ROOT / "MedScanPro.spec"
    if spec.exists():
        spec.unlink()


if __name__ == "__main__":
    if sys.platform == "win32":
        build_frontend()
        build_backend()
        print("\nDone! dist/MedScanPro.exe is ready.")
    else:
        print("Este script está diseñado para Windows (build de .exe)")
        print("En Linux/macOS solo se puede buildear el frontend.")
        build_frontend()
        print("\nFrontend built in frontend/dist/")
