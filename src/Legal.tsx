import { useEffect, useState } from 'react'
import type { UserAccount } from './types'

export type LegalKind = 'aviso-legal' | 'privacidad' | 'cookies' | 'eliminar-cuenta'

export function legalKindFromPath(pathname: string): LegalKind | null {
  const value = pathname.replace(/^\/+|\/+$/g, '')
  return value === 'aviso-legal' || value === 'privacidad' || value === 'cookies' || value === 'eliminar-cuenta' ? value : null
}

const CONTACT_LOCAL = 'comunicacion', CONTACT_DOMAIN = 'placeat.org'
function ContactEmail() { const address = `${CONTACT_LOCAL}@${CONTACT_DOMAIN}`; return <a href={`mailto:${address}`}>{address}</a> }
const Entity = () => <><strong>PLACEAT Plena Inclusión</strong>, CIF G10012136, C/ Mayorga, 1, 10600 Plasencia, teléfono 927 410 152 y correo electrónico <ContactEmail /></>

export function LegalPage({ kind }: { kind: LegalKind }) {
  const titles = { 'aviso-legal': 'Aviso legal', privacidad: 'Política de privacidad', cookies: 'Política de cookies', 'eliminar-cuenta': 'Eliminar una cuenta' }
  return <div className="legal-shell">
    <header className="legal-header"><a href="/" className="legal-brand"><img src="/icons/icon-192.png" alt="" /><span><strong>Ruta</strong><small>SEGURA</small></span></a><a href="/">Volver a la aplicación</a></header>
    <main className="legal-page">
      <p className="eyebrow">INFORMACIÓN LEGAL</p><h1>{titles[kind]}</h1><p className="legal-updated">Última actualización: 29 de julio de 2026</p>
      {kind === 'aviso-legal' && <AvisoLegal />}
      {kind === 'privacidad' && <Privacidad />}
      {kind === 'cookies' && <Cookies />}
      {kind === 'eliminar-cuenta' && <EliminarCuenta />}
    </main>
    <LegalFooter />
    <CookieBanner />
  </div>
}

function AvisoLegal() {
  return <div className="legal-content">
    <section><h2>1. Titular del servicio</h2><p>Este sitio web y la aplicación Ruta Segura son titularidad de <Entity />.</p></section>
    <section><h2>2. Objeto</h2><p>Ruta Segura permite a una persona tutora, cuidadora o familiar programar una ruta y un horario habituales, y recibir avisos de salida, llegada y desvío del camino de la persona usuaria acompañada. El acceso y uso implican la aceptación de este aviso y de las normas aplicables.</p></section>
    <section className="legal-highlight"><h2>3. Información importante sobre el servicio</h2><p>Ruta Segura es una herramienta de apoyo y aviso complementaria. <strong>No sustituye la supervisión, las medidas de seguridad ni la responsabilidad de la persona tutora o representante legal.</strong> La ubicación depende de la señal GPS, la red del dispositivo y sus permisos, y puede fallar o retrasarse. Ante una emergencia, contacta siempre con los servicios de urgencia correspondientes.</p></section>
    <section><h2>4. Uso responsable</h2><p>La persona tutora debe indicar rutas y horarios correctos, mantener en secreto sus credenciales, y utilizar el seguimiento únicamente con la autorización que corresponda respecto de la persona acompañada. No se permite utilizar el servicio con fines ilícitos, para vigilar a terceros sin autorización, acceder a cuentas ajenas ni alterar su funcionamiento.</p></section>
    <section><h2>5. Disponibilidad y responsabilidad</h2><p>PLACEAT trabaja para mantener el servicio disponible y seguro, pero Internet, los navegadores, el GPS y los dispositivos pueden sufrir interrupciones o imprecisiones. Los avisos de Ruta Segura no deben ser el único mecanismo de seguridad cuando una omisión pueda entrañar un riesgo grave. PLACEAT no responde de decisiones tomadas exclusivamente a partir de un aviso, ni de datos de ruta introducidos incorrectamente por las personas usuarias.</p></section>
    <section><h2>6. Propiedad intelectual</h2><p>El diseño, código, iconos, textos y demás elementos propios del servicio están protegidos por la normativa de propiedad intelectual. No pueden reproducirse, modificarse o explotarse fuera de los usos permitidos por la ley sin autorización.</p></section>
    <section><h2>7. Legislación</h2><p>Se aplica la legislación española. Cualquier controversia se someterá a los juzgados y tribunales que correspondan según la normativa aplicable, respetando siempre los derechos de consumidores y usuarios.</p></section>
    <section><h2>8. Normativa de referencia</h2><p>Este servicio se rige, entre otras normas aplicables, por el Reglamento General de Protección de Datos, la Ley Orgánica 3/2018 de protección de datos, la Ley 34/2002 de servicios de la sociedad de la información y, en lo relativo a la capacidad jurídica de las personas con discapacidad, la Ley 8/2021.</p></section>
  </div>
}

