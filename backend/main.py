import os
import sys
import csv
import io
import socket
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from ocr_engine import extract_from_pdf
from security import sanitize_filename, validate_pdf_path, is_valid_pdf, sanitize_patient_name
from database import init_db, create_history_entry, update_history_entry, get_all_history, get_history_entry, delete_history_entry

from contextlib import asynccontextmanager


limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except socket.gaierror:
        local_ip = "0.0.0.0"
    print(f"\n  ┌─ MedScan CST ─────────────────────────────┐")
    print(f"  │  Local:   http://127.0.0.1:{PORT}               │")
    print(f"  │  Red:     http://{local_ip}:{PORT}               │")
    print(f"  │  Historial: SQLite ({Path('medscan.db').resolve()})  │")
    print(f"  └────────────────────────────────────────────┘\n")
    yield


app = FastAPI(title="MedScan CST - Hospital Santa Teresa", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HOST = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"

UPLOAD_DIR = Path("uploads").resolve()
UPLOAD_DIR.mkdir(exist_ok=True)

STATIC_DIR = Path(__file__).parent.resolve() / "static"

if STATIC_DIR.exists():
    from fastapi.responses import HTMLResponse
    @app.exception_handler(StarletteHTTPException)
    async def not_found_handler(request, exc):
        if exc.status_code == 404:
            index = STATIC_DIR / "index.html"
            if index.exists():
                return HTMLResponse(index.read_text(), media_type="text/html")
        raise exc

    from fastapi.staticfiles import StaticFiles
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


# ─── Middleware ────────────────────────────────────────────
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; script-src 'self'; img-src 'self' data:"
    response.headers["Cache-Control"] = "no-store"
    return response


# ─── Health ───────────────────────────────────────────────

@app.get("/api/health")
@limiter.limit("30/minute")
async def health(request: Request):
    ocr_ok = False
    try:
        import pytesseract
        v = pytesseract.get_tesseract_version()
        langs = pytesseract.get_languages()
        ocr_ok = 'spa' in langs
        ocr_info = {"version": str(v), "langs": langs, "spa_ok": ocr_ok}
    except Exception as e:
        ocr_info = {"error": str(e)}
    return {"status": "ok", "tesseract": ocr_info}


# ─── Upload ───────────────────────────────────────────────

@app.post("/api/upload")
@limiter.limit("10/minute")
async def upload_files(request: Request, files: list[UploadFile] = File(...)):
    pdfs = [f for f in files if f.filename.lower().endswith('.pdf')]
    if not pdfs:
        raise HTTPException(400, "No se subieron archivos PDF")
    if len(pdfs) > 500:
        raise HTTPException(413, "Máximo 500 PDFs por lote")

    saved = []
    for f in pdfs:
        safe_name = sanitize_filename(f.filename)
        path = UPLOAD_DIR / safe_name
        content = await f.read()
        if len(content) > 100 * 1024 * 1024:
            raise HTTPException(413, f"PDF excede 100MB: {f.filename}")
        with open(path, "wb") as dst:
            dst.write(content)
        if not is_valid_pdf(str(path)):
            path.unlink(missing_ok=True)
            raise HTTPException(400, f"Archivo no es un PDF válido: {f.filename}")
        saved.append(str(path))

    return {"message": f"OK {len(saved)} PDFs", "pdfs": saved}


# ─── WebSocket: process ───────────────────────────────────

@app.websocket("/ws/process")
async def websocket_process(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        pdf_paths = data.get("pdfs", [])

        total = len(pdf_paths)
        await websocket.send_json({"type": "start", "total": total})

        for i, path in enumerate(pdf_paths):
            try:
                valid_path = validate_pdf_path(path, UPLOAD_DIR)
            except (ValueError, FileNotFoundError) as e:
                await websocket.send_json({
                    "type": "progress",
                    "current": i + 1, "total": total,
                    "archivo": os.path.basename(path),
                    "paciente": "", "codigo": "", "anio": "",
                    "error": str(e),
                })
                continue

            result = extract_from_pdf(valid_path)
            result["paciente"] = sanitize_patient_name(result.get("paciente", ""))
            await websocket.send_json({
                "type": "progress",
                "current": i + 1, "total": total,
                "archivo": result["archivo"],
                "paciente": result["paciente"],
                "codigo": result.get("codigo", ""),
                "anio": result.get("anio", ""),
                "error": result.get("error", ""),
            })

        await websocket.send_json({"type": "done", "results": []})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})


# ─── Process (REST fallback) ──────────────────────────────

@app.post("/api/process")
@limiter.limit("10/minute")
async def process_pdfs(request: Request, data: dict):
    pdf_paths = data.get("pdfs", [])
    if not pdf_paths:
        raise HTTPException(400, "No hay PDFs para procesar")
    if len(pdf_paths) > 500:
        raise HTTPException(413, "Máximo 500 PDFs por lote")

    validated = []
    for path in pdf_paths:
        try:
            validated.append(validate_pdf_path(path, UPLOAD_DIR))
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(400, str(e))

    from ocr_engine import process_pdfs_parallel
    results = process_pdfs_parallel(validated)
    for r in results:
        r["paciente"] = sanitize_patient_name(r.get("paciente", ""))
    return {"results": results}


