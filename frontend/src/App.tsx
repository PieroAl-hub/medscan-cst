import { useState, useCallback, useRef, useEffect, Fragment } from 'react'
import { FileText, CheckCircle, XCircle, AlertTriangle, Download, Play, RotateCcw, Search, Edit3, Save, ArrowLeft, ArrowRight, Scan, Sparkles, Clock, Trash2, FolderOpen } from 'lucide-react'

type Ficha = {
  archivo: string; ruta: string; paciente: string; fuente_paciente: string
  codigo: string; fuente_codigo: string; anio: string; fuente_anio: string
  error: string; rotacion: number
  status: 'ok' | 'warn' | 'error'
}

type HistoryEntry = {
  id: number; project_name: string; folder_path: string; folder_name: string
  created_at: string; completed_at: string | null
  total_files: number; ok_count: number; warn_count: number; error_count: number
  status: string; details?: { archivo: string; error: string; status: string }[]
}

type Screen = 'upload' | 'processing' | 'review' | 'results' | 'history'

const API = ''
const WS = `ws://${window.location.host}/ws/process`
const CST = '#00C7C4'
const CST_DARK = '#111111'

function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [fichas, setFichas] = useState<Ficha[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [filterText, setFilterText] = useState('')
  const [recentFile, setRecentFile] = useState('')
  const [historyId, setHistoryId] = useState<number | null>(null)
  const [folderName, setFolderName] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  const startProcessing = useCallback((paths: string[], folder: string) => {
    setFolderName(folder)
    const ws = new WebSocket(WS)
    wsRef.current = ws
    const results: Ficha[] = []

    ws.onopen = () => ws.send(JSON.stringify({ pdfs: paths }))

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'start') {
        setProgress({ current: 0, total: msg.total })
      } else if (msg.type === 'progress') {
        setProgress({ current: msg.current, total: msg.total })
        setRecentFile(msg.archivo)
        results.push({
          archivo: msg.archivo, ruta: '',
          paciente: msg.paciente, fuente_paciente: '',
          codigo: msg.codigo, fuente_codigo: '',
          anio: msg.anio, fuente_anio: '',
          error: msg.error || '', rotacion: 0,
          status: msg.error ? (msg.error.includes('No se detectó') ? 'error' : 'warn') : 'ok',
        })
      } else if (msg.type === 'done') {
        setFichas(results.map(r => ({
          ...r,
          ruta: paths[results.indexOf(r)] || '',
          status: r.error ? (r.error.includes('No se detectó') ? 'error' as const : 'warn' as const) : 'ok' as const,
        })))
        setScreen('review')
      } else if (msg.type === 'error') { alert(`Error: ${msg.message}`) }
    }
    ws.onerror = () => alert('Error de conexión WebSocket')
  }, [])

  const handleUploadAndProcess = useCallback(async (files: FileList) => {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length === 0) { alert('No se encontraron PDFs en la carpeta'); return }

    setScreen('processing')
    setProgress({ current: 0, total: pdfs.length })
    setRecentFile('Subiendo archivos...')

    const formData = new FormData()
    pdfs.forEach(f => formData.append('files', f))

    try {
      const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) { alert(data.detail || 'Error al subir'); setScreen('upload'); return }

      const folder = pdfs[0]?.webkitRelativePath?.split('/')[0] || 'Carpeta'
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const histRes = await fetch(`${API}/api/history`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: `Proyecto ${now}`,
          folder_name: folder,
          folder_path: folder,
          total_files: data.pdfs.length,
        }),
      })
      const histData = await histRes.json()
      setHistoryId(histData.id)

      startProcessing(data.pdfs, folder)
    } catch { alert('¿El servidor está corriendo?'); setScreen('upload') }
  }, [startProcessing])

  const handleRename = useCallback(async () => {
    try {
      await fetch(`${API}/api/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: fichas }),
      })
      const ok = fichas.filter(f => f.status === 'ok').length
      const warns = fichas.filter(f => f.status === 'warn').length
      const errs = fichas.filter(f => f.status === 'error').length
      if (historyId) {
        const details = fichas.map(f => ({
          archivo: f.archivo, paciente: f.paciente, codigo: f.codigo,
          anio: f.anio, error: f.error, status: f.status,
        }))
        await fetch(`${API}/api/history/${historyId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok_count: ok, warn_count: warns, error_count: errs, status: errs > 0 ? 'partial' : 'completed', details }),
        })
      }
      setScreen('results')
    } catch { alert('Error al renombrar') }
  }, [fichas, historyId])

  const handleExport = useCallback(async (format: string) => {
    try {
      const res = await fetch(`${API}/api/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: fichas, format }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `resultados.${format}`
      a.click(); URL.revokeObjectURL(url)
    } catch { alert('Error al exportar') }
  }, [fichas])

  const updateFicha = useCallback((index: number, field: string, value: string) => {
    setFichas(prev => prev.map((f, i) => i === index ? { ...f, [field]: value } : f))
  }, [])

  const filteredFichas = fichas.filter(f =>
    f.paciente.toLowerCase().includes(filterText.toLowerCase()) ||
    f.codigo.toLowerCase().includes(filterText.toLowerCase()) ||
    f.anio.includes(filterText)
  )

  if (screen === 'upload') return (
    <UploadScreen onFolderSelected={handleUploadAndProcess}
      onHistory={() => setScreen('history')} />
  )
  if (screen === 'processing') return <ProcessingScreen progress={progress} recentFile={recentFile} fichas={fichas} />
  if (screen === 'review') return (
    <ReviewScreen fichas={filteredFichas} total={fichas.length}
      editingIndex={editingIndex} setEditingIndex={setEditingIndex}
      updateFicha={updateFicha} filterText={filterText} setFilterText={setFilterText}
      onRename={handleRename} onBack={() => setScreen('upload')} />
  )
  if (screen === 'history') return (
    <HistoryScreen onBack={() => setScreen('upload')} />
  )
  return <ResultsScreen fichas={fichas} folderName={folderName}
    onExport={handleExport}
    onBack={() => { setFichas([]); setHistoryId(null); setScreen('upload') }} />
}

// ─── Upload Screen ──────────────────────────────────────

function UploadScreen({ onFolderSelected, onHistory }: {
  onFolderSelected: (files: FileList) => void; onHistory: () => void
}) {
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setLoading(true)
      onFolderSelected(e.target.files)
      e.target.value = ''
    }
  }, [onFolderSelected])

  return (
    <div className="min-h-screen" style={{ background: '#FBFBFB' }}>
      <input type="file" ref={fileInputRef as React.RefObject<HTMLInputElement>}
        {...{ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
        multiple
        onChange={handleChange}
        className="hidden" />

      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <img src="/logo-cst.png" alt="Hospital Santa Teresa"
            className="h-24 mx-auto mb-6 object-contain" />
          <h1 className="text-4xl font-bold" style={{ fontFamily: 'Figtree', color: CST_DARK }}>
            MedScan CST
          </h1>
          <p className="mt-2 text-lg" style={{ color: '#7A7A7A' }}>
            Gestión inteligente de fichas médicas
          </p>
        </div>

        <button onClick={() => fileInputRef.current?.click()} disabled={loading}
          className="w-full py-5 px-6 rounded-2xl text-white font-semibold text-lg
            flex items-center justify-center gap-3 transition-all cursor-pointer
            active:scale-[0.98] shadow-lg hover:shadow-xl border-0"
          style={{ background: `linear-gradient(135deg, ${CST}, #00E5E0)` }}>
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : <FolderOpen className="w-6 h-6" />}
          {loading ? 'Subiendo archivos...' : 'Seleccionar carpeta con PDFs'}
        </button>

        <p className="mt-4 text-sm text-center" style={{ color: '#7A7A7A' }}>
          El explorador de archivos se abrirá para que elijas la carpeta
          donde el escáner guardó los PDFs
        </p>

        <div className="mt-12 grid grid-cols-3 gap-3">
          {[
            { step: '1', title: 'Seleccionar', desc: 'Carpeta con PDFs', icon: FolderOpen },
            { step: '2', title: 'OCR automático', desc: 'Lectura de datos', icon: Scan },
            { step: '3', title: 'Renombrar', desc: 'Exportar resultados', icon: Sparkles },
          ].map((s, i) => (
            <div key={i} className="p-4 rounded-xl border text-center"
              style={{ background: 'white', borderColor: '#E5E5E5' }}>
              <div className="w-9 h-9 mx-auto mb-2 rounded-xl flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${CST}, #00E5E0)` }}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <div className="text-sm font-semibold" style={{ color: CST_DARK }}>{s.title}</div>
              <div className="text-xs mt-0.5" style={{ color: '#7A7A7A' }}>{s.desc}</div>
            </div>
          ))}
        </div>

        <HistoryButton onHistory={onHistory} />
      </div>
    </div>
  )
}

// ─── History Button (fetches on mount, navigates to history) ─────

function HistoryButton({ onHistory }: { onHistory: () => void }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    fetch(`${API}/api/history`).then(r => { if (r.ok) r.json().then(d => setCount(d.length)) }).catch(() => {})
  }, [])

  return (
    <button onClick={onHistory}
      className="mt-8 w-full py-3 rounded-xl text-sm font-medium
        flex items-center justify-center gap-2 transition-all cursor-pointer border"
      style={{ color: '#7A7A7A', borderColor: '#E5E5E5', background: 'white' }}>
      <Clock className="w-4 h-4" />
      Historial de proyectos
      {count > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full ml-1"
          style={{ background: CST, color: 'white' }}>{count}</span>
      )}
    </button>
  )
}