function Privacidad() {
  return <div className="legal-content">
    <section><h2>1. Responsable del tratamiento</h2><p>El responsable es <Entity />.</p></section>
    <section><h2>2. Datos tratados</h2><p>Tratamos datos identificativos y de cuenta (nombre, correo, contraseña protegida y rol: persona tutora o persona usuaria), datos de uso y seguridad, preferencias técnicas, y los datos de ruta, horario y ubicación estrictamente necesarios para los avisos: salida, llegada, desvío del camino, y la posición puntual que se solicite mediante la función «ver ahora».</p><p><strong>No almacenamos un historial continuo de trayectos.</strong> Solo se registran eventos puntuales (salida, llegada, desvío, o una localización expresamente solicitada), nunca un rastro permanente de posiciones.</p><p>La ubicación de una persona con discapacidad intelectual o de una persona menor de edad puede revelar patrones de vida y vulnerabilidad, por lo que la tratamos con el mismo nivel de diligencia que los datos especialmente sensibles.</p></section>
    <section><h2>3. Finalidades y bases jurídicas</h2><ul><li>Crear y gestionar la cuenta y prestar las funciones solicitadas: ejecución de la relación de servicio.</li><li>Emitir avisos de salida, llegada y desvío de ruta: interés legítimo en la seguridad de la persona acompañada, ejercido por quien tiene la responsabilidad parental, la tutela o la función de apoyo correspondiente, y consentimiento de la cuenta que activa el seguimiento.</li><li>Proteger las cuentas, prevenir abusos y mantener la seguridad: interés legítimo y cumplimiento de obligaciones legales.</li><li>Atender derechos, consultas e incidencias: cumplimiento de obligaciones y consentimiento según el caso.</li></ul></section>
    <section><h2>4. Personas con apoyo o representación</h2><p>Cuando la persona usuaria sea menor de edad o precise medidas de apoyo para el ejercicio de su capacidad jurídica conforme a la Ley 8/2021, la creación de la cuenta y la activación del seguimiento deben contar con la autorización de quien ejerza la patria potestad, la tutela o la medida de apoyo correspondiente. Quien registre una cuenta en nombre o con autorización de otra persona declara disponer de esa autorización y es responsable de mantenerla vigente.</p></section>
    <section><h2>5. Acceso y destinatarios</h2><p>No vendemos datos ni los utilizamos para publicidad. De forma excepcional, personal técnico expresamente autorizado podría acceder a la infraestructura cuando sea imprescindible para resolver una incidencia, proteger el servicio o cumplir una obligación, aplicando deber de confidencialidad y minimización.</p><p>La aplicación se aloja en un VPS europeo de <strong>Contabo</strong>, que actúa como proveedor de infraestructura y encargado del tratamiento conforme a sus condiciones de protección de datos. Easypanel es software administrado dentro del propio VPS y GitHub contiene código fuente, no la base de datos de producción.</p><p>Los avisos a la persona tutora se entregan mediante el servicio de notificaciones del navegador, del sistema operativo o de Google (FCM). El mensaje se diseña para contener el mínimo detalle necesario.</p></section>
    <section><h2>6. Transferencias internacionales</h2><p>La infraestructura principal de producción indicada por PLACEAT se encuentra en Europa. Al activar voluntariamente las notificaciones, el navegador, el sistema operativo o el proveedor de mensajería push puede utilizar su propio servicio de entrega, sujeto a las condiciones y garantías de su proveedor. Cualquier transferencia internacional se someterá a las garantías exigidas por la normativa.</p></section>
    <section><h2>7. Conservación</h2><p>Los datos de cuenta se conservarán mientras esta permanezca activa y sea necesaria para prestar el servicio. Los eventos de ruta (salida, llegada, desvío, localización puntual) se conservan solo el tiempo necesario para mostrar el aviso y no constituyen un historial permanente de movimientos. Al eliminar una cuenta se eliminan sus datos asociados, salvo información que deba bloquearse temporalmente para atender obligaciones legales o responsabilidades.</p></section>
    <section><h2>8. Derechos</h2><p>Puedes solicitar acceso, rectificación, supresión, limitación, oposición y portabilidad, o retirar tu consentimiento, escribiendo a <ContactEmail /> e indicando “Protección de datos”. Retirar el consentimiento para el seguimiento de ubicación impedirá seguir utilizando las funciones de ruta y avisos.</p><p>También puedes presentar una reclamación ante la <a href="https://www.aepd.es" target="_blank" rel="noreferrer">Agencia Española de Protección de Datos</a>.</p></section>
    <section><h2>9. Seguridad</h2><p>Aplicamos medidas técnicas y organizativas razonables, entre ellas protección irreversible de contraseñas, cifrado de los campos de ruta que identifican lugares, comunicaciones HTTPS, separación de datos por cuenta y controles de acceso. Las claves de cifrado se mantienen separadas de la base de datos. <strong>Ningún sistema conectado a Internet ni ningún dispositivo puede garantizar seguridad absoluta</strong>. PLACEAT mantiene procedimientos para evaluar riesgos y responder ante posibles incidentes o brechas de seguridad.</p></section>
    <section><h2>10. Cambios</h2><p>Podremos actualizar esta política cuando cambie el servicio o la normativa. Si el cambio afecta de forma material al tratamiento, se informará y se solicitará un nuevo consentimiento cuando resulte necesario.</p></section>
  </div>
}

