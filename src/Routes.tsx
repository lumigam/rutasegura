import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Check, ChevronRight, Locate, MapPin, Plus, Trash2, X } from './icons'
import {
  calculateDirections, claimPairingCode, createRoute, createSchedule, deleteRoute, deleteSchedule,
  generatePairingCode, getApiOrigin, getDirectionsConfig, getLiveConfig, getSessionToken, loadLinkedUsuarios, loadMyRoutes, loadRoutes,
  pollLiveLocation, requestLiveLocation, unlinkUsuario, updateRoute, updateSchedule,
  type ScheduleInput,
} from './storage'
import {
  getRouteGuardStatus, isNativeAndroid, openLocationSettings, registerLiveLocationToken, requestBackgroundLocation, requestForegroundLocation,
  syncRouteGuardRoutes, updateRouteGuardSession, type RouteGuardStatus,
} from './routeGuard'
import type { LatLng, LinkedUsuario, Route, Schedule, TravelMode, UserAccount, Weekday } from './types'

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]
const PLASENCIA: LatLng = { lat: 40.0298, lng: -6.0844 }

type SearchResult = { lat: string, lon: string, display_name: string, type: string }

function RouteMap({ points, corridorWidthMeters, editable, onAddPoint }: { points: LatLng[], corridorWidthMeters: number, editable: boolean, onAddPoint?: (point: LatLng) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const onAddPointRef = useRef(onAddPoint)
  onAddPointRef.current = onAddPoint
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!query.trim() || searching) return
    setSearching(true); setSearchError(''); setResults([])
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=es&limit=5&q=${encodeURIComponent(query)}`)
      const found = await response.json() as SearchResult[]
      if (!found.length) { setSearchError('No se ha encontrado ese lugar'); return }
      setResults(found)
    } catch { setSearchError('No se pudo buscar el lugar') }
    finally { setSearching(false) }
  }

  const pickResult = (result: SearchResult) => {
    const precise = ['house', 'building', 'residential', 'road', 'pedestrian', 'address'].includes(result.type)
    mapRef.current?.setView([Number(result.lat), Number(result.lon)], precise ? 18 : 14)
    setResults([])
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [PLASENCIA.lat, PLASENCIA.lng], zoom: 14 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => onAddPointRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng }))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (points.length) {
      const latlngs = points.map(p => [p.lat, p.lng]) as [number, number][]
      if (points.length > 1) L.polyline(latlngs, { color: '#3f74b3', weight: 4, opacity: .85 }).addTo(layer)
      points.forEach((p, index) => {
        L.circle([p.lat, p.lng], { radius: corridorWidthMeters, color: '#3f74b3', weight: 1, opacity: .35, fillOpacity: .08 }).addTo(layer)
        const label = points.length === 2 ? (index === 0 ? 'Origen' : 'Destino') : String(index + 1)
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'route-pin', html: `<span>${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(layer)
      })
      if (points.length > 1) map.fitBounds(latlngs, { padding: [30, 30] })
      else map.setView(latlngs[0], Math.max(map.getZoom(), 16))
    }
  }, [points, corridorWidthMeters])

  return <>
    <form className="map-search" onSubmit={search}>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ej. Calle Mayorga 1, Plasencia" />
      <button type="submit" disabled={searching}>{searching ? '…' : 'Buscar'}</button>
    </form>
    {searchError && <div className="form-error">{searchError}</div>}
    {results.length > 0 && <ul className="search-results">
      {results.map((result, index) => <li key={index}><button type="button" onClick={() => pickResult(result)}>{result.display_name}</button></li>)}
    </ul>}
    <div ref={containerRef} className="route-map" style={{ cursor: editable ? 'crosshair' : 'grab' }} />
  </>
}

