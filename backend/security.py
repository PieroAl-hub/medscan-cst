import re
from pathlib import Path


SANITIZE_NAME_RE = re.compile(r'[^\w\- .áéíóúÁÉÍÓÚñÑüÜçÇ]')
COMMAND_INJECTION_RE = re.compile(r'[;&|$`\'"(){}[\]!#~<>]')
PATH_TRAVERSAL_RE = re.compile(r'(\.\.)[/\\]')


def sanitize_filename(name: str) -> str:
    name = COMMAND_INJECTION_RE.sub('', name)
    name = SANITIZE_NAME_RE.sub('_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name or 'sin_nombre'


def validate_pdf_path(file_path: str, allowed_dir: Path) -> str:
    resolved = Path(file_path).resolve()
    allowed = allowed_dir.resolve()
    try:
        resolved.relative_to(allowed)
    except ValueError:
        raise ValueError(f"Path fuera del directorio permitido: {file_path}")
    if PATH_TRAVERSAL_RE.search(str(resolved)):
        raise ValueError(f"Path traversal detectado: {file_path}")
    if not resolved.exists():
        raise FileNotFoundError(f"Archivo no encontrado: {file_path}")
    if resolved.suffix.lower() != '.pdf':
        raise ValueError(f"Extensión no permitida: {resolved.suffix}")
    return str(resolved)


def is_valid_pdf(file_path: str) -> bool:
    try:
        with open(file_path, 'rb') as f:
            return f.read(4) == b'%PDF'
    except Exception:
        return False


def sanitize_patient_name(name: str) -> str:
    if not name:
        return ''
    name = COMMAND_INJECTION_RE.sub('', name)
    name = SANITIZE_NAME_RE.sub(' ', name)
    name = re.sub(r'\s+', ' ', name).strip().upper()
    return name
