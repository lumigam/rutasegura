import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Check, ChevronRight, Locate, MapPin, Plus, Trash2, X } from './icons'
import {
  calculateDirections, claimPairingCode, createRoute, createSchedule, deleteRoute, deleteSchedule,
  generatePairingCode, getApiOrigin, getDirectionsConfig, getLiveConfig, getSessionToken, loadLinkedUsuarios, loadMyRoutes, loadRoutes,
  loadRouteActivity, pollLiveLocation, requestLiveLocation, unlinkUsuario, updateRoute, updateSchedule,
  type RouteActivity, type ScheduleInput, type Trip, type TripEvent,
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
type MapMarker = { point: LatLng, label: string }
type ResultAction = { label: string, onPick: (point: LatLng, name: string) => void }

/** Leaflet stroke width is in pixels, so a corridor expressed in metres has to be re-derived whenever the zoom changes. */
function corridorPixelWidth(map: L.Map, meters: number, lat: number) {
  const metersPerPixel = 40075016.686 * Math.abs(Math.cos(lat * Math.PI / 180)) / Math.pow(2, map.getZoom() + 8)
  return Math.min(Math.max((meters * 2) / metersPerPixel, 11), 1000)
}

function RouteMap({ points, markers, corridorWidthMeters, editable, onAddPoint, resultActions }: {
  points: LatLng[], markers: MapMarker[], corridorWidthMeters: number,
  editable: boolean, onAddPoint?: (point: LatLng) => void, resultActions?: ResultAction[],
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const onAddPointRef = useRef(onAddPoint)
  onAddPointRef.current = onAddPoint
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [matched, setMatched] = useState('')

  const centreOn = (result: SearchResult) => {
    const precise = ['house', 'building', 'residential', 'road', 'pedestrian', 'address'].includes(result.type)
    mapRef.current?.setView([Number(result.lat), Number(result.lon)], precise ? 17 : 14)
    setMatched(precise ? `Mostrando: ${result.display_name}` : `Solo se ha encontrado la localidad: ${result.display_name}. Acerca el mapa y toca el punto exacto.`)
  }

  const search = async () => {
    if (!query.trim() || searching) return
    setSearching(true); setSearchError(''); setResults([]); setMatched('')
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=es&limit=6&q=${encodeURIComponent(query)}`)
      const found = await response.json() as SearchResult[]
      if (!found.length) { setSearchError('No se ha encontrado ese lugar. Prueba con "calle, número, localidad".'); return }
      setResults(found)
      centreOn(found[0])
    } catch { setSearchError('No se pudo buscar el lugar') }
    finally { setSearching(false) }
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
    const draw = () => {
      layer.clearLayers()
      const latlngs = points.map(p => [p.lat, p.lng]) as [number, number][]
      if (latlngs.length > 1) {
        // The safety corridor is one continuous band under the route, never one circle per point:
        // an auto-generated car route has hundreds of points and would bury the map.
        L.polyline(latlngs, { color: '#3f74b3', weight: corridorPixelWidth(map, corridorWidthMeters, points[0].lat), opacity: .18, lineCap: 'round', lineJoin: 'round' }).addTo(layer)
        L.polyline(latlngs, { color: '#16305c', weight: 4, opacity: .9 }).addTo(layer)
      }
      markers.forEach(marker => {
        L.marker([marker.point.lat, marker.point.lng], {
          icon: L.divIcon({ className: 'route-pin', html: `<span>${marker.label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(layer)
      })
    }
    draw()
    map.on('zoomend', draw)
    return () => { map.off('zoomend', draw) }
  }, [points, markers, corridorWidthMeters])

  const fittedRef = useRef('')
  useEffect(() => {
    const map = mapRef.current
    if (!map || points.length < 2) return
    const key = `${points.length}:${points[0].lat},${points[0].lng}:${points[points.length - 1].lat},${points[points.length - 1].lng}`
    if (fittedRef.current === key) return
    fittedRef.current = key
    map.fitBounds(points.map(p => [p.lat, p.lng]) as [number, number][], { padding: [30, 30] })
  }, [points])

  return <>
    {/* Deliberately not a <form>: this sits inside the route editor's form and nesting forms is invalid HTML
        (pressing Enter here would submit the outer form and create the route half-finished). */}
    {editable && <div className="map-search">
      <input value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
        placeholder="Ej. Calle Mayorga 1, Plasencia" name="route-map-search-query"
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
      <button type="button" onClick={() => void search()} disabled={searching}>{searching ? '…' : 'Buscar'}</button>
    </div>}
    {searchError && <div className="form-error">{searchError}</div>}
    {results.length > 0 && <ul className="search-results">
      {results.map((result, index) => <li key={index}>
        <button type="button" className="search-result-name" onClick={() => centreOn(result)}>{result.display_name}</button>
        {resultActions?.map(action => <button key={action.label} type="button" className="search-result-action"
          onClick={() => { action.onPick({ lat: Number(result.lat), lng: Number(result.lon) }, result.display_name); setResults([]); setMatched('') }}>{action.label}</button>)}
      </li>)}
    </ul>}
    {matched && <p className="map-matched">{matched}</p>}
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
  const [viewing, setViewing] = useState<Route | null>(null)
  const [error, setError] = useState('')

  const refresh = () => Promise.all([loadLinkedUsuarios(), loadRoutes()]).then(([u, r]) => {
    setUsuarios(u); setRoutes(r); setLoaded(true)
    setViewing(current => current ? r.find(route => route.id === current.id) ?? null : null)
  })
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
      {routes.map(route => <button className="route-row" key={route.id} onClick={() => setViewing(route)}>
        <span className="route-row-icon"><MapPin /></span>
        <span className="route-row-text"><strong>{route.label}</strong><small>{usuarios.find(u => u.id === route.usuarioId)?.name ?? 'Persona usuaria'} · {route.mode === 'CAR' ? 'en coche' : 'a pie'} · {route.schedules.length ? route.schedules.map(scheduleSummary).join(' · ') : 'sin horario'}</small></span>
        <ChevronRight />
      </button>)}
    </div>}
    {loaded && routes.length === 0 && usuarios.length > 0 && <div className="large-empty"><MapPin /><h2>Aún no hay rutas</h2><p>Añade la primera para empezar a recibir avisos.</p><button className="primary" onClick={() => setEditing('new')}><Plus /> Añadir ruta</button></div>}
    {viewing && !editing && <RouteDetail
      route={viewing}
      usuario={usuarios.find(u => u.id === viewing.usuarioId)}
      onClose={() => setViewing(null)}
      onEdit={() => setEditing(viewing)}
    />}
    {editing && <RouteEditor initial={editing === 'new' ? null : editing} usuarios={usuarios} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
  </div>
}