export function PairingCard({ role, onLinked }: { role: UserAccount['role'], onLinked?: () => void }) {
  const [code, setCode] = useState('')
  const [generated, setGenerated] = useState<{ code: string, expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (role === 'USUARIO') {
    const generate = async () => {
      setBusy(true); setError('')
      try { setGenerated(await generatePairingCode()) }
      catch { setError('No se pudo generar el código') }
      finally { setBusy(false) }
    }
    return <section className="profile-card">
      <h2>Código para tu tutor/a</h2>
      <p>Compártelo con la persona que va a programar tu ruta. Caduca a los 15 minutos.</p>
      {generated
        ? <div className="pairing-code">{generated.code}</div>
        : <button className="secondary-button" disabled={busy} onClick={generate}>{busy ? 'Generando…' : 'Generar código'}</button>}
      {generated && <button className="text-link" onClick={generate}>Generar otro código</button>}
      {error && <div className="form-error">{error}</div>}
    </section>
  }

  const claim = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await claimPairingCode(code); setCode(''); onLinked?.() }
    catch { setError('El código no es válido o ha caducado') }
    finally { setBusy(false) }
  }
  return <section className="profile-card">
    <h2>Vincular a una persona usuaria</h2>
    <p>Pide el código de 6 caracteres que aparece en su aplicación.</p>
    <form onSubmit={claim}>
      <label>Código<input required maxLength={6} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="AB12CD" style={{ textTransform: 'uppercase', letterSpacing: '2px' }} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary" disabled={code.length < 6 || busy}>{busy ? 'Vinculando…' : 'Vincular'}</button>
    </form>
  </section>
}

function LinkedUsuariosList({ usuarios, onChange }: { usuarios: LinkedUsuario[], onChange: () => void }) {
  const [error, setError] = useState('')
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [viewing, setViewing] = useState<LinkedUsuario | null>(null)
  useEffect(() => { getLiveConfig().then(c => setLiveEnabled(c.enabled)).catch(() => undefined) }, [])
  const remove = async (usuario: LinkedUsuario) => {
    if (!window.confirm(`¿Quitar el vínculo con ${usuario.name}? También se eliminarán sus rutas y horarios. Podréis volver a vincularos más tarde con un código nuevo.`)) return
    try { await unlinkUsuario(usuario.id); onChange() }
    catch { setError('No se pudo quitar el vínculo') }
  }
  return <section className="profile-card">
    <h2>Personas vinculadas</h2>
    <p>Puedes quitar el vínculo cuando quieras; se puede rehacer con un código nuevo.</p>
    {error && <div className="form-error">{error}</div>}
    <div className="route-list">
      {usuarios.map(usuario => <div className="route-row" key={usuario.id}>
        <span className="route-row-icon"><MapPin /></span>
        <span className="route-row-text"><strong>{usuario.name}</strong><small>{usuario.email}</small></span>
        <div className="schedule-actions">
          {liveEnabled && <button type="button" onClick={() => setViewing(usuario)} aria-label={`Ver ubicación de ${usuario.name} ahora`}><Locate /></button>}
          <button type="button" onClick={() => remove(usuario)} aria-label={`Quitar vínculo con ${usuario.name}`}><Trash2 /></button>
        </div>
      </div>)}
    </div>
    {viewing && <LiveLocationModal usuario={viewing} onClose={() => setViewing(null)} />}
  </section>
}