// ─── Processing Screen ──────────────────────────────────

function ProcessingScreen({ progress, recentFile, fichas }: {
  progress: { current: number; total: number }; recentFile: string; fichas: Ficha[]
}) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const ok = fichas.filter(f => f.status === 'ok').length
  const errs = fichas.filter(f => f.status === 'error' || f.status === 'warn').length

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#FBFBFB' }}>
      <div className="max-w-lg w-full text-center">
        <img src="/logo-cst.png" alt="Hospital Santa Teresa" className="h-12 mx-auto mb-8 object-contain" />

        <div className="relative w-20 h-20 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full border-4" style={{ borderColor: '#E5E5E5' }} />
          <div className="absolute inset-0 rounded-full border-4 border-transparent animate-spin"
            style={{ borderTopColor: CST }} />
          <div className="absolute inset-0 rounded-full border-4 border-transparent animate-spin"
            style={{ borderBottomColor: CST, animationDuration: '1.5s' }} />
          <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center">
            <Scan className="w-7 h-7" style={{ color: CST_DARK }} />
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Figtree', color: CST_DARK }}>
          Procesando fichas
        </h2>
        <p className="mb-8" style={{ color: '#7A7A7A' }}>Extrayendo datos con OCR</p>

        <div className="rounded-2xl p-6 shadow-sm border" style={{ background: 'white', borderColor: '#E5E5E5' }}>
          <div className="flex justify-between text-sm mb-3">
            <span className="font-medium" style={{ color: CST_DARK }}>Progreso</span>
            <span className="font-bold" style={{ color: CST }}>{progress.current} / {progress.total}</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: '#F0F0F0' }}>
            <div className="h-full rounded-full bg-[length:200%] animate-shimmer transition-all duration-500"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${CST}, #00E5E0, ${CST})` }} />
          </div>
          <p className="text-xs mt-3" style={{ color: '#7A7A7A' }}>{pct}% completado</p>
        </div>

        <div className="rounded-xl p-4 border mt-4" style={{ background: 'white', borderColor: '#E5E5E5' }}>
          {recentFile && (
            <div className="flex items-center gap-2 text-sm mb-3" style={{ color: '#7A7A7A' }}>
              <FileText className="w-4 h-4 animate-bounce" style={{ color: CST }} />
              <span className="truncate">{recentFile}</span>
            </div>
          )}
          <div className="flex justify-center gap-6 text-sm">
            <span className="flex items-center gap-1.5 font-medium" style={{ color: '#16A34A' }}>
              <CheckCircle className="w-4 h-4" />{ok} ok
            </span>
            <span className="flex items-center gap-1.5 font-medium" style={{ color: '#DC2626' }}>
              <XCircle className="w-4 h-4" />{errs} err
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Review Screen ──────────────────────────────────────