function Cookies() {
  return <div className="legal-content">
    <section><h2>1. Qué utilizamos</h2><p>Ruta Segura utiliza almacenamiento local del navegador y tecnologías equivalentes de la aplicación Android para mantener la sesión, recordar decisiones y permitir la instalación como aplicación. Aunque algunas no sean cookies HTTP tradicionales, se explican aquí por transparencia.</p></section>
    <section><h2>2. Elementos técnicos necesarios</h2><div className="legal-table"><div><strong>rutasegura:session-token:v1</strong><span>localStorage · mantiene la sesión iniciada · hasta cerrar sesión o invalidarse.</span></div><div><strong>rutasegura:session-user:v1</strong><span>localStorage · evita cerrar la sesión por un fallo temporal de conexión · hasta cerrar sesión.</span></div><div><strong>rutasegura:alerts-enabled:v1</strong><span>localStorage · recuerda que se activaron los avisos · hasta desactivarlos o borrar los datos de la aplicación.</span></div><div><strong>Suscripción de notificaciones</strong><span>PushManager / FCM · permite recibir avisos de salida, llegada y desvío · hasta revocarla desde el navegador o dispositivo.</span></div><div><strong>rutasegura:cookie-consent:v1</strong><span>localStorage · conserva la elección de privacidad · máximo 24 meses.</span></div><div><strong>install-dismissed</strong><span>sessionStorage · recuerda que se cerró el aviso de instalación · durante la sesión.</span></div><div><strong>Service worker y Cache Storage</strong><span>Guarda archivos estáticos para instalación y apertura básica sin conexión.</span></div></div><p>Estos elementos son necesarios para funciones solicitadas o para guardar la elección del usuario y no requieren consentimiento opcional.</p></section>
    <section><h2>3. Analítica y publicidad</h2><p><strong>Actualmente no utilizamos cookies analíticas, publicitarias ni rastreadores de terceros.</strong> La categoría analítica del panel permanece disponible para reflejar la preferencia, pero no activa ningún proveedor. Si se incorporase uno, se actualizaría esta política antes de utilizarlo.</p></section>
    <section><h2>4. Gestionar o retirar el consentimiento</h2><p>Puedes cambiar tu elección en cualquier momento desde “Configurar cookies”, disponible al pie de todas las páginas. También puedes borrar el almacenamiento desde la configuración del navegador; hacerlo puede cerrar la sesión y restablecer preferencias.</p><button className="legal-cookie-button" onClick={openCookieSettings}>Configurar cookies</button></section>
    <section><h2>5. Normativa</h2><p>La configuración se ha diseñado conforme al artículo 22.2 de la Ley 34/2002 y a los criterios de la Guía sobre el uso de cookies de la Agencia Española de Protección de Datos.</p></section>
  </div>
}

