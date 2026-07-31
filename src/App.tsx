import { useEffect, useState } from 'react'
import { BellRing, BrandMark, ChevronRight, Home as HomeIcon, MapPin, ShieldCheck, Trash2 } from './icons'
import { ApiError, acceptLegalConsent, currentUser, deleteOwnAccount, exportAccountData, login, logout, register } from './storage'
import { ConsentScreen, CookieBanner, LegalFooter, LegalPage, legalKindFromPath } from './Legal'
import { alertsWereEnabled, enablePushNotifications, restorePushSubscription } from './notifications'
import { RoutesView, UsuarioRoutes } from './Routes'
import { isNativeAndroid, stopRouteGuard } from './routeGuard'
import { LEGAL_CONSENT_VERSION, type UserAccount } from './types'

type Tab = 'home' | 'routes' | 'profile'

function App() {
  const legalKind = legalKindFromPath(window.location.pathname)
  const [tab, setTab] = useState<Tab>('home')
  const [user, setUser] = useState<UserAccount | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => { currentUser().then(setUser).finally(() => setAuthLoading(false)) }, [])
  useEffect(() => { if (user) void restorePushSubscription() }, [user?.id])

  if (legalKind) return <LegalPage kind={legalKind} />
  if (authLoading) return <><div className="auth-loading"><span className="brand-mark"><BrandMark /></span><strong>Ruta Segura</strong></div><CookieBanner /></>
  if (!user) return <><AuthScreen onAuthenticated={setUser} /><LegalFooter /><CookieBanner /></>
  if (!user.privacyAcceptedAt || user.consentVersion !== LEGAL_CONSENT_VERSION) return <><ConsentScreen user={user} onConsent={acceptLegalConsent} onAccepted={setUser} /><CookieBanner /></>

  const signOut = () => {
    if (!window.confirm('¿Cerrar sesión?')) return
    if (user.role === 'USUARIO' && isNativeAndroid()) void stopRouteGuard().catch(() => undefined)
    logout(); setUser(null); setTab('home')
  }
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setTab('home')} aria-label="Ir al inicio">
        <span className="brand-mark"><BrandMark width={26} height={26} /></span>
        <span><strong>Ruta</strong><small>SEGURA</small></span>
      </button>
      <button className="profile" onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><span>{user.name}</span><div>{initials}</div></button>
    </header>

    <main>
      {tab === 'home' && <HomeView user={user} />}
      {tab === 'routes' && user.role === 'TUTOR' && <RoutesView />}
      {tab === 'profile' && <ProfileView user={user} onDeleted={signOut} />}
    </main>

    <nav className="bottom-nav" aria-label="Navegación principal">
      <NavButton active={tab === 'home'} icon={<HomeIcon />} label="Inicio" onClick={() => setTab('home')} />
      {user.role === 'TUTOR' && <NavButton active={tab === 'routes'} icon={<MapPin />} label="Rutas" onClick={() => setTab('routes')} />}
      <NavButton active={tab === 'profile'} icon={<ShieldCheck />} label="Mi perfil" onClick={() => setTab('profile')} />
    </nav>

    <LegalFooter />
    <CookieBanner />
  </div>
}

function NavButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span></button>
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: UserAccount) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserAccount['role']>('TUTOR')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true)
    try { onAuthenticated(mode === 'login' ? await login(email, password) : await register(name, email, password, role, privacyAccepted)) }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'No se pudo conectar con el servidor') }
    finally { setBusy(false) }
  }
  return <main className="auth-page">
    <section className="auth-intro">
      <div className="auth-brand"><span className="brand-mark"><BrandMark width={44} height={44} /></span><span><strong>Ruta</strong><small>SEGURA</small></span></div>
      <p className="eyebrow">PLACEAT · RUTA SEGURA</p>
      <h1>Tranquilidad en cada trayecto.</h1>
      <p>Programa la ruta y el horario de siempre. Te avisamos cuando sale, cuando llega y si se aparta del camino.</p>
    </section>
    <section className="auth-card">
      <p className="eyebrow">{mode === 'login' ? 'BIENVENIDO DE NUEVO' : 'CREAR UNA CUENTA'}</p>
      <h2>{mode === 'login' ? 'Iniciar sesión' : 'Registrarme'}</h2>
      <p>{mode === 'login' ? 'Accede a tus rutas y avisos.' : 'Indica si vas a supervisar una ruta o si te van a acompañar en ella.'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <label>Nombre<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" autoComplete="name" /></label>}
        {mode === 'register' && <fieldset className="role-choice"><legend>Tipo de cuenta</legend>
          <label><input type="radio" name="role" checked={role === 'TUTOR'} onChange={() => setRole('TUTOR')} /><span><strong>Tutor/a</strong><small>Programo la ruta y recibo los avisos</small></span></label>
          <label><input type="radio" name="role" checked={role === 'USUARIO'} onChange={() => setRole('USUARIO')} /><span><strong>Persona usuaria</strong><small>Me acompañan en la ruta programada</small></span></label>
        </fieldset>}
        <label>Correo electrónico<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@ejemplo.org" autoComplete="email" /></label>
        <label>Contraseña<input required minLength={mode === 'register' ? 10 : 8} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'Mínimo 10 caracteres' : 'Tu contraseña'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <label className="legal-check"><input required type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} /><span>He leído la <a href="/privacidad" target="_blank">política de privacidad</a> y acepto el tratamiento de mis datos para crear la cuenta. Si actúo en nombre de otra persona, declaro estar autorizado.</span></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear mi cuenta'} <ChevronRight /></button>
      </form>
      <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}</button>
    </section>
  </main>
}