const TRIP_STATUS: Record<Trip['status'], { label: string, tone: 'ok' | 'warn' | 'idle' | 'live' }> = {
  NOT_STARTED: { label: 'Aún no ha salido', tone: 'idle' },
  IN_PROGRESS: { label: 'En camino', tone: 'live' },
  ARRIVED: { label: 'Ha llegado', tone: 'ok' },
  DEVIATED: { label: 'Se ha apartado del camino', tone: 'warn' },
  DELAYED: { label: 'Va con retraso', tone: 'warn' },
  CANCELLED: { label: 'Cancelado', tone: 'idle' },
}
const EVENT_LABEL: Record<TripEvent['type'], string> = {
  DEPARTED: 'Salió', ARRIVED: 'Llegó', DEVIATED: 'Se apartó del camino',
  DELAYED: 'Aviso de retraso', SOS: 'Aviso de ayuda', LOCATE_RESPONSE: 'Envió su ubicación',
}
const shortTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const scheduleSummary = (schedule: Schedule) => schedule.kind === 'ONCE'
  ? 'Trayecto puntual, de una sola vez'
  : `${schedule.time} · ${schedule.days.length === 7 ? 'todos los días' : schedule.days.map(d => DAY_NAMES[d]).join(', ')}`

function RouteDetail({ route, usuario, onClose, onEdit }: { route: Route, usuario: LinkedUsuario | undefined, onClose: () => void, onEdit: () => void }) {
  const [activity, setActivity] = useState<RouteActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [showLive, setShowLive] = useState(false)

  useEffect(() => { loadRouteActivity(route.id).then(setActivity).catch(() => undefined).finally(() => setLoading(false)) }, [route.id])
  useEffect(() => { getLiveConfig().then(c => setLiveEnabled(c.enabled)).catch(() => undefined) }, [])

  const trip = activity?.trips[0]
  const status = trip ? TRIP_STATUS[trip.status] : null
  const markers: MapMarker[] = route.points.length > 1
    ? [{ point: route.points[0], label: 'A' }, { point: route.points[route.points.length - 1], label: 'B' }]
    : []

  return <div className="modal-backdrop" role="presentation"><div className="sheet route-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <div className="sheet-head"><button onClick={onClose} aria-label="Cerrar"><X /></button><div><p className="eyebrow">RUTA</p><h1 id="detail-title">{route.label}</h1></div><span /></div>
    <div className="route-editor-body">
      <p className="detail-meta">{usuario?.name ?? 'Persona usuaria'} · {route.mode === 'CAR' ? 'En coche' : 'A pie'} · margen de {route.corridorWidthMeters} m{route.active ? '' : ' · ruta pausada'}</p>

      {loading
        ? <p className="lede-note">Cargando el estado…</p>
        : status
          ? <div className={`trip-status trip-${status.tone}`}>
              <strong>{status.label}</strong>
              <small>{trip?.startedAt ? `Salió a las ${shortTime(trip.startedAt)}` : 'Sin salida registrada todavía'}{trip?.endedAt ? ` · llegó a las ${shortTime(trip.endedAt)}` : ''}</small>
            </div>
          : <div className="trip-status trip-idle"><strong>Sin actividad reciente</strong><small>Aquí verás lo que ocurra en el próximo trayecto.</small></div>}

      {liveEnabled && usuario && <button type="button" className="primary" style={{ width: '100%', marginBottom: 18 }} onClick={() => setShowLive(true)}>
        <Locate /> Ver dónde está ahora
      </button>}

      <RouteMap points={route.points} markers={markers} corridorWidthMeters={route.corridorWidthMeters} editable={false} />

      <h2 className="detail-heading">Horarios</h2>
      <div className="schedule-list">
        {route.schedules.length
          ? route.schedules.map(schedule => <div className="schedule-row" key={schedule.id}>
              <div><strong>{schedule.kind === 'ONCE' ? 'Puntual' : schedule.time}</strong><span>{scheduleSummary(schedule)}</span></div>
              {!schedule.active && <span className="schedule-note">Desactivado</span>}
            </div>)
          : <p className="lede-note">Esta ruta no tiene ningún horario.</p>}
      </div>

      {trip && trip.events.length > 0 && <>
        <h2 className="detail-heading">Lo que ha pasado</h2>
        <ul className="event-list">
          {trip.events.map(event => <li key={event.id}><span>{shortTime(event.createdAt)}</span>{EVENT_LABEL[event.type]}</li>)}
        </ul>
      </>}

      <div className="form-actions" style={{ marginTop: 22 }}>
        <button type="button" className="primary" onClick={onEdit}>Editar ruta</button>
      </div>
    </div>
    {showLive && usuario && <LiveLocationModal usuario={usuario} onClose={() => setShowLive(false)} />}
  </div></div>
}