function EliminarCuenta() {
  const deletionSubject = encodeURIComponent('Eliminar mi cuenta de Ruta Segura')
  const deletionBody = encodeURIComponent('Solicito eliminar mi cuenta de Ruta Segura y sus datos asociados.\n\nCorreo de la cuenta: ')
  return <div className="legal-content">
    <section><h2>Eliminar tu cuenta y tus datos</h2><p>Ruta Segura es una aplicación de <strong>PLACEAT Plena Inclusión</strong>. Puedes eliminar directamente tu cuenta desde la aplicación o solicitarlo aunque ya la hayas desinstalado.</p></section>
    <section><h2>Desde la aplicación</h2><ol><li>Inicia sesión.</li><li>Abre tu perfil pulsando tu nombre.</li><li>Selecciona <strong>Eliminar mi cuenta</strong>.</li><li>Confirma la operación con tu contraseña.</li></ol><p>La eliminación es definitiva.</p></section>
    <section><h2>Si no puedes acceder a la aplicación</h2><p>Envía la solicitud desde el correo asociado a tu cuenta e indica claramente que quieres eliminarla. Podremos pedirte información adicional únicamente para comprobar que la cuenta te pertenece.</p><p><a className="primary legal-delete-link" href={`mailto:${CONTACT_LOCAL}@${CONTACT_DOMAIN}?subject=${deletionSubject}&body=${deletionBody}`}>Solicitar la eliminación por correo</a></p></section>
    <section><h2>Qué datos se eliminan</h2><p>Se eliminan la cuenta, el nombre, el correo, las credenciales protegidas, los consentimientos, las rutas y horarios configurados, los eventos de aviso registrados y las suscripciones de notificaciones vinculadas.</p></section>
    <section><h2>Plazo y conservación excepcional</h2><p>Las eliminaciones realizadas dentro de la aplicación son inmediatas. Las solicitudes recibidas por correo se atenderán después de verificar la identidad y dentro del plazo legal aplicable. Solo se conservará temporalmente información cuando exista una obligación legal o sea imprescindible para atender responsabilidades, quedando bloqueada y sin utilizarse para prestar el servicio.</p></section>
  </div>
}

export function openCookieSettings() { window.dispatchEvent(new Event('rutasegura:open-cookie-settings')) }

export function LegalFooter() {
  return <footer className="legal-footer"><div><span>© 2026 PLACEAT Plena Inclusión</span><span className="footer-love">Hecho con ❤️ por <a href="https://placeat.org/" target="_blank" rel="noreferrer">PLACEAT</a></span></div><nav><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a><a href="/cookies">Cookies</a><a href="/eliminar-cuenta">Eliminar cuenta</a><button onClick={openCookieSettings}>Configurar cookies</button></nav></footer>
}

type CookieChoice = { necessary: true, analytics: boolean, decidedAt: string, version: 1 }
const COOKIE_KEY = 'rutasegura:cookie-consent:v1'