function ReviewScreen({ fichas, total, editingIndex, setEditingIndex, updateFicha,
  filterText, setFilterText, onRename, onBack }: {
  fichas: Ficha[]; total: number; editingIndex: number | null
  setEditingIndex: (i: number | null) => void; updateFicha: (i: number, f: string, v: string) => void
  filterText: string; setFilterText: (v: string) => void; onRename: () => void; onBack: () => void
}) {
  const errors = fichas.filter(f => f.status === 'error').length
  const warnings = fichas.filter(f => f.status === 'warn').length
  const ok = fichas.filter(f => f.status === 'ok').length
  const [page, setPage] = useState(0)
  const perPage = 10
  const totalPages = Math.ceil(fichas.length / perPage)
  const currentPage = fichas.slice(page * perPage, (page + 1) * perPage)

  useEffect(() => { setPage(0) }, [filterText])

  return (
    <div className="min-h-screen" style={{ background: '#FBFBFB' }}>
      <header className="sticky top-0 z-10 border-b"
        style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', borderColor: '#E5E5E5' }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-cst.png" alt="CST" className="h-8 object-contain" />
            <h1 className="text-lg font-bold" style={{ fontFamily: 'Figtree', color: CST_DARK }}>Revisar fichas</h1>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#E8F4FD', color: CST }}>{total}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 font-medium" style={{ color: '#16A34A' }}><CheckCircle className="w-4 h-4" />{ok}</span>
            <span className="flex items-center gap-1 font-medium" style={{ color: '#D97706' }}><AlertTriangle className="w-4 h-4" />{warnings}</span>
            <span className="flex items-center gap-1 font-medium" style={{ color: '#DC2626' }}><XCircle className="w-4 h-4" />{errors}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#7A7A7A' }} />
            <input type="text" placeholder="Buscar por paciente, código o año..."
              value={filterText} onChange={e => setFilterText(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm border focus:outline-none transition-all placeholder:opacity-60"
              style={{ background: 'white', borderColor: '#E5E5E5', color: CST_DARK }}
              onFocus={e => e.target.style.borderColor = CST}
              onBlur={e => e.target.style.borderColor = '#E5E5E5'} />
          </div>
          <button onClick={onBack}
            className="px-4 py-2.5 text-sm rounded-xl border transition-all cursor-pointer flex items-center gap-1.5"
            style={{ color: '#7A7A7A', borderColor: '#E5E5E5', background: 'white' }}>
            <RotateCcw className="w-4 h-4" />Volver
          </button>
        </div>

        <div className="rounded-2xl shadow-sm border overflow-hidden" style={{ background: 'white', borderColor: '#E5E5E5' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#F5F5F5' }}>
                  <th className="text-left p-3 font-semibold w-8" style={{ color: CST_DARK }}></th>
                  <th className="text-left p-3 font-semibold" style={{ color: CST_DARK }}>Paciente</th>
                  <th className="text-left p-3 font-semibold" style={{ color: CST_DARK }}>Código</th>
                  <th className="text-left p-3 font-semibold w-20" style={{ color: CST_DARK }}>Año</th>
                  <th className="text-left p-3 font-semibold w-24" style={{ color: CST_DARK }}>Archivo</th>
                  <th className="text-center p-3 font-semibold w-16" style={{ color: CST_DARK }}></th>
                </tr>
              </thead>
              <tbody>
                {currentPage.map((f, i) => {
                  const idx = page * perPage + i
                  return (
                    <tr key={i} className="border-t transition-all duration-200" style={{ borderColor: '#F0F0F0' }}>
                      <td className="p-3">
                        {f.status === 'ok' ? <CheckCircle className="w-4 h-4" style={{ color: '#16A34A' }} /> :
                         f.status === 'warn' ? <AlertTriangle className="w-4 h-4" style={{ color: '#D97706' }} /> :
                         <XCircle className="w-4 h-4" style={{ color: '#DC2626' }} />}
                      </td>
                      <td className="p-3">
                        {editingIndex === idx ? (
                          <input type="text" value={f.paciente}
                            onChange={e => updateFicha(idx, 'paciente', e.target.value)}
                            className="w-full px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 bg-white"
                            style={{ borderColor: CST, color: CST_DARK }} autoFocus />
                        ) : (
                          <span className="font-medium" style={{ color: CST_DARK }}>
                            {f.paciente || <span className="italic opacity-60" style={{ color: '#DC2626' }}>Sin detectar</span>}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {editingIndex === idx ? (
                          <input type="text" value={f.codigo}
                            onChange={e => updateFicha(idx, 'codigo', e.target.value)}
                            className="w-full px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 bg-white font-mono"
                            style={{ borderColor: CST, color: CST_DARK }} />
                        ) : (
                          <span className="font-mono" style={{ color: CST }}>
                            {f.codigo || <span className="italic opacity-60" style={{ color: '#DC2626' }}>---</span>}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {editingIndex === idx ? (
                          <input type="text" value={f.anio}
                            onChange={e => updateFicha(idx, 'anio', e.target.value)}
                            className="w-20 px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 bg-white"
                            style={{ borderColor: CST, color: CST_DARK }} />
                        ) : (
                          <span className="font-mono">{f.anio || <span className="italic opacity-60" style={{ color: '#DC2626' }}>--</span>}</span>
                        )}
                      </td>
                      <td className="p-3 text-xs truncate max-w-[120px]" style={{ color: '#7A7A7A' }} title={f.archivo}>
                        {f.archivo}
                      </td>
                      <td className="p-3 text-center">
                        {editingIndex === idx ? (
                          <button onClick={() => setEditingIndex(null)}
                            className="transition-colors cursor-pointer p-1" style={{ color: '#16A34A' }}>
                            <Save className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => setEditingIndex(idx)}
                            className="transition-colors cursor-pointer p-1" style={{ color: CST }}>
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {currentPage.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center" style={{ color: '#7A7A7A' }}>No se encontraron fichas</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 p-3 border-t"
              style={{ borderColor: '#F0F0F0', background: '#FAFAFA' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-all cursor-pointer"
                style={{ color: CST }}><ArrowLeft className="w-4 h-4" /></button>
              <span className="text-sm font-medium" style={{ color: '#7A7A7A' }}>{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg disabled:opacity-30 transition-all cursor-pointer"
                style={{ color: CST }}><ArrowRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between items-center">
          <p className="text-sm" style={{ color: '#7A7A7A' }}>{total} fichas · <span style={{ color: '#DC2626' }}>{errors}</span> con errores</p>
          <button onClick={onRename}
            className="px-8 py-3 rounded-xl text-white font-semibold flex items-center gap-2 transition-all cursor-pointer active:scale-[0.97] shadow-md hover:shadow-lg"
            style={{ background: `linear-gradient(135deg, ${CST}, #00E5E0)` }}>
            <Play className="w-4 h-4" />Renombrar y finalizar
          </button>
        </div>
      </main>
    </div>
  )
}

// ─── Results Screen ────────────────────────────────────

function ResultsScreen({ fichas, folderName, onExport, onBack }: {
  fichas: Ficha[]; folderName: string; onExport: (f: string) => void; onBack: () => void
}) {
  const ok = fichas.filter(f => f.status === 'ok').length
  const errors = fichas.filter(f => f.status === 'error').length
  const warnings = fichas.filter(f => f.status === 'warn').length
  const errorFiles = fichas.filter(f => f.error)
  const [showErrors, setShowErrors] = useState(false)
  const [animDone, setAnimDone] = useState(false)
  useEffect(() => { const t = setTimeout(() => setAnimDone(true), 600); return () => clearTimeout(t) }, [])

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: '#FBFBFB' }}>
      <div className="max-w-xl mx-auto text-center">
        <img src="/logo-cst.png" alt="Hospital Santa Teresa" className="h-12 mx-auto mb-6 object-contain" />

        <div className="rounded-2xl p-8 shadow-lg border" style={{ background: 'white', borderColor: '#E5E5E5' }}>
          <div className={`w-20 h-20 mx-auto mb-5 rounded-full flex items-center justify-center transition-all duration-500 ${animDone ? 'scale-100' : 'scale-90'}`}
            style={{ background: animDone ? '#DCFCE7' : '#F0F0F0' }}>
            {animDone ? <CheckCircle className="w-10 h-10 animate-in zoom-in duration-300" style={{ color: '#16A34A' }} />
              : <div className="w-10 h-10 rounded-full border-4 animate-spin" style={{ borderColor: '#E5E5E5', borderTopColor: CST }} />}
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Figtree', color: CST_DARK }}>Procesamiento completado</h2>
          <p className="mb-2" style={{ color: '#7A7A7A' }}>Fichas renombradas</p>
          <p className="mb-6 text-xs" style={{ color: '#7A7A7A' }}>{folderName}</p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Correctas', value: ok, color: '#16A34A' },
              { label: 'Advertencias', value: warnings, color: '#D97706' },
              { label: 'Errores', value: errors, color: '#DC2626' },
            ].map((s, i) => (
              <div key={i} className="p-4 rounded-xl border" style={{ background: '#FAFAFA', borderColor: '#E5E5E5' }}>
                <div className="text-3xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-1" style={{ color: '#7A7A7A' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {errorFiles.length > 0 && (
            <div className="mb-6 text-left">
              <button onClick={() => setShowErrors(!showErrors)}
                className="flex items-center gap-2 text-sm font-medium cursor-pointer mx-auto"
                style={{ color: '#DC2626' }}>
                <XCircle className="w-4 h-4" />
                {showErrors ? 'Ocultar' : 'Ver'} {errorFiles.length} archivo(s) con error
                <span className={`transition-transform ${showErrors ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {showErrors && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border text-xs"
                  style={{ background: '#FEF2F2', borderColor: '#FECACA' }}>
                  {errorFiles.map((f, i) => (
                    <div key={i} className="px-3 py-2 border-b last:border-b-0 flex gap-2"
                      style={{ borderColor: '#FECACA' }}>
                      <span className="font-medium truncate flex-1" style={{ color: CST_DARK }}>{f.archivo}</span>
                      <span style={{ color: '#DC2626' }}>{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-sm mb-4" style={{ color: '#7A7A7A' }}>Exportar resultados</p>
          <div className="flex justify-center gap-3">
            {['csv', 'txt'].map(f => (
              <button key={f} onClick={() => onExport(f)}
                className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer active:scale-[0.97] shadow-md hover:shadow-lg"
                style={{ background: `linear-gradient(135deg, ${CST}, #00E5E0)` }}>
                <Download className="w-4 h-4" />{f.toUpperCase()}
              </button>
            ))}
          </div>

          <button onClick={onBack}
            className="mt-6 text-sm transition-colors cursor-pointer flex items-center gap-1 justify-center mx-auto"
            style={{ color: '#7A7A7A' }}>
            <RotateCcw className="w-4 h-4" />Procesar otro lote
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── History Screen ─────────────────────────────────────

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/history`)
      if (res.ok) setEntries(await res.json())
    } catch {}
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleDelete = useCallback(async (id: number) => {
    try {
      await fetch(`${API}/api/history/${id}`, { method: 'DELETE' })
      loadData()
    } catch {}
  }, [loadData])
  return (
    <div className="min-h-screen" style={{ background: '#FBFBFB' }}>
      <header className="sticky top-0 z-10 border-b"
        style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', borderColor: '#E5E5E5' }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-cst.png" alt="CST" className="h-8 object-contain" />
            <h1 className="text-lg font-bold" style={{ fontFamily: 'Figtree', color: CST_DARK }}>Historial</h1>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#F0F0F0', color: '#7A7A7A' }}>{entries.length}</span>
          </div>
          <button onClick={onBack}
            className="px-4 py-2 text-sm rounded-xl border transition-all cursor-pointer flex items-center gap-1.5"
            style={{ color: '#7A7A7A', borderColor: '#E5E5E5', background: 'white' }}>
            <RotateCcw className="w-4 h-4" />Volver
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {entries.length === 0 ? (
          <div className="text-center py-16">
            <Clock className="w-12 h-12 mx-auto mb-4" style={{ color: '#E5E5E5' }} />
            <p className="text-lg" style={{ color: '#7A7A7A' }}>No hay proyectos en el historial</p>
            <p className="text-sm mt-1" style={{ color: '#aaa' }}>Los proyectos se guardan automáticamente al procesar</p>
          </div>
        ) : (
          <div className="rounded-2xl shadow-sm border overflow-hidden" style={{ background: 'white', borderColor: '#E5E5E5' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#F5F5F5' }}>
                    <th className="text-left p-3 font-semibold" style={{ color: CST_DARK }}>Proyecto</th>
                    <th className="text-left p-3 font-semibold" style={{ color: CST_DARK }}>Carpeta</th>
                    <th className="text-left p-3 font-semibold" style={{ color: CST_DARK }}>Fecha</th>
                    <th className="text-center p-3 font-semibold" style={{ color: CST_DARK }}>Total</th>
                    <th className="text-center p-3 font-semibold" style={{ color: '#16A34A' }}>OK</th>
                    <th className="text-center p-3 font-semibold" style={{ color: '#D97706' }}>Warn</th>
                    <th className="text-center p-3 font-semibold" style={{ color: '#DC2626' }}>Err</th>
                    <th className="text-center p-3 font-semibold" style={{ color: CST_DARK }}>Estado</th>
                    <th className="text-center p-3 w-28" style={{ color: CST_DARK }}></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="border-t transition-all duration-200" style={{ borderColor: '#F0F0F0' }}>
                        <td className="p-3 font-medium" style={{ color: CST_DARK }}>
                          {e.project_name || `Proyecto #${e.id}`}
                        </td>
                        <td className="p-3 text-xs" style={{ color: '#7A7A7A' }}>{e.folder_name}</td>
                        <td className="p-3 text-xs" style={{ color: '#7A7A7A' }}>
                          {e.created_at.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="p-3 text-center font-mono">{e.total_files}</td>
                        <td className="p-3 text-center font-mono" style={{ color: '#16A34A' }}>{e.ok_count}</td>
                        <td className="p-3 text-center font-mono" style={{ color: '#D97706' }}>{e.warn_count}</td>
                        <td className="p-3 text-center font-mono" style={{ color: '#DC2626' }}>{e.error_count}</td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            e.status === 'completed' ? 'bg-green-100 text-green-700' :
                            e.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {e.status === 'completed' ? 'Completado' :
                             e.status === 'partial' ? 'Parcial' : 'Procesando'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {e.error_count > 0 && (
                              <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                                className="text-xs px-2 py-1 rounded-lg transition-all cursor-pointer font-medium"
                                style={{ background: '#FEF2F2', color: '#DC2626' }}>
                                Errores
                              </button>
                            )}
                            <button onClick={() => handleDelete(e.id)}
                              className="transition-colors cursor-pointer p-1.5 rounded-lg hover:bg-red-50"
                              style={{ color: '#aaa' }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === e.id && e.details && e.details.length > 0 && (
                        <tr key={`${e.id}-details`}>
                          <td colSpan={9} className="p-0">
                            <div className="bg-red-50 border-t border-b px-6 py-3" style={{ borderColor: '#FECACA' }}>
                              <p className="text-xs font-semibold mb-2" style={{ color: '#DC2626' }}>Archivos con error:</p>
                              <div className="max-h-40 overflow-y-auto space-y-1">
                                {e.details.filter(d => d.error).map((d, i) => (
                                  <div key={i} className="flex gap-2 text-xs">
                                    <span className="font-medium truncate flex-1" style={{ color: CST_DARK }}>{d.archivo}</span>
                                    <span style={{ color: '#DC2626' }}>{d.error}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