function HomeView({ user }: { user: UserAccount }) {
  return <div className="page home-page">
    <section className="welcome">
      <p className="eyebrow">{user.role === 'TUTOR' ? 'PANEL DE TUTOR/A' : 'MI RUTA'}</p>
      <h1>Hola, {user.name.split(' ')[0]}</h1>
      <p>{user.role === 'TUTOR'
        ? 'Ve a "Rutas" para vincular a una persona usuaria y programar su camino.'
        : 'Aquí verás el estado de tu ruta y podrás generar tu código de vinculación.'}</p>
    </section>
    {user.role === 'USUARIO' && <UsuarioRoutes />}
  </div>
}

function NotificationsCard() {
  const [enabled, setEnabled] = useState(alertsWereEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const [message, setMessage] = useState('')
  const activate = async () => {
    setMessage('')
    const result = await enablePushNotifications()
    if (result.push) { setEnabled(true); return }
    setEnabled(false)
    if (result.reason === 'denied') setMessage('Has bloqueado los avisos para esta app en el navegador. Actívalos en los ajustes del sitio para recibirlos.')
    else if (result.reason === 'unsupported') setMessage('Este navegador no admite avisos push.')
    else if (result.reason === 'server') setMessage('Los avisos todavía no están disponibles en el servidor. Inténtalo más tarde.')
  }
  return <section className="profile-card">
    <h2>Avisos</h2>
    <p>Recibe un aviso cuando salga, llegue, se desvíe o se retrase en una ruta programada.</p>
    {enabled
      ? <div className="alerts-ready" role="status"><BellRing /><span><strong>Avisos activados</strong><small>Te avisaremos en este dispositivo.</small></span></div>
      : <button className="secondary-button" onClick={activate}>Activar avisos</button>}
    {message && <div className="form-error">{message}</div>}
  </section>
}

function ProfileView({ user, onDeleted }: { user: UserAccount, onDeleted: () => void }) {
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const removeAccount = async () => {
    if (!window.confirm('¿Eliminar definitivamente tu cuenta y sus datos asociados? Esta acción no se puede deshacer.')) return
    setBusy(true); setError('')
    try { await deleteOwnAccount(password); onDeleted() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la cuenta') }
    finally { setBusy(false) }
  }
  return <div className="page inner-page profile-page">
    <div className="inner-heading"><div><p className="eyebrow">MI CUENTA</p><h1>{user.name}</h1><p>{user.email}</p></div></div>
    <NotificationsCard />
    <section className="profile-card"><h2>Descargar mis datos</h2><p>Obtén una copia en formato JSON de los datos de tu cuenta.</p><button className="secondary-button" onClick={() => exportAccountData().catch(() => setError('No se pudo generar la descarga'))}>Descargar mis datos</button></section>
    <section className="profile-card danger-zone"><h2>Eliminar mi cuenta</h2><p>Se eliminarán definitivamente la cuenta y los datos asociados. Escribe tu contraseña para confirmar.</p><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña actual" /><button className="danger" disabled={password.length < 8 || busy} onClick={removeAccount}><Trash2 /> {busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button></section>
    {error && <div className="form-error">{error}</div>}
  </div>
}

export default App