export function CookieBanner() {
  const [choice, setChoice] = useState<CookieChoice | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COOKIE_KEY) || 'null') as CookieChoice | null
      const maximumAge = 730 * 24 * 60 * 60 * 1000
      return saved?.version === 1 && Date.now() - new Date(saved.decidedAt).getTime() < maximumAge ? saved : null
    } catch { return null }
  })
  const [settings, setSettings] = useState(false)
  const [analytics, setAnalytics] = useState(choice?.analytics ?? false)
  useEffect(() => {
    const open = () => { setAnalytics(choice?.analytics ?? false); setSettings(true) }
    window.addEventListener('rutasegura:open-cookie-settings', open)
    return () => window.removeEventListener('rutasegura:open-cookie-settings', open)
  }, [choice])
  const save = (allowAnalytics: boolean) => {
    const value: CookieChoice = { necessary: true, analytics: allowAnalytics, decidedAt: new Date().toISOString(), version: 1 }
    localStorage.setItem(COOKIE_KEY, JSON.stringify(value)); setChoice(value); setSettings(false)
  }
  if (choice && !settings) return null
  if (settings) return <div className="cookie-backdrop"><section className="cookie-settings" role="dialog" aria-modal="true" aria-labelledby="cookie-title"><p className="eyebrow">TU PRIVACIDAD</p><h2 id="cookie-title">Configurar almacenamiento</h2><p>Elige qué categorías permites. Puedes cambiarlo en cualquier momento.</p><div className="cookie-option"><span><strong>Necesarias</strong><small>Sesión, seguridad, instalación y preferencias.</small></span><input type="checkbox" checked disabled aria-label="Necesarias, siempre activas" /></div><div className="cookie-option"><span><strong>Analíticas</strong><small>No se utiliza ningún proveedor actualmente.</small></span><input type="checkbox" checked={analytics} onChange={event => setAnalytics(event.target.checked)} aria-label="Permitir analíticas" /></div><div className="cookie-actions"><button onClick={() => save(false)}>Rechazar opcionales</button><button onClick={() => save(analytics)}>Guardar selección</button><button onClick={() => save(true)}>Aceptar todas</button></div><a href="/cookies">Leer la política de cookies</a></section></div>
  return <aside className="cookie-banner" aria-label="Aviso de cookies"><div><strong>Tu privacidad importa</strong><p>Usamos almacenamiento técnico para mantener tu sesión e instalar la aplicación. No utilizamos publicidad ni analítica actualmente. Puedes aceptar, rechazar o configurar tus preferencias.</p><a href="/cookies">Política de cookies</a></div><div className="cookie-banner-actions"><button onClick={() => save(false)}>Rechazar</button><button onClick={() => setSettings(true)}>Configurar</button><button onClick={() => save(true)}>Aceptar todas</button></div></aside>
}

export function ConsentScreen({ user, onConsent, onAccepted }: { user: UserAccount, onConsent: () => Promise<UserAccount>, onAccepted: (user: UserAccount) => void }) {
  const [privacy, setPrivacy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <main className="consent-page"><section><img src="/icons/icon-192.png" alt="" /><p className="eyebrow">ANTES DE CONTINUAR</p><h1>Protejamos la ubicación</h1><p>Ruta Segura guarda información sobre rutas, horarios y avisos de ubicación de la persona usuaria, que tratamos con especial cuidado. Necesitamos confirmar que comprendes y autorizas este uso.</p><label className="legal-check"><input type="checkbox" checked={privacy} onChange={e => setPrivacy(e.target.checked)} /><span>He leído la <a href="/privacidad" target="_blank">política de privacidad</a> y entiendo que esta cuenta permite programar rutas y horarios, y recibir avisos de salida, llegada y desvío basados en la ubicación de la persona usuaria. Doy mi <strong>consentimiento explícito</strong> para este tratamiento. Si actúo en nombre de otra persona (por ejemplo, como tutor/a o representante legal), declaro estar autorizado/a.</span></label>{error && <div className="form-error">{error}</div>}<button className="primary" disabled={!privacy || busy} onClick={async () => { setBusy(true); setError(''); try { onAccepted(await onConsent()) } catch { setError('No se pudo guardar el consentimiento') } finally { setBusy(false) } }}>{busy ? 'Guardando…' : 'Aceptar y continuar'}</button><LegalFooter /></section></main>
}