type Endpoint = { point: LatLng, name: string }
const coordName = (point: LatLng) => `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`

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
  const [origin, setOrigin] = useState<Endpoint | null>(null)
  const [destination, setDestination] = useState<Endpoint | null>(null)
  const [summary, setSummary] = useState('')
  useEffect(() => { getDirectionsConfig().then(c => setDirectionsEnabled(c.enabled)).catch(() => undefined) }, [])

  // A brand-new route also captures its first schedule here, so "puntual o programada" is visible while creating it
  // instead of being hidden behind a save the tutor may never reach.
  const [scheduleKind, setScheduleKind] = useState<Schedule['kind']>('WEEKLY')
  const [days, setDays] = useState<Weekday[]>([1, 2, 3, 4, 5])
  const [time, setTime] = useState('18:00')
  const [windowMinutesAfter, setWindowMinutesAfter] = useState(45)
  const [estimatedArrivalMinutes, setEstimatedArrivalMinutes] = useState('')
  const toggleDay = (day: Weekday) => setDays(current => current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort())

  const setMode = (next: TravelMode) => {
    setModeState(next)
    if (!savedRouteId) setCorridorWidthMeters(next === 'CAR' ? 250 : 75)
  }

  const runDirections = async (from: Endpoint, to: Endpoint) => {
    setCalculating(true); setError(''); setSummary('')
    try {
      const result = await calculateDirections(mode, from.point, to.point)
      setPoints(result.points)
      const km = result.distanceMeters != null ? (result.distanceMeters / 1000).toFixed(1) : null
      const min = result.durationSeconds != null ? Math.round(result.durationSeconds / 60) : null
      setSummary(km && min ? `Ruta calculada: ${km} km · unos ${min} min ${mode === 'CAR' ? 'en coche' : 'a pie'}.` : 'Ruta calculada.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo calcular la ruta')
      setPoints([])
    } finally { setCalculating(false) }
  }
  const setEndpoint = (which: 'origin' | 'destination', endpoint: Endpoint | null) => {
    const nextOrigin = which === 'origin' ? endpoint : origin
    const nextDestination = which === 'destination' ? endpoint : destination
    if (which === 'origin') setOrigin(endpoint); else setDestination(endpoint)
    setSummary(''); setPoints([])
    if (nextOrigin && nextDestination) void runDirections(nextOrigin, nextDestination)
  }

  const handleMapClick = (point: LatLng) => {
    if (drawMode === 'manual') { setPoints(current => [...current, point]); return }
    if (!origin) setEndpoint('origin', { point, name: coordName(point) })
    else if (!destination) setEndpoint('destination', { point, name: coordName(point) })
  }
  const switchDrawMode = (next: 'manual' | 'auto') => {
    if (next === drawMode) return
    setDrawMode(next); setPoints([]); setOrigin(null); setDestination(null); setError(''); setSummary('')
  }

  const markers: MapMarker[] = drawMode === 'auto'
    ? [...(origin ? [{ point: origin.point, label: 'A' }] : []), ...(destination ? [{ point: destination.point, label: 'B' }] : [])]
    : points.map((point, index) => ({ point, label: String(index + 1) }))
  const mapPoints = drawMode === 'auto' && points.length === 0 && origin && destination ? [origin.point, destination.point] : points

  const saveRoute = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!usuarioId) { setError('Selecciona a la persona usuaria'); return }
    if (points.length < 2) { setError(drawMode === 'auto' ? 'Marca el origen y el destino para calcular la ruta' : 'Marca al menos dos puntos en el mapa'); return }
    if (!savedRouteId && scheduleKind === 'WEEKLY' && !days.length) { setError('Selecciona al menos un día'); return }
    setBusy(true); setError('')
    try {
      if (savedRouteId) {
        const saved = await updateRoute(savedRouteId, { label, points, mode, corridorWidthMeters, active })
        setSchedules(saved.schedules)
        onSaved()
        return
      }
      const saved = await createRoute({ usuarioId, label, points, mode, corridorWidthMeters })
      const base = { estimatedArrivalMinutes: estimatedArrivalMinutes ? Number(estimatedArrivalMinutes) : null, arrivalToleranceMinutes: 20, active: true }
      await createSchedule(saved.id, scheduleKind === 'ONCE'
        ? { kind: 'ONCE', windowMinutesBefore: 0, windowMinutesAfter, ...base }
        : { kind: 'WEEKLY', days, time, windowMinutesBefore: 15, windowMinutesAfter, ...base })
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la ruta'); setBusy(false) }
  }

  const removeRoute = async () => {
    if (!savedRouteId || !window.confirm('¿Eliminar esta ruta y sus horarios?')) return
    await deleteRoute(savedRouteId)
    onSaved()
  }

  return <div className="modal-backdrop" role="presentation"><div className="sheet route-sheet" role="dialog" aria-modal="true" aria-labelledby="route-title">
    <div className="sheet-head"><button onClick={onClose} aria-label="Cerrar"><X /></button><div><p className="eyebrow">RUTA</p><h1 id="route-title">{initial ? 'Editar ruta' : 'Nueva ruta'}</h1></div><span /></div>
    <div className="route-editor-body">
    <form onSubmit={saveRoute}>

      <section className="editor-step">
        <h2><span className="step-number">1</span> ¿Cómo se hace el trayecto?</h2>
        <div className="option-toggle">
          <button type="button" className={mode === 'WALK' ? 'selected' : ''} onClick={() => setMode('WALK')}>A pie</button>
          <button type="button" className={mode === 'CAR' ? 'selected' : ''} onClick={() => setMode('CAR')}>En coche</button>
        </div>
      </section>

      <section className="editor-step">
        <h2><span className="step-number">2</span> El camino</h2>
        {directionsEnabled && <div className="option-toggle" role="group" aria-label="Cómo marcar el camino">
          <button type="button" className={drawMode === 'auto' ? 'selected' : ''} onClick={() => switchDrawMode('auto')}>De un punto a otro</button>
          <button type="button" className={drawMode === 'manual' ? 'selected' : ''} onClick={() => switchDrawMode('manual')}>Dibujarlo a mano</button>
        </div>}

        {drawMode === 'auto' ? <>
          <p className="lede-note">Busca una dirección y pulsa <strong>A</strong> para el origen o <strong>B</strong> para el destino. También puedes tocar el mapa directamente.</p>
          <div className="endpoint-list">
            <div className="endpoint-row">
              <span className="endpoint-badge">A</span>
              <span className="endpoint-text">{origin ? origin.name : <em>Sin origen todavía</em>}</span>
              {origin && <button type="button" className="text-button" onClick={() => setEndpoint('origin', null)}>Quitar</button>}
            </div>
            <div className="endpoint-row">
              <span className="endpoint-badge">B</span>
              <span className="endpoint-text">{destination ? destination.name : <em>Sin destino todavía</em>}</span>
              {destination && <button type="button" className="text-button" onClick={() => setEndpoint('destination', null)}>Quitar</button>}
            </div>
          </div>
        </> : <p className="lede-note">Busca el punto de partida y ve tocando el mapa para marcar el camino, punto a punto.</p>}

        <RouteMap
          points={mapPoints} markers={markers} corridorWidthMeters={corridorWidthMeters} editable
          onAddPoint={handleMapClick}
          resultActions={drawMode === 'auto' ? [
            { label: 'A', onPick: (point, name) => setEndpoint('origin', { point, name }) },
            { label: 'B', onPick: (point, name) => setEndpoint('destination', { point, name }) },
          ] : undefined}
        />

        {calculating && <p className="lede-note">Calculando la ruta…</p>}
        {summary && <p className="route-summary">{summary}</p>}
        <div className="route-map-actions">
          {drawMode === 'manual'
            ? <button type="button" className="text-button" onClick={() => setPoints(current => current.slice(0, -1))} disabled={!points.length}>Deshacer último punto</button>
            : <button type="button" className="text-button" onClick={() => { setOrigin(null); setDestination(null); setPoints([]); setSummary('') }} disabled={!origin && !destination}>Empezar de nuevo</button>}
          <button type="button" className="text-button" onClick={() => { setPoints([]); setOrigin(null); setDestination(null); setSummary('') }} disabled={!points.length && !origin && !destination}>Borrar todo</button>
        </div>
        <label>Ancho del margen de seguridad (metros)
          <input required type="number" min={10} max={500} value={corridorWidthMeters} onChange={e => setCorridorWidthMeters(Number(e.target.value))} />
          <small className="field-hint">Se avisa de desvío si se aleja más de esta distancia del camino. {mode === 'CAR' ? 'En coche conviene un margen amplio (200-300 m).' : 'A pie suele bastar con 50-100 m.'}</small>
        </label>
      </section>

      <section className="editor-step">
        <h2><span className="step-number">3</span> Datos</h2>
        <label>Nombre de la ruta<input required value={label} onChange={e => setLabel(e.target.value)} placeholder="Ej. Centro de día → Casa" /></label>
        <label>Persona usuaria<select required value={usuarioId} onChange={e => setUsuarioId(e.target.value)} disabled={Boolean(savedRouteId)}>
          <option value="" disabled>Selecciona…</option>
          {usuarios.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></label>
        {savedRouteId && <label className="switch-row"><span><strong>Ruta activa</strong><small>Una ruta pausada no genera avisos</small></span><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><i /></label>}
      </section>

      {!savedRouteId && <section className="editor-step">
        <h2><span className="step-number">4</span> ¿Cuándo?</h2>
        <div className="option-toggle">
          <button type="button" className={scheduleKind === 'ONCE' ? 'selected' : ''} onClick={() => setScheduleKind('ONCE')}>Ahora mismo</button>
          <button type="button" className={scheduleKind === 'WEEKLY' ? 'selected' : ''} onClick={() => setScheduleKind('WEEKLY')}>Todas las semanas</button>
        </div>
        {scheduleKind === 'ONCE'
          ? <p className="lede-note">Trayecto de una sola vez: empieza a vigilarse en cuanto guardes y se apaga solo al llegar.</p>
          : <>
              <fieldset><legend>Días</legend><div className="days">{ALL_DAYS.map(day => <button type="button" key={day} className={days.includes(day) ? 'selected' : ''} onClick={() => toggleDay(day)}>{DAY_NAMES[day]}</button>)}</div></fieldset>
              <label>Hora de salida<input required type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
            </>}
        <label>Avisar si no ha salido pasados (minutos)<input required type="number" min={5} max={180} value={windowMinutesAfter} onChange={e => setWindowMinutesAfter(Number(e.target.value))} /></label>
        <label>Duración estimada del trayecto en minutos (opcional)
          <input type="number" min={1} max={240} value={estimatedArrivalMinutes} onChange={e => setEstimatedArrivalMinutes(e.target.value)} placeholder="Ej. 20" />
          <small className="field-hint">Si la indicas, también se avisa cuando tarda más de la cuenta en llegar.</small>
        </label>
      </section>}

      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || calculating}><Check /> {busy ? 'Guardando…' : savedRouteId ? 'Guardar cambios' : 'Crear ruta'}</button>
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