function LiveLocationModal({ usuario, onClose }: { usuario: LinkedUsuario, onClose: () => void }) {
  const [state, setState] = useState<'requesting' | 'pending' | 'done' | 'expired' | 'error'>('requesting')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (requestId: string) => {
      if (cancelled) return
      try {
        const result = await pollLiveLocation(requestId)
        if (cancelled) return
        if (result.status === 'done' && result.lat != null && result.lng != null) {
          setState('done')
          if (containerRef.current && !mapRef.current) {
            const map = L.map(containerRef.current, { center: [result.lat, result.lng], zoom: 16 })
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map)
            L.marker([result.lat, result.lng]).addTo(map)
            mapRef.current = map
          }
          return
        }
        if (result.status === 'expired') { setState('expired'); return }
        timer = setTimeout(() => poll(requestId), 2000)
      } catch { if (!cancelled) setState('error') }
    }
    requestLiveLocation(usuario.id).then(({ requestId }) => { if (!cancelled) { setState('pending'); timer = setTimeout(() => poll(requestId), 1500) } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true; clearTimeout(timer); mapRef.current?.remove(); mapRef.current = null }
  }, [usuario.id])

  return <div className="modal-backdrop" role="presentation"><div className="sheet" role="dialog" aria-modal="true" aria-labelledby="live-title">
    <div className="sheet-head"><button onClick={onClose} aria-label="Cerrar"><X /></button><div><p className="eyebrow">VER AHORA</p><h1 id="live-title">{usuario.name}</h1></div><span /></div>
    {(state === 'requesting' || state === 'pending') && <p className="lede-note">Pidiendo su ubicación… puede tardar unos segundos.</p>}
    {state === 'done' && <div ref={containerRef} className="route-map" />}
    {state === 'expired' && <div className="form-error">No ha respondido a tiempo. Puede que tenga la aplicación cerrada o sin conexión.</div>}
    {state === 'error' && <div className="form-error">No se ha podido pedir la ubicación.</div>}
  </div></div>
}

