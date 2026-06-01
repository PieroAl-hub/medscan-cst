import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "medscan.db"


def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS processing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name TEXT NOT NULL DEFAULT '',
            folder_path TEXT NOT NULL DEFAULT '',
            folder_name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            total_files INTEGER NOT NULL DEFAULT 0,
            ok_count INTEGER NOT NULL DEFAULT 0,
            warn_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'processing',
            details TEXT NOT NULL DEFAULT '[]'
        )
    """)
    try:
        conn.execute("ALTER TABLE processing_history ADD COLUMN details TEXT NOT NULL DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()


def create_history_entry(project_name: str = "", folder_path: str = "", folder_name: str = "",
                          total_files: int = 0) -> int:
    conn = get_conn()
    now = datetime.now().isoformat()
    cur = conn.execute(
        "INSERT INTO processing_history "
        "(project_name, folder_path, folder_name, created_at, total_files, status) "
        "VALUES (?, ?, ?, ?, ?, 'processing')",
        (project_name, folder_path, folder_name, now, total_files)
    )
    conn.commit()
    entry_id = cur.lastrowid
    conn.close()
    return entry_id


def update_history_entry(entry_id: int, ok_count: int = 0, warn_count: int = 0,
                          error_count: int = 0, status: str = "completed",
                          details: list | None = None):
    conn = get_conn()
    conn.execute(
        "UPDATE processing_history SET ok_count=?, warn_count=?, error_count=?, "
        "status=?, completed_at=?, details=? WHERE id=?",
        (ok_count, warn_count, error_count, status, datetime.now().isoformat(),
         json.dumps(details or []), entry_id)
    )
    conn.commit()
    conn.close()


def get_all_history() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM processing_history ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [_parse_row(r) for r in rows]


def get_history_entry(entry_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM processing_history WHERE id=?", (entry_id,)
    ).fetchone()
    conn.close()
    return _parse_row(row) if row else None


def delete_history_entry(entry_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM processing_history WHERE id=?", (entry_id,))
    conn.commit()
    conn.close()


def _parse_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    if isinstance(d.get('details'), str):
        try:
            d['details'] = json.loads(d['details'])
        except (json.JSONDecodeError, TypeError):
            d['details'] = []
    return d