# ─── Rename ───────────────────────────────────────────────

@app.post("/api/rename")
@limiter.limit("10/minute")
async def rename_pdfs(request: Request, data: dict):
    results = data.get("results", [])
    renamed = []

    for r in results:
        old_path = r.get("ruta", "")
        try:
            valid_old = validate_pdf_path(old_path, UPLOAD_DIR)
        except (ValueError, FileNotFoundError):
            renamed.append({"archivo": os.path.basename(old_path), "status": "skipped", "reason": "Path inválido"})
            continue

        paciente = sanitize_patient_name(r.get("paciente", ""))
        codigo = sanitize_filename(r.get("codigo", ""))
        anio = r.get("anio", "").strip()

        if not paciente or not codigo or not anio:
            renamed.append({"archivo": os.path.basename(old_path), "status": "skipped", "reason": "Datos incompletos"})
            continue

        if not anio.isdigit() or len(anio) != 4:
            renamed.append({"archivo": os.path.basename(old_path), "status": "skipped", "reason": "Año inválido"})
            continue

        dir_name = os.path.dirname(valid_old)
        new_name = f"{paciente} {codigo} {anio}.pdf"
        new_path = os.path.join(dir_name, new_name)

        if os.path.exists(new_path):
            renamed.append({"archivo_original": os.path.basename(old_path), "status": "skipped", "reason": "Ya existe"})
            continue

        try:
            os.rename(valid_old, new_path)
            renamed.append({"archivo_original": os.path.basename(old_path), "archivo_nuevo": new_name, "status": "ok"})
        except Exception as e:
            renamed.append({"archivo": os.path.basename(old_path), "status": "error", "reason": str(e)})

    return {"renamed": renamed}


# ─── Export ───────────────────────────────────────────────

@app.post("/api/export")
@limiter.limit("10/minute")
async def export_results(request: Request, data: dict):
    results = data.get("results", [])
    fmt = data.get("format", "csv")

    if fmt not in ("csv", "txt"):
        raise HTTPException(400, "Formato no soportado")

    output = io.StringIO()
    if fmt == "csv":
        writer = csv.writer(output)
        writer.writerow(["Archivo", "Paciente", "Codigo", "Anio", "Error"])
        for r in results:
            writer.writerow([
                sanitize_filename(r.get("archivo", "")),
                sanitize_patient_name(r.get("paciente", "")),
                sanitize_filename(r.get("codigo", "")),
                r.get("anio", ""),
                r.get("error", ""),
            ])
        content = output.getvalue().encode("utf-8-sig")
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=resultados.csv"}
        )

    output.write("RESULTADOS MEDSCAN CST - HOSPITAL SANTA TERESA\n")
    output.write(f"Exportado: {datetime.now().isoformat()}\n")
    output.write("=" * 60 + "\n\n")
    for r in results:
        output.write(f"{sanitize_filename(r.get('archivo',''))}\n")
        output.write(f"  Paciente: {sanitize_patient_name(r.get('paciente',''))}\n")
        output.write(f"  Codigo:   {sanitize_filename(r.get('codigo',''))}\n")
        output.write(f"  Anio:     {r.get('anio','')}\n")
        if r.get('error'):
            output.write(f"  Error:    {r.get('error')}\n")
        output.write("\n")
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=resultados.txt"}
    )


# ─── History ──────────────────────────────────────────────

@app.get("/api/history")
@limiter.limit("30/minute")
async def list_history(request: Request):
    return get_all_history()


@app.get("/api/history/{entry_id}")
@limiter.limit("30/minute")
async def get_history(request: Request, entry_id: int):
    entry = get_history_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    return entry


@app.post("/api/history")
@limiter.limit("20/minute")
async def create_history(request: Request, data: dict):
    project_name = data.get("project_name", "")
    folder_path = data.get("folder_path", "")
    folder_name = data.get("folder_name", "")
    total_files = data.get("total_files", 0)
    entry_id = create_history_entry(project_name, folder_path, folder_name, total_files)
    return {"id": entry_id, "status": "created"}


@app.put("/api/history/{entry_id}")
@limiter.limit("20/minute")
async def update_history(request: Request, entry_id: int, data: dict):
    entry = get_history_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    update_history_entry(
        entry_id,
        ok_count=data.get("ok_count", 0),
        warn_count=data.get("warn_count", 0),
        error_count=data.get("error_count", 0),
        status=data.get("status", "completed"),
        details=data.get("details"),
    )
    return {"id": entry_id, "status": "updated"}


@app.delete("/api/history/{entry_id}")
@limiter.limit("20/minute")
async def delete_history(request: Request, entry_id: int):
    entry = get_history_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    delete_history_entry(entry_id)
    return {"id": entry_id, "status": "deleted"}


# ─── Main ─────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
