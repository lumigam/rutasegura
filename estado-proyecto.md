# Estado del proyecto — Ruta Segura

## Qué es esto

App Android de PLACEAT (hermana de Pastillero Virtual): una persona tutora/cuidadora programa una ruta y un horario habituales para una persona acompañada (persona con discapacidad intelectual, o hijo/a de 9-16 años), y recibe avisos de salida, llegada y desvío del camino. Novedad añadida durante el diseño: también avisará si la persona no ha llegado a la hora prevista aunque no se haya desviado (se ha quedado parada).

## Situación actual — 29 de julio de 2026

- Repositorio: [github.com/lumigam/rutasegura](https://github.com/lumigam/rutasegura), rama `main`.
- Desplegado en Easypanel (VPS Contabo), dominio `rutasegura.placeat.org` (DNS y SSL ya configurados), servicio `rutasegura` + base de datos `rutasegura-postgres`, puerto interno `3000`.
- **M1 desplegado y confirmado funcionando por el usuario** (captura de pantalla del login real en `rutasegura.placeat.org`).
- **M2 recién subido a GitHub (commit `b12bf7b`), pendiente de que el usuario le dé a "Implementar" en Easypanel para probarlo en real.**
- Historial de commits de esta sesión:
  - `dcc6b0e` — Bootstrap Ruta Segura: auth, legal/consent shell and Android skeleton (M1)
  - `b12bf7b` — Apply PLACEAT visual identity and add M2: pairing, routes and schedules

## Decisiones de arquitectura ya tomadas (no las repitas sin motivo)

- **Reutiliza la arquitectura de Pastillero Virtual** (`P:\PR\Pruebas\Pastillero Virtual`): Capacitor + React + Vite + Express + Prisma/PostgreSQL, cifrado AES-256-GCM de campos sensibles (`server/crypto.ts`, copiado literal), JWT, mismo surtido de variables de entorno.
- **Una sola app, dos roles**: `TUTOR` / `USUARIO` (no dos apps separadas), decisión explícita del usuario.
- **Vista "ver" en directo = bajo demanda**, no streaming continuo de posición. Cuando el tutor pulse "ver", se pedirá una localización puntual al móvil de la persona usuaria (FCM) y no se guardará ningún historial de trayecto — decisión tomada para minimizar la recopilación de datos (mandato explícito de PLACEAT).
- **Detección de desvío de ruta: en el dispositivo** (plugin nativo), no en el servidor — mismo motivo de privacidad.
- **Mapas**: Leaflet + OpenStreetMap (gratis, sin API key) para que el tutor dibuje la ruta. La geolocalización en segundo plano en Android (M3) usará Google Play Services de todas formas, independientemente del proveedor de mapas.
- **Identidad visual: azules de PLACEAT** (del logo real de la organización), NO los colores/tipografía de Pastillero. La primera versión reutilizó el CSS de Pastillero solo recoloreado y el usuario lo rechazó explícitamente ("cualquiera va a decir que es copiar y pegar"). Ver `src/styles.css`: tokens `--brand`, `--brand-deep`, `--brand-mid`, `--brand-light`, `--ink`, `--sub`, `--bg`, `--surface`, `--line`, con variantes clara y oscura ya definidas. Tipografía: serif de sistema (`ui-serif`/New York/Georgia) para títulos + sans de sistema para el resto — sin dependencias de fuentes externas (se quitaron `@fontsource/dm-sans` y `@fontsource/fraunces`). Layout: una sola columna centrada, minimalista, pensado para que lo use cualquier padre/madre sin fricción.
- **Nuevo tipo de aviso "retraso" (DELAYED)**: cada horario puede llevar opcionalmente una duración estimada del trayecto (`estimatedArrivalMinutes`) y un margen de tolerancia (`arrivalToleranceMinutes`). Si a esa hora + margen el trayecto no ha llegado a `ARRIVED`, se debe lanzar un aviso distinto al de desvío — cubre el caso real de que la persona se quede bloqueada por miedo/inseguridad sin salirse del camino. **Ya está modelado en el esquema** (`Schedule.estimatedArrivalMinutes/arrivalToleranceMinutes`, `TripStatus.DELAYED`, `EventType.DELAYED`) pero la lógica de comprobación en segundo plano y el envío del aviso se implementará en M4, porque depende de que existan eventos `ARRIVED` reales, y esos solo pueden generarse cuando exista el plugin nativo de geolocalización (M3).

## Lo construido — M1 (auth, legal, consentimiento)

- `prisma/schema.prisma`: `User` (rol `TUTOR`/`USUARIO`, consentimiento, timezone, código de emparejamiento), `PushSubscription`.
- `server/index.ts` + `server/crypto.ts`: registro/login/refresh/consentimiento, exportar/eliminar cuenta, suscripción de notificaciones push (VAPID, aún sin claves configuradas), middlewares `authenticate`/`consentRequired`.
- `src/App.tsx`, `src/Legal.tsx`, `src/storage.ts`, `src/notifications.ts`, `src/types.ts`, `src/icons.tsx`, `src/styles.css`: pantalla de login/registro con selector de rol, páginas legales (aviso legal, privacidad, cookies, eliminar cuenta) reescritas para datos de ubicación en vez de salud, banner de cookies, perfil con exportar/eliminar cuenta.
- Proyecto Android generado con Capacitor: `appId org.placeat.rutasegura`, `minSdk 26` (igualado a Pastillero), sin permisos de ubicación todavía.
- CI: `.github/workflows/android.yml` (build+lint del APK de depuración).

## Lo construido — M2 (emparejamiento, rutas y horarios)

- **Esquema Prisma ampliado**: `Link` (vínculo tutor↔usuario), `Route` (etiqueta cifrada, puntos del trazado en JSON, ancho del corredor de seguridad en metros), `Schedule` (días, hora de salida, ventana antes/después, duración estimada + tolerancia para el aviso de retraso), `Trip`/`TripEvent` (tabla de eventos puntuales, deliberadamente NO un historial continuo — ver decisión de privacidad arriba). Enums `TripStatus`/`EventType` incluyen ya `DELAYED`.
- **Backend** (`server/index.ts`): middlewares `tutorOnly`/`usuarioOnly`; `POST /api/pairing/code` (la persona usuaria genera un código de 6 caracteres, caduca en 15 min), `POST /api/pairing/claim` (el tutor lo canjea, crea el `Link`, código de un solo uso), `GET /api/pairing/links`, `DELETE /api/pairing/links/:usuarioId` (el tutor puede deshacer el vínculo cuando quiera; borra también las rutas/horarios de esa persona, se puede volver a vincular después con un código nuevo — el propio emparejamiento es permanente hasta que el tutor lo decida, no hay que repetir ningún código para el uso diario); CRUD de `/api/routes` (tutor, cifra `label` con `encryptValue`/`decryptValue`), `GET /api/routes/mine` (usuario, solo lectura), CRUD anidado de `/api/routes/:routeId/schedules` y `/api/schedules/:id`.
- **Frontend** (`src/Routes.tsx`, nuevo fichero): `RouteMap` (mapa Leaflet con clic para añadir puntos, círculos de radio = ancho del corredor), `PairingCard` (genera código si es `USUARIO`, canjea código si es `TUTOR`), `RoutesView` (lista de rutas del tutor + botón añadir), `RouteEditor` (modal: dibujar en el mapa, nombre, persona usuaria, ancho del corredor, activar/desactivar), `SchedulesEditor`/`ScheduleForm` (días, hora, duración estimada opcional + margen de aviso de retraso), `UsuarioRoutes` (vista de solo lectura para la persona usuaria + su código de emparejamiento).
- Pestaña "Rutas" nueva en la barra inferior, visible solo para el rol `TUTOR`.
- Dependencia añadida: `leaflet` + `@types/leaflet` (mosaicos de OpenStreetMap, sin API key).

## Identidad visual PLACEAT

- Colores extraídos del logo real de PLACEAT (marino profundo, azul medio, celeste) — no hay verde ni teal de Pastillero en ningún sitio.
- Marca geométrica propia (`BrandMark` en `src/icons.tsx`): un rombo de tres caras en los tres azules, inspirado en la "P" del logo, sin copiar su vectorial exacto.
- Se exploraron primero 3 direcciones más arriesgadas (ver artefacto `Ruta Segura — identidad PLACEAT` en esta conversación) antes de que el usuario pidiera algo más simple con los azules reales — la versión final implementada en el código es la que está en producción, no las 3 direcciones descartadas.

## Infraestructura desplegada (Easypanel)

- Proyecto Easypanel: `bd` (agrupa el servicio de la app `rutasegura` y la base de datos `rutasegura-postgres`).
- Dominio `rutasegura.placeat.org` con HTTPS, destino: servicio `rutasegura`, puerto `3000`, protocolo HTTP, ruta `/`.
- Variables de entorno ya configuradas por el usuario: `PORT`, `DATABASE_URL` (contra `rutasegura-postgres`), `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=production`. `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` se dejaron vacíos a propósito (push desactivado sin problema, todavía no hay ningún aviso real que enviar).
- Identidad de Git local para hacer commits en este equipo: `Luismi <lumigam@gmail.com>` (configuración local del repo, no global). Autenticación a GitHub ya resuelta desde antes vía GitHub CLI (`gh auth status` → logueado como `lumigam`).

## Archivos principales

- `prisma/schema.prisma` — modelo de datos completo.
- `server/index.ts` — toda la API (un solo fichero, seguimos la convención de Pastillero de no fragmentar en `server/routes/`).
- `server/crypto.ts` — cifrado AES-256-GCM (copiado literal de Pastillero).
- `src/App.tsx` — shell de la app, pestañas, login/registro, perfil.
- `src/Routes.tsx` — todo lo de emparejamiento + rutas + horarios (mapa incluido).
- `src/Legal.tsx` — páginas legales, consentimiento, banner de cookies.
- `src/storage.ts` / `src/types.ts` — cliente API y tipos compartidos.
- `src/styles.css` — sistema de diseño (tokens de color PLACEAT, tipografía, todos los componentes).
- `capacitor.config.json`, `android/` — proyecto Android (`org.placeat.rutasegura`).
- `.github/workflows/android.yml` — CI de compilación Android.

## Validaciones realizadas

- **M1**: `tsc -b` (frontend) y `tsc -p server/tsconfig.json` (backend) sin errores; `vite build` correcto; `cap sync android` correcto; navegador: login, registro con selector de rol, las 4 páginas legales y el banner de cookies renderizan bien; el servidor arranca y solo falla al conectar con Postgres (no hay base de datos local en este entorno de desarrollo) — comportamiento esperado. **Confirmado además en producción real** por el usuario (captura de `rutasegura.placeat.org` funcionando).
- **M2**: `prisma validate`/`generate` correcto; `tsc -b` y `tsc -p server/tsconfig.json` sin errores; `vite build` correcto (aviso de que el bundle supera 500 kB por Leaflet — informativo, no error; candidato a `import()` dinámico más adelante si hace falta). **No se ha podido probar el flujo real de emparejamiento/rutas en local** (sin Postgres local en este entorno) — queda pendiente probarlo contra `rutasegura.placeat.org` en cuanto el usuario redespliegue este commit.
- Nota de entorno: el servidor de desarrollo Vite mostró un bucle intermitente de recarga (HMR) en esta sesión, aparentemente por el watcher de ficheros en la unidad de red `P:\`. No afecta a la compilación de producción (verificada limpia) ni parece un fallo de la aplicación — si reaparece en otra sesión, no perder tiempo depurándolo como si fuera un bug de código; confirmar primero con `tsc`/`vite build`.

## Limitaciones conocidas / pendiente

- **M3 (siguiente paso natural)**: plugin nativo Android `RouteGuard` — geofencing con `GeofencingClient`/`FusedLocationProviderClient`, permisos `ACCESS_FINE_LOCATION`/`ACCESS_BACKGROUND_LOCATION`/`FOREGROUND_SERVICE_LOCATION`, foreground service, restauración tras reinicio. Plantilla a seguir: `P:\PR\Pruebas\Pastillero Virtual\android\app\src\main\java\org\placeat\pastillero\` (`NativeAlarmPlugin.java`, `AlarmScheduler.java`, `AlarmStore.java`, `AlarmReceiver.java`, `BootReceiver.java`, `AlarmService.java`). Añadir `com.google.android.gms:play-services-location` a `android/app/build.gradle`.
- **M4**: detección de desvío en el dispositivo (punto-a-polilínea contra el corredor), flujo "ver ahora" bajo demanda vía FCM, motor de creación de `Trip` por cada ocurrencia programada (mismo patrón que `sendScheduledNotifications` de Pastillero pero sin implementar todavía), y el envío real de los 4 avisos (salida/llegada/desvío/**retraso**) por push al tutor.
- **M5**: adaptar `docs/google-play/` y `docs/rgpd/` (aún no creados en este proyecto) siguiendo la estructura de Pastillero pero para datos de ubicación en vez de salud. Pendiente de decidir con el DPO de PLACEAT: de quién es el consentimiento cuando la persona usuaria es menor o tiene una medida de apoyo conforme a la Ley 8/2021.
- No hay iconos PNG reales (`manifest.webmanifest` referencia `/icons/icon-192.png` etc. que no existen todavía) — pendiente de recursos gráficos reales basados en `BrandMark`.
- FCM (necesario para "ver ahora" y los avisos push de M4) no está configurado todavía.
- El plan de arquitectura completo (M1 a M5, con las razones de cada decisión) sigue disponible en `C:\Users\lumig\.claude\plans\crystalline-floating-aho.md` si hace falta repasarlo.

## Fallos reales encontrados tras el primer despliegue de M2

- **El mapa salía en blanco (solo controles de zoom, sin teselas)**: la CSP de `helmet` en `server/index.ts` solo permitía `imgSrc`/`connectSrc` de `'self'`, así que el navegador bloqueaba en silencio las teselas de OpenStreetMap y las llamadas a Nominatim. **El servidor de desarrollo de Vite no aplica esta CSP** (solo existe cuando Express+helmet sirven la app), por eso no se detectó en las pruebas locales de esta sesión — para depurar bugs de red/CSP hay que probar contra el build servido por Express, no contra `vite dev`. Corregido ampliando `imgSrc` a `https://*.tile.openstreetmap.org` y `connectSrc` a `https://nominatim.openstreetmap.org`.
- **Botón de cerrar sesión sin confirmar**: el avatar de arriba a la derecha cerraba sesión al instante (heredado literal de Pastillero); un usuario lo confundió con un menú. Ahora pide confirmación (`window.confirm`).
- **Buscador de dirección en el editor de rutas**: se añadió un buscador de texto libre (calle + localidad, como Google Maps) sobre el mapa, usando Nominatim — permite ir directo al inicio de la ruta en vez de desplazar el mapa a mano.

## Pendiente de revisar mañana: el mapa sigue sin funcionar tras el fix de CSP

Tras desplegar `b5468cb` (el que amplía `imgSrc`/`connectSrc` en la CSP), el usuario confirma que el buscador de dirección ya aparece (o sea, el frontend nuevo está desplegado), **pero el mapa en sí sigue sin funcionar**. No se ha diagnosticado todavía por qué. Primera hipótesis a comprobar mañana, de más a menos probable:

1. **Caché del navegador**: si el documento HTML se sirvió y cacheó antes del despliegue del fix, el navegador podría seguir usando esa respuesta cacheada (con la CSP antigua) hasta un refresco forzado (Ctrl+Shift+R) o una pestaña de incógnito. Probar esto primero, es lo más rápido de descartar.
2. Revisar la cabecera `Content-Security-Policy` real que devuelve `rutasegura.placeat.org` (con las herramientas de red del navegador o `curl -I`) y comprobar que efectivamente incluye `https://*.tile.openstreetmap.org` en `img-src` y `https://nominatim.openstreetmap.org` en `connect-src` — confirmar que el despliegue realmente recogió el commit `b5468cb`/`1dbaba8` y no una imagen Docker en caché.
3. Si la CSP ya es correcta y sigue sin verse: mirar la consola del navegador en la propia página (no solo en local) para ver si hay un error distinto (por ejemplo, un fallo de red real, un bloqueador de contenido/adblock del propio dispositivo bloqueando `tile.openstreetmap.org`, o un problema con el tamaño del contenedor del mapa si el modal no ha terminado de montar cuando Leaflet mide el `<div>`).
4. Recordar que en local (`vite dev`) esto nunca se puede reproducir porque no hay CSP — cualquier prueba real tiene que hacerse contra el despliegue de Easypanel.

## Cómo continuar en una nueva sesión

1. Preguntar si ya se ha redesplegado el commit `b12bf7b` en Easypanel; si no, recordar al usuario que le dé a "Implementar".
2. Probar en `rutasegura.placeat.org`: crear una cuenta `USUARIO`, generar su código; crear una cuenta `TUTOR`, canjear el código; dibujar una ruta con al menos un horario (probar también la duración estimada opcional).
3. Si todo va bien, seguir con M3 (plugin nativo `RouteGuard`).
4. Recordar las tres decisiones de privacidad ya tomadas (vista bajo demanda, desvío en el dispositivo, sin historial continuo) antes de proponer alternativas — fueron decisiones explícitas del cliente (PLACEAT), no supuestos.
