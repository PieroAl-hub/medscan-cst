import os
import re
from concurrent.futures import ProcessPoolExecutor, as_completed

import cv2
import numpy as np
import pytesseract
import fitz


def _clean_name(name):
    name = re.sub(r'\s+PREFACTURA\s*\d+', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s+COD\.?\s*AUTOGENERADO\s*\d+', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s+S[- ]?FACTURACION\s*\d+', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s+POLIZA\s*\d+', '', name, flags=re.IGNORECASE)
    return name.strip()


def _is_company(name):
    keywords = [
        r'S\.?\s*A\.?\s*', r'S\.?\s*A\.?\s*C\.?\s*',
        r'E\.?\s*I\.?\s*R\.?\s*L\.?\s*',
        r'S\.?\s*R\.?\s*L\.?\s*', r'LTDA\.?',
        r'SOCIEDAD', r'EMPRESA', r'CORPORACION',
        r'LIMITADA', r'SAC', r'EIRL',
    ]
    for kw in keywords:
        if re.search(kw, name, re.IGNORECASE):
            return True
    if len(name.split()) <= 2 and name.isupper():
        return True
    return False


def extract_patient(text):
    patterns = [
        (r'PACIENTE\s*:?\s*(.+?)(?:\n|$)', 'PACIENTE:'),
        (r'Paciente\s*:?\s*(.+?)(?:\n|$)', 'Paciente:'),
    ]
    for pattern, source in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = _clean_name(m.group(1).strip())
            if val and len(val) > 2:
                return val, source

    m = re.search(r'Cliente\s*:?\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
    if m:
        val = _clean_name(m.group(1).strip())
        if val and len(val) > 2 and not _is_company(val):
            return val, 'Cliente:'

    for pattern, source in [
        (r'TITULAR\s*:?\s*(.+?)(?:\n|$)', 'TITULAR:'),
        (r'Titular\s*:?\s*(.+?)(?:\n|$)', 'Titular:'),
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = _clean_name(m.group(1).strip())
            if val and len(val) > 2:
                return val, source
    return '', ''


def extract_code(text):
    has_factura = bool(re.search(r'FACTURA', text, re.IGNORECASE))
    has_boleta = bool(re.search(r'BOLETA', text, re.IGNORECASE))

    m = re.search(r'[Ff](\d{3})\s*[-\s]\s*(\d{6,})', text)
    if m and has_factura:
        return f"F{m.group(1)}-{m.group(2).lstrip('0') or '0'}", 'FACTURA ELECTRONICA'

    m = re.search(r'[Bb](\d{3})\s*[-\s]\s*(\d{6,})', text)
    if m and has_boleta:
        return f"B{m.group(1)}-{m.group(2).lstrip('0') or '0'}", 'BOLETA DE VENTA'

    m = re.search(r'HISTORIA\s+CLINICA\s*:?\s*(\d+)', text, re.IGNORECASE)
    if m:
        return (m.group(1).lstrip('0') or '0'), 'HISTORIA CLINICA'

    return '', ''


def extract_year(text):
    patterns = [
        (r'FECHA\s+EMISION\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'FECHA EMISION'),
        (r'F[-]?Emision\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'F-Emision'),
        (r'FECHA\s+DE\s+ATENCION\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'FECHA DE ATENCION'),
        (r'Fecha\s+de\s+atenci[oó]n\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'Fecha de atención'),
        (r'FECHA\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'FECHA'),
        (r'Fecha\s*:?\s*\d{2}[-\s]\d{2}[-\s](\d{4})', 'Fecha'),
    ]
    for pattern, source in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1), source
    return '', ''


def pdf_page_to_image(page):
    pix = page.get_pixmap(dpi=200)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    elif pix.n == 1:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    return img


def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def extract_from_pdf(pdf_path):
    result = {
        'archivo': os.path.basename(pdf_path),
        'ruta': pdf_path,
        'paciente': '',
        'fuente_paciente': '',
        'codigo': '',
        'fuente_codigo': '',
        'anio': '',
        'fuente_anio': '',
        'error': '',
    }

    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            result['error'] = 'PDF vacío'
            return result
        page = doc[0]
        img = pdf_page_to_image(page)
        doc.close()
    except Exception as e:
        result['error'] = f'Error al leer PDF: {e}'
        return result

    try:
        processed = preprocess_image(img)
    except Exception as e:
        result['error'] = f'Error en preprocesamiento: {e}'
        return result

    try:
        ocr_text = pytesseract.image_to_string(processed, lang='spa', config='--psm 6')
    except Exception as e:
        result['error'] = f'Error en OCR: {e}'
        return result

    paciente, fuente_p = extract_patient(ocr_text)
    codigo, fuente_c = extract_code(ocr_text)
    anio, fuente_a = extract_year(ocr_text)

    result['paciente'] = paciente
    result['fuente_paciente'] = fuente_p
    result['codigo'] = codigo
    result['fuente_codigo'] = fuente_c
    result['anio'] = anio
    result['fuente_anio'] = fuente_a

    warnings = []
    if not paciente:
        warnings.append('No se detectó paciente')
    if not codigo:
        warnings.append('No se detectó código')
    if not anio:
        warnings.append('No se detectó año')
    if warnings:
        result['error'] = '; '.join(warnings)

    return result


def process_pdfs_parallel(pdf_paths, max_workers=None):
    if max_workers is None:
        max_workers = min(os.cpu_count() or 4, 8)

    results = []
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(extract_from_pdf, path): path for path in pdf_paths}
        for future in as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda r: pdf_paths.index(r['ruta']))
    return results