export function RoutesView() {
  const [usuarios, setUsuarios] = useState<LinkedUsuario[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Route | 'new' | null>(null)
  const [error, setError] = useState('')

  const refresh = () => Promise.all([loadLinkedUsuarios(), loadRoutes()]).then(([u, r]) => { setUsuarios(u); setRoutes(r); setLoaded(true) })
  useEffect(() => { refresh().catch(() => setError('No se pudieron cargar las rutas')) }, [])

  return <div className="page inner-page">
    <div className="inner-heading">
      <div><p className="eyebrow">TUTOR/A</p><h1>Rutas</h1><p>Programa el camino y el horario habituales.</p></div>
      {usuarios.length > 0 && <button className="primary compact" onClick={() => setEditing('new')}><Plus /> Añadir</button>}
    </div>
    {error && <div className="form-error">{error}</div>}
    <PairingCard role="TUTOR" onLinked={refresh} />
    {loaded && usuarios.length === 0 && <p className="lede-note">Vincula primero a una persona usuaria para poder crear una ruta.</p>}
    {usuarios.length > 0 && <LinkedUsuariosList usuarios={usuarios} onChange={refresh} />}
    {routes.length > 0 && <div className="route-list">
      {routes.map(route => <button className="route-row" key={route.id} onClick={() => setEditing(route)}>
        <span className="route-row-icon"><MapPin /></span>
        <span className="route-row-text"><strong>{route.label}</strong><small>{usuarios.find(u => u.id === route.usuarioId)?.name ?? 'Persona usuaria'} · {route.schedules.length ? `${route.schedules.length} horario(s)` : 'Sin horario'}</small></span>
        <ChevronRight />
      </button>)}
    </div>}
    {loaded && routes.length === 0 && usuarios.length > 0 && <div className="large-empty"><MapPin /><h2>Aún no hay rutas</h2><p>Añade la primera para empezar a recibir avisos.</p><button className="primary" onClick={() => setEditing('new')}><Plus /> Añadir ruta</button></div>}
    {editing && <RouteEditor initial={editing === 'new' ? null : editing} usuarios={usuarios} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
  </div>
}

function RouteEditor({ initial, usuarios, onClose, onSaved }: { initial: Route | null, usuarios: LinkedUsuario[], onClose: () => void, onSaved: () => void }) {
  const [usuarioId, setUsuarioId] = useState(initial?.usuarioId ?? usuarios[0]?.id ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [mode, setModeState] = useState<TravelMode>(initial?.mode ?? 'WALK')
  const [points, setPoints] = useState<LatLng[]>(initial?.points ?? [])
  const [corridorWidthMeters, setCorridorWidthMeters] = useState(initial?.corridorWidthMeters ?? 75)
  const [active, setActive] = useState(initial?.active ?? true)
  const [schedules, setSchedules] = useState<Schedule[]>(initial?.schedules ?? [])
  const [savedRouteId, setSavedRouteId] = useState<string | null>(initial?.id ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [directionsEnabled, setDirectionsEnabled] = useState(false)
  const [drawMode, setDrawMode] = useState<'manual' | 'auto'>('manual')
  const [calculating, setCalculating] = useState(false)
  useEffect(() => { getDirectionsConfig().then(c => setDirectionsEnabled(c.enabled)).catch(() => undefined) }, [])

  const setMode = (next: TravelMode) => {
    setModeState(next)
    if (!savedRouteId) setCorridorWidthMeters(next === 'CAR' ? 250 : 75)
  }

  const [autoPicks, setAutoPicks] = useState<LatLng[]>([])
  const calculateAuto = async (origin: LatLng, destination: LatLng) => {
    setCalculating(true); setError('')
    try { setPoints((await calculateDirections(mode, origin, destination)).points) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo calcular la ruta entre esos dos puntos'); setPoints([origin, destination]) }
    finally { setCalculating(false); setAutoPicks([]) }
  }
  const addPoint = (point: LatLng) => {
    if (drawMode === 'manual') { setPoints(current => [...current, point]); return }
    setAutoPicks(current => {
      if (current.length >= 2) return [point]
      const next = [...current, point]
      if (next.length === 2) void calculateAuto(next[0], next[1])
      return next
    })
  }
  const undoPoint = () => setPoints(current => current.slice(0, -1))
  const clearPoints = () => { setPoints([]); setAutoPicks([]) }
  const switchDrawMode = (next: 'manual' | 'auto') => {
    if (next === drawMode) return
    setDrawMode(next); setPoints([]); setAutoPicks([]); setError('')
  }

  const saveRoute = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!usuarioId) { setError('Selecciona a la persona usuaria'); return }
    if (points.length < 2) { setError('Marca al menos dos puntos en el mapa'); return }
    setBusy(true); setError('')
    try {
      const saved = savedRouteId
        ? await updateRoute(savedRouteId, { label, points, mode, corridorWidthMeters, active })
        : await createRoute({ usuarioId, label, points, mode, corridorWidthMeters })
      setSavedRouteId(saved.id)
      setSchedules(saved.schedules)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la ruta') }
    finally { setBusy(false) }
  }

  const removeRoute = async () => {
    if (!savedRouteId || !window.confirm('¿Eliminar esta ruta y sus horarios?')) return
    await deleteRoute(savedRouteId)
    onSaved()
  }

  return <div className="modal-backdrop" role="presentation"><div className="sheet route-sheet" role="dialog" aria-modal="true" aria-labelledby="route-title">
    <div className="sheet-head"><button onClick={onClose} aria-label="Cerrar"><X /></button><div><p className="eyebrow">RUTA</p><h1 id="route-title">{initial ? 'Editar ruta' : 'Nueva ruta'}</h1></div><span /></div>
    <div className="route-editor-body">
      {directionsEnabled && <div className="option-toggle" role="group" aria-label="Cómo marcar el camino">
        <button type="button" className={drawMode === 'manual' ? 'selected' : ''} onClick={() => switchDrawMode('manual')}>Dibujar a mano</button>
        <button type="button" className={drawMode === 'auto' ? 'selected' : ''} onClick={() => switchDrawMode('auto')}>Calcular automáticamente</button>
      </div>}
      <p className="lede-note map-hint">{drawMode === 'manual'
        ? 'Busca el punto de partida y luego toca el mapa para ir marcando el camino, punto a punto.'
        : calculating ? 'Calculando la ruta entre los dos puntos…'
        : autoPicks.length === 0 ? `Toca el mapa para marcar el origen (a pie o en coche: ${mode === 'CAR' ? 'en coche' : 'a pie'}).`
        : autoPicks.length === 1 ? 'Origen marcado. Ahora toca el mapa para marcar el destino.'
        : 'Ruta calculada. Puedes guardarla o volver a marcar los puntos.'}</p>
      <RouteMap points={drawMode === 'auto' && (autoPicks.length > 0 || calculating) ? autoPicks : points} corridorWidthMeters={corridorWidthMeters} editable onAddPoint={addPoint} />
      <div className="route-map-actions">
        <button type="button" className="text-button" onClick={drawMode === 'manual' ? undoPoint : () => setAutoPicks([])} disabled={drawMode === 'manual' ? !points.length : !autoPicks.length}>{drawMode === 'manual' ? 'Deshacer último punto' : 'Empezar de nuevo'}</button>
        <button type="button" className="text-button" onClick={clearPoints} disabled={!points.length && !autoPicks.length}>Borrar ruta</button>
      </div>
      <form onSubmit={saveRoute}>
        <label>Nombre de la ruta<input required value={label} onChange={e => setLabel(e.target.value)} placeholder="Ej. Centro de día → Casa" /></label>
        <label>Persona usuaria<select required value={usuarioId} onChange={e => setUsuarioId(e.target.value)} disabled={Boolean(savedRouteId)}>
          <option value="" disabled>Selecciona…</option>
          {usuarios.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></label>
        <fieldset><legend>Cómo se hace el trayecto</legend><div className="option-toggle">
          <button type="button" className={mode === 'WALK' ? 'selected' : ''} onClick={() => setMode('WALK')}>A pie</button>
          <button type="button" className={mode === 'CAR' ? 'selected' : ''} onClick={() => setMode('CAR')}>En coche</button>
        </div></fieldset>
        <label>Ancho del margen de seguridad (metros)<input required type="number" min={10} max={500} value={corridorWidthMeters} onChange={e => setCorridorWidthMeters(Number(e.target.value))} /></label>
        {savedRouteId && <label className="switch-row"><span><strong>Ruta activa</strong><small>Una ruta pausada no genera avisos</small></span><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><i /></label>}
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}><Check /> {busy ? 'Guardando…' : 'Guardar ruta'}</button>
          {savedRouteId && <button className="danger" type="button" onClick={removeRoute}><Trash2 /> Eliminar ruta</button>}
        </div>
      </form>
      {savedRouteId && <SchedulesEditor routeId={savedRouteId} schedules={schedules} onChange={setSchedules} />}
    </div>
  </div></div>
}

function SchedulesEditor({ routeId, schedules, onChange }: { routeId: string, schedules: Schedule[], onChange: (s: Schedule[]) => void }) {
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const [error, setError] = useState('')

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar este horario?')) return
    try { await deleteSchedule(id); onChange(schedules.filter(s => s.id !== id)) }
    catch { setError('No se pudo eliminar el horario') }
  }

  return <div className="schedules-block">
    <div className="inner-heading" style={{ marginBottom: 16 }}>
      <div><p className="eyebrow">HORARIOS</p><h2 style={{ margin: 0, fontSize: 20 }}>Cuándo se hace esta ruta</h2></div>
      <button type="button" className="primary compact" onClick={() => setEditing('new')}><Plus /> Añadir horario</button>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="schedule-list">
      {schedules.map(schedule => <div className="schedule-row" key={schedule.id}>
        {schedule.kind === 'ONCE'
          ? <div><strong>Ruta rápida</strong><span>Trayecto de una sola vez, iniciado el {schedule.time}</span></div>
          : <div><strong>{schedule.time}</strong><span>{schedule.days.length === 7 ? 'Todos los días' : schedule.days.map(d => DAY_NAMES[d]).join(', ')}</span></div>}
        {schedule.estimatedArrivalMinutes != null && <span className="schedule-note">Avisa si no llega en {schedule.estimatedArrivalMinutes + schedule.arrivalToleranceMinutes} min</span>}
        <div className="schedule-actions">
          <button type="button" onClick={() => setEditing(schedule)} aria-label="Editar horario"><ChevronRight /></button>
          <button type="button" onClick={() => remove(schedule.id)} aria-label="Eliminar horario"><Trash2 /></button>
        </div>
      </div>)}
      {!schedules.length && <p className="lede-note">Todavía no hay ningún horario para esta ruta.</p>}
    </div>
    {editing && <ScheduleForm routeId={routeId} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved => {
      onChange(editing === 'new' ? [...schedules, saved] : schedules.map(s => s.id === saved.id ? saved : s))
      setEditing(null)
    }} />}
  </div>
}

function ScheduleForm({ routeId, initial, onClose, onSaved }: { routeId: string, initial: Schedule | null, onClose: () => void, onSaved: (s: Schedule) => void }) {
  const [kind, setKind] = useState<Schedule['kind']>(initial?.kind ?? 'WEEKLY')
  const [days, setDays] = useState<Weekday[]>(initial?.days ?? [1, 2, 3, 4, 5])
  const [time, setTime] = useState(initial?.time ?? '18:00')
  const [windowMinutesAfter, setWindowMinutesAfter] = useState(initial?.windowMinutesAfter ?? (kind === 'ONCE' ? 20 : 45))
  const [estimatedArrivalMinutes, setEstimatedArrivalMinutes] = useState<string>(initial?.estimatedArrivalMinutes != null ? String(initial.estimatedArrivalMinutes) : '')
  const [arrivalToleranceMinutes, setArrivalToleranceMinutes] = useState(initial?.arrivalToleranceMinutes ?? 20)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toggleDay = (day: Weekday) => setDays(current => current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort())

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (kind === 'WEEKLY' && !days.length) { setError('Selecciona al menos un día'); return }
    setBusy(true); setError('')
    const data: ScheduleInput = kind === 'ONCE'
      ? { kind, windowMinutesBefore: 0, windowMinutesAfter, estimatedArrivalMinutes: estimatedArrivalMinutes ? Number(estimatedArrivalMinutes) : null, arrivalToleranceMinutes, active: true }
      : { kind, days, time, windowMinutesBefore: 15, windowMinutesAfter,
          estimatedArrivalMinutes: estimatedArrivalMinutes ? Number(estimatedArrivalMinutes) : null, arrivalToleranceMinutes, active: true }
    try { onSaved(initial ? await updateSchedule(initial.id, data) : await createSchedule(routeId, data)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el horario') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation"><div className="sheet schedule-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-title">
    <div className="sheet-head"><button onClick={onClose} aria-label="Cerrar"><X /></button><div><p className="eyebrow">HORARIO</p><h1 id="schedule-title">{initial ? 'Editar horario' : 'Nuevo horario'}</h1></div><span /></div>
    <form onSubmit={submit}>
      {!initial && <fieldset><legend>Cuándo</legend><div className="option-toggle">
        <button type="button" className={kind === 'WEEKLY' ? 'selected' : ''} onClick={() => setKind('WEEKLY')}>Recurrente</button>
        <button type="button" className={kind === 'ONCE' ? 'selected' : ''} onClick={() => setKind('ONCE')}>Ahora mismo</button>
      </div></fieldset>}
      {kind === 'WEEKLY'
        ? <>
            <fieldset><legend>Días</legend><div className="days">{ALL_DAYS.map(day => <button type="button" key={day} className={days.includes(day) ? 'selected' : ''} onClick={() => toggleDay(day)}>{DAY_NAMES[day]}</button>)}</div></fieldset>
            <label>Hora de salida<input required type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
            <label>Avisar si no ha salido (minutos tras la hora)<input required type="number" min={0} max={180} value={windowMinutesAfter} onChange={e => setWindowMinutesAfter(Number(e.target.value))} /></label>
          </>
        : <>
            <p className="lede-note">Empieza a seguirse el trayecto en cuanto guardes, sin esperar a ningún día ni hora concretos.</p>
            <label>Avisar si no ha salido (minutos desde ahora)<input required type="number" min={5} max={120} value={windowMinutesAfter} onChange={e => setWindowMinutesAfter(Number(e.target.value))} /></label>
          </>}
      <label>Duración estimada del trayecto en minutos (opcional)<input type="number" min={1} max={240} value={estimatedArrivalMinutes} onChange={e => setEstimatedArrivalMinutes(e.target.value)} placeholder="Ej. 20" /></label>
      {estimatedArrivalMinutes && <label>Avisar si tarda más de (minutos extra)<input type="number" min={5} max={120} value={arrivalToleranceMinutes} onChange={e => setArrivalToleranceMinutes(Number(e.target.value))} /></label>}
      {error && <div className="form-error">{error}</div>}
      <button className="primary" type="submit" disabled={busy}><Check /> {busy ? 'Guardando…' : kind === 'ONCE' ? 'Empezar ahora' : 'Guardar horario'}</button>
    </form>
  </div></div>
}

function LocationPermissionCard() {
  const [status, setStatus] = useState<RouteGuardStatus | null>(null)
  const [error, setError] = useState('')
  const refresh = () => getRouteGuardStatus().then(setStatus).catch(() => undefined)
  useEffect(() => { if (isNativeAndroid()) refresh() }, [])
  if (!isNativeAndroid()) return null

  const activateForeground = async () => {
    try { setStatus(await requestForegroundLocation()) } catch { setError('No se pudo pedir el permiso de ubicación') }
  }
  const activateBackground = async () => {
    try {
      const current = await requestBackgroundLocation()
      setStatus(current)
      if (!current.backgroundLocation) {
        window.alert('En la pantalla que se abrirá, elige "Permitir todo el tiempo" para que el seguimiento funcione con la aplicación cerrada.')
        await openLocationSettings()
      }
    } catch { setError('No se pudo pedir el permiso de ubicación') }
  }

  return <section className="profile-card">
    <h2>Ubicación</h2>
    <p>Necesaria para avisar de salida, llegada y desvío del camino.</p>
    {!status?.foregroundLocation && <button className="secondary-button" onClick={activateForeground}>Activar ubicación</button>}
    {status?.foregroundLocation && !status.backgroundLocation && <button className="secondary-button" onClick={activateBackground}>Permitir en segundo plano</button>}
    {status?.foregroundLocation && status.backgroundLocation && <div className="alerts-ready" role="status"><MapPin /><span><strong>Ubicación activada</strong><small>El seguimiento de tu ruta está listo.</small></span></div>}
    {error && <div className="form-error">{error}</div>}
  </section>
}

export function UsuarioRoutes() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { loadMyRoutes().then(r => { setRoutes(r); setLoaded(true) }).catch(() => setLoaded(true)) }, [])
  useEffect(() => {
    if (!loaded || !isNativeAndroid()) return
    const token = getSessionToken()
    if (token) void updateRouteGuardSession(token, getApiOrigin())
    void syncRouteGuardRoutes(routes)
    void registerLiveLocationToken()
  }, [loaded, routes])

  return <div className="usuario-routes">
    <LocationPermissionCard />
    <PairingCard role="USUARIO" />
    {loaded && routes.length > 0 && <div className="route-list">
      {routes.map(route => <div className="route-row" key={route.id}>
        <span className="route-row-icon"><MapPin /></span>
        <span className="route-row-text"><strong>{route.label}</strong><small>{route.schedules.length ? route.schedules.map(s => `${s.time} · ${s.days.length === 7 ? 'todos los días' : s.days.map(d => DAY_NAMES[d]).join(', ')}`).join(' · ') : 'Sin horario todavía'}</small></span>
      </div>)}
    </div>}
  </div>
}
