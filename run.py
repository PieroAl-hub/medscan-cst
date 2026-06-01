#!/usr/bin/env python3
"""
Run MedScan Pro en modo desarrollo.
Inicia backend FastAPI y opcionalmente frontend Vite.

Uso:
    python run.py             # Solo backend
    python run.py --dev       # Backend + Frontend dev
"""
import sys
import subprocess
import threading
import webbrowser
import time

BACKEND_PORT = 8000


def start_backend():
    subprocess.run(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(BACKEND_PORT), "--reload"],
        cwd="backend"
    )


def start_frontend():
    subprocess.run(["npm", "run", "dev"], cwd="frontend")


if __name__ == "__main__":
    dev_mode = "--dev" in sys.argv

    if dev_mode:
        t = threading.Thread(target=start_frontend, daemon=True)
        t.start()
        time.sleep(1)

    print(f"Backend: http://127.0.0.1:{BACKEND_PORT}")
    if dev_mode:
        print(f"Frontend: http://localhost:5173")
        webbrowser.open("http://localhost:5173")
    else:
        print(f"API docs: http://127.0.0.1:{BACKEND_PORT}/docs")

    start_backend()
