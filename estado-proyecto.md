# Estado del proyecto — Ruta Segura

## Qué es esto

App Android de PLACEAT (hermana de Pastillero Virtual): una persona tutora/cuidadora programa una ruta y un horario habituales para una persona acompañada (persona con discapacidad intelectual, o hijo/a de 9-16 años), y recibe avisos de salida, llegada y desvío del camino. Novedad añadida durante el diseño: también avisará si la persona no ha llegado a la hora prevista aunque no se haya desviado (se ha quedado parada).

## Situación actual — 30 de julio de 2026 (final del día)

- Repositorio: [github.com/lumigam/rutasegura](https://github.com/lumigam/rutasegura), rama `main`, último commit `8ce28d1`.
- Desplegado en Easypanel (VPS Contabo), dominio `rutasegura.placeat.org` (DNS y SSL ya configurados), servicio `rutasegura` + base de datos `rutasegura-postgres`, puerto interno `3000`.
- **M1 y M2 desplegados y verificados en real** por el usuario (login, emparejamiento, dibujo de rutas con el mapa, todo probado en `rutasegura.placeat.org`).
- **M3 (plugin nativo `RouteGuard`) y M4 (motor de avisos)**: código completo, subido (commit `8ce28d1`), compila limpio tanto en la CI de GitHub Actions como en local (ver sección de compilación local más abajo). **El APK de depuración ya se ha instalado correctamente en el teléfono del usuario** — pendiente solo la prueba funcional real (permisos, geovallas al caminar, servicio en primer plano, avisos).
- **IMPORTANTE — el backend de `rutasegura.placeat.org` TODAVÍA NO se ha redesplegado con el commit `8ce28d1`.** El usuario no pudo darle a "Implementar" en Easypanel hoy por un imprevisto suyo, y yo (el asistente) **no tengo ningún acceso a Easypanel ni al VPS** (ni token de API ni SSH) para hacerlo en su lugar — si se necesita en el futuro, hay que darme credenciales explícitas y decirme exactamente qué ejecutar. **Mientras no se redespliegue, cualquier evento que el plugin nativo intente enviar a `/api/trips/events` fallará (esa ruta no existe todavía en el servidor en producción)** — se puede probar la parte de permisos/UI del móvil, pero no el ciclo completo hasta que el servidor esté al día.
- Historial de commits relevantes: `dcc6b0e` (M1), `b12bf7b` (identidad PLACEAT + M2), `8ce28d1` (M3+M4). El historial completo está en GitHub.
- **Icono real de la app generado y verificado** (ver sección dedicada más abajo) — el APK ya no lleva el icono genérico de plantilla de Android Studio, lleva el `BrandMark` real de la marca. Pendiente de commitear (los ficheros están generados en el árbol de trabajo pero no subidos todavía).
- **"Ver ahora" (ubicación bajo demanda vía Firebase/FCM) implementado de punta a punta** (backend, plugin nativo, UI del tutor) — ver sección dedicada más abajo. Compila limpio en local pero **no se ha podido probar en un dispositivo real todavía**: falta que el usuario genere la clave de cuenta de servicio de Firebase y que se redespliegue el backend. Tampoco comiteado todavía.

## Decisiones de arquitectura ya tomadas (no las repitas sin motivo)

- **Reutiliza la arquitectura de Pastillero Virtual** (`P:\PR\Pruebas\Pastillero Virtual`): Capacitor + React + Vite + Express + Prisma/PostgreSQL, cifrado AES-256-GCM de campos sensibles (`server/crypto.ts`, copiado literal), JWT, mismo surtido de variables de entorno.
- **Una sola app, dos roles**: `TUTOR` / `USUARIO` (no dos apps separadas), decisión explícita del usuario.
- **Vista "ver" en directo = bajo demanda**, no streaming continuo de posición. Cuando el tutor pulse "ver", se pedirá una localización puntual al móvil de la persona usuaria (FCM) y no se guardará ningún historial de trayecto — decisión tomada para minimizar la recopilación de datos (mandato explícito de PLACEAT).
- **Detección de desvío de ruta: en el dispositivo** (plugin nativo), no en el servidor — mismo motivo de privacidad.
- **Mapas**: Leaflet + OpenStreetMap (gratis, sin API key) para que el tutor dibuje la ruta. La geolocalización en segundo plano en Android (M3) usará Google Play Services de todas formas, independientemente del proveedor de mapas.
- **Identidad visual: azules de PLACEAT** (del logo real de la organización), NO los colores/tipografía de Pastillero. La primera versión reutilizó el CSS de Pastillero solo recoloreado y el usuario lo rechazó explícitamente ("cualquiera va a decir que es copiar y pegar"). Ver `src/styles.css`: tokens `--brand`, `--brand-deep`, `--brand-mid`, `--brand-light`, `--ink`, `--sub`, `--bg`, `--surface`, `--line`, con variantes clara y oscura ya definidas. Tipografía: serif de sistema (`ui-serif`/New York/Georgia) para títulos + sans de sistema para el resto — sin dependencias de fuentes externas (se quitaron `@fontsource/dm-sans` y `@fontsource/fraunces`). Layout: una sola columna centrada, minimalista, pensado para que lo use cualquier padre/madre sin fricción.
- **Nuevo tipo de aviso "retraso" (DELAYED)**: cada horario puede llevar opcionalmente una duración estimada del trayecto (`estimatedArrivalMinutes`) y un margen de tolerancia (`arrivalToleranceMinutes`). Si a esa hora + margen el trayecto no ha llegado a `ARRIVED`, se debe lanzar un aviso distinto al de desvío — cubre el caso real de que la persona se quede bloqueada por miedo/inseguridad sin salirse del camino. **Ya está modelado en el esquema** (`Schedule.estimatedArrivalMinutes/arrivalToleranceMinutes`, `TripStatus.DELAYED`, `EventType.DELAYED`) pero la lógica de comprobación en segundo plano y el envío del aviso se implementará en M4, porque depende de que existan eventos `ARRIVED` reales, y esos solo pueden generarse cuando exista el plugin nativo de geolocalización (M3).
  - **Refinamiento del usuario (30 de julio)**: en realidad son **dos avisos distintos**, y el segundo debe calcularse desde la hora *real* de salida, no la programada, para no disparar en falso cuando ya salió tarde:
    1. **"No ha salido"**: si a los `windowMinutesAfter` minutos de `Schedule.time` no existe un evento `DEPARTED` para el `Trip` de hoy → aviso.
    2. **"Retraso en la llegada"**: `plazo = (Trip.startedAt ?? scheduledFor) + estimatedArrivalMinutes + arrivalToleranceMinutes` (usa la hora *real* de salida si ya existe, si no la programada como respaldo). Si se supera `plazo` sin evento `ARRIVED` → aviso, y el texto debería reflejar el contexto, ej.: "Aún no ha llegado. Salió X min tarde, así que se esperaba sobre las Y". No hace falta ningún cambio de esquema para esto — `Trip.startedAt` ya existe justo para poder hacer este cálculo.

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
- ~~No hay iconos PNG reales...~~ **Resuelto el 30 de julio** — ver sección dedicada más abajo.
- ~~FCM (necesario para "ver ahora"...) no está configurado todavía.~~ **Implementado el 30 de julio** — ver sección dedicada. Falta la clave de cuenta de servicio + redespliegue para que funcione en producción.
- El plan de arquitectura completo (M1 a M5, con las razones de cada decisión) sigue disponible en `C:\Users\lumig\.claude\plans\crystalline-floating-aho.md` si hace falta repasarlo.

## Fallos reales encontrados tras el primer despliegue de M2

- **El mapa salía en blanco (solo controles de zoom, sin teselas)**: la CSP de `helmet` en `server/index.ts` solo permitía `imgSrc`/`connectSrc` de `'self'`, así que el navegador bloqueaba en silencio las teselas de OpenStreetMap y las llamadas a Nominatim. **El servidor de desarrollo de Vite no aplica esta CSP** (solo existe cuando Express+helmet sirven la app), por eso no se detectó en las pruebas locales de esta sesión — para depurar bugs de red/CSP hay que probar contra el build servido por Express, no contra `vite dev`. Corregido ampliando `imgSrc` a `https://*.tile.openstreetmap.org` y `connectSrc` a `https://nominatim.openstreetmap.org`.
- **Botón de cerrar sesión sin confirmar**: el avatar de arriba a la derecha cerraba sesión al instante (heredado literal de Pastillero); un usuario lo confundió con un menú. Ahora pide confirmación (`window.confirm`).
- **Buscador de dirección en el editor de rutas**: se añadió un buscador de texto libre (calle + localidad, como Google Maps) sobre el mapa, usando Nominatim — permite ir directo al inicio de la ruta en vez de desplazar el mapa a mano.

## Resuelto: el mapa no se veía tras el fix de CSP por caché del navegador

Confirmado por el usuario: era exactamente la hipótesis nº1 (caché del navegador con la CSP antigua). Con un refresco forzado (Ctrl+Shift+R) el mapa ya funciona correctamente contra `rutasegura.placeat.org`. No hace falta ninguna acción de código adicional por esto — el mapa, el buscador de dirección y el dibujo de la ruta quedan verificados en producción.

## M3 (plugin nativo RouteGuard) y M4 (motor de avisos) — 30 de julio de 2026

Construidos y subidos (`8ce28d1`). Sin Firebase — "ver ahora" queda deliberadamente fuera de esta pasada (PLACEAT no tiene proyecto Firebase todavía); todo lo demás no necesita ningún servicio externo nuevo.

- **M3 — plugin nativo `RouteGuard`** (`android/app/src/main/java/org/placeat/rutasegura/`): calcado del plugin `NativeAlarms` de Pastillero (mismo patrón de permisos por alias, persistencia cifrada AES/GCM+AndroidKeystore, BroadcastReceiver → Service en primer plano, restauración tras reinicio). Geovallas en origen/destino de cada ruta; un servicio en primer plano (`foregroundServiceType="location"`) que solo corre mientras dura un trayecto y comprueba la distancia punto-a-corredor (3 muestras seguidas fuera antes de avisar de un desvío, para no disparar por rebote del GPS). El dispositivo informa de los eventos con una simple llamada HTTPS autenticada al backend — no hace falta que nadie lo "despierte" desde fuera, porque el propio servicio en primer plano ya mantiene el proceso vivo mientras dura el trayecto.
  - Ficheros: `RouteGuardPlugin.java` (superficie JS), `RouteGuardScheduler.java` (geovallas), `RouteGuardStore.java` (persistencia cifrada), `GeofenceBroadcastReceiver.java` (recibe transiciones, comprueba si "ahora" cae dentro de la ventana horaria de algún horario antes de tratarlo como real), `RouteGuardService.java` (seguimiento + cálculo de desvío), `RouteGuardGeometry.java` (distancia punto-a-polilínea), `RouteGuardApi.java` (POST directo a `/api/trips/events`), `BootReceiver.java`.
  - `src/routeGuard.ts`: puente JS, usado desde `UsuarioRoutes` en `Routes.tsx` (sincroniza sesión+rutas, pantalla de permisos de ubicación).
- **M4 — motor de avisos** (`server/index.ts`, `server/schedule.ts` nuevo): `POST /api/trips/events` (el dispositivo informa DEPARTED/ARRIVED/DEVIATED/SOS, resuelve el `Trip` del día de forma idempotente); intervalo cada 60s `checkScheduleAlerts()` cubre los dos casos que no vienen del dispositivo: "no ha salido" (pasada la ventana sin evento DEPARTED) y "no ha llegado" (calculado desde la hora **real** de salida cuando existe, no la programada — el refinamiento que pediste el 30 de julio, para que una salida tardía no dispare un aviso de retraso antes de tiempo). Los 4 avisos reutilizan el Web Push (VAPID) ya construido en M1 — ningún sistema de credenciales push nuevo.
- **Verificación**: TypeScript (frontend+backend) y `vite build` limpios, igual que siempre. Para el lado Java, esta máquina no tiene JDK/SDK de Android instalados, así que no pude compilar ni probar nada localmente — la única señal de compilación ha sido el workflow `android.yml` de GitHub Actions tras el push, que **ha compilado, pasado el lint y generado tanto el APK de depuración como el AAB de release sin errores** (`gh run watch` sobre la ejecución del commit `8ce28d1`). Sigue pendiente la prueba real en un teléfono: permisos, disparo real de las geovallas al caminar, notificación del servicio en primer plano, desvío, y que sobreviva a un reinicio — de eso solo puedes dar fe tú con el APK instalado.
- **Actualización 30 de julio, misma tarde**: el usuario ya tenía Android Studio instalado. Ahora hay compilación local funcionando de verdad:
  - JDK: `C:\Program Files\Android\Android Studio\jbr` · SDK: `%LOCALAPPDATA%\Android\Sdk` (build-tools 36.0.0/35.0.0, platform android-36).
  - El JBR no confiaba en el certificado de alguna inspección TLS de la red/antivirus de este equipo (`PKIX path building failed` al descargar dependencias). Solución sin necesitar permisos de administrador: se copió `cacerts` a `%USERPROFILE%\.android-cacerts-with-winroot` (no se tocó el original, protegido) y se importaron ahí los 56 certificados de `Cert:\LocalMachine\Root` con `keytool`.
  - Para compilar en PowerShell:
    ```powershell
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
    $env:GRADLE_OPTS = "-Djavax.net.ssl.trustStore=$env:USERPROFILE\.android-cacerts-with-winroot -Djavax.net.ssl.trustStorePassword=changeit"
    cd "P:\PR\PRUEBAS\Ruta Segura\android"; .\gradlew.bat compileDebugJavaWithJavac
    ```
  - `compileDebugJavaWithJavac` → **BUILD SUCCESSFUL**, confirmando en local (no solo en la CI) que el plugin `RouteGuard` compila.
- ~~Pendiente explícitamente para cuando exista un proyecto Firebase de PLACEAT: "ver ahora"~~ **Implementado el 30 de julio, una vez el usuario tuvo el proyecto Firebase** — ver la sección dedicada "Ver ahora — ubicación bajo demanda vía Firebase/FCM" más abajo.

## "Ver ahora" — ubicación bajo demanda vía Firebase/FCM — 30 de julio de 2026

Implementada la función que quedaba explícitamente pendiente desde el diseño original (M4): que el tutor pueda pedir, bajo demanda, la ubicación puntual de la persona usuaria en cualquier momento (no solo durante un trayecto programado), sin mantener ningún seguimiento continuo. El usuario ya tenía cuenta de Firebase con dos proyectos existentes y reutilizó uno (`push-app-placeat`), añadiendo Ruta Segura como app Android nueva dentro de él (package `org.placeat.rutasegura`).

**Cómo funciona el flujo:**
1. El tutor pulsa el botón nuevo (icono de diana) junto al nombre de una persona vinculada, en "Personas vinculadas".
2. El backend (`POST /api/live/request`) comprueba el vínculo, busca los tokens FCM registrados de esa persona usuaria y le manda un mensaje **de datos silencioso** (sin notificación visible) vía Firebase Cloud Messaging con un `requestId`.
3. El dispositivo de la persona usuaria (si tiene la app instalada y el permiso de ubicación concedido) recibe el mensaje aunque la app esté cerrada, pide una localización puntual fresca (con `getCurrentLocation`, y si no responde a tiempo cae a la última posición conocida) y se la manda de vuelta al backend (`POST /api/live/location`).
4. Mientras tanto, la pantalla del tutor va preguntando cada 2 segundos (`GET /api/live/:requestId`) hasta que llega la respuesta o caduca a los 60 segundos, y entonces pinta un mapa Leaflet con la posición.
- **No se guarda ningún historial**: las solicitudes viven en memoria del proceso Node (`Map`, no en la base de datos) con caducidad de 60 segundos y limpieza perezosa a los 5 minutos — coherente con la decisión de privacidad de no mantener seguimiento continuo.

**Piezas construidas:**
- **Backend** (`server/index.ts`): `firebase-admin` (API modular v14: `firebase-admin/app` + `firebase-admin/messaging`, no el namespace `admin` antiguo). Se inicializa solo si existe `FIREBASE_SERVICE_ACCOUNT_BASE64` (bandera `liveEnabled`, mismo patrón que `pushEnabled` con VAPID). Endpoints nuevos: `GET /api/live/config` (para que el frontend oculte el botón si no está configurado), `POST /api/live/token` (la persona usuaria registra su token FCM), `POST /api/live/request` (el tutor pide ubicación), `POST /api/live/location` (la persona usuaria responde), `GET /api/live/:requestId` (el tutor consulta el estado).
- **Esquema** (`prisma/schema.prisma`): modelo nuevo `FcmToken` (token único + `userId`). El enum `EventType.LOCATE_RESPONSE` que ya existía en el esquema desde M2 **no se ha usado en esta pasada** — se decidió no complicar el flujo intentando engancharlo a un `Trip`/`TripEvent` (el "ver ahora" puede pedirse fuera de cualquier ventana de horario programada); queda como posible mejora futura si se quiere dejar constancia en el historial de un trayecto en curso.
- **Plugin nativo** (`android/app/src/main/java/org/placeat/rutasegura/`): `LocateMessagingService.java` (extiende `FirebaseMessagingService`; `onMessageReceived` pide la ubicación puntual y la reporta, `onNewToken` reregistra el token si cambia), `LiveLocationApi.java` (cliente HTTP mínimo hacia `/api/live/token` y `/api/live/location`, calcado del patrón de `RouteGuardApi`), y un método nuevo `registerLiveToken()` en `RouteGuardPlugin.java` que pide el token FCM activo y lo manda al backend. Registrado en `AndroidManifest.xml` con el intent-filter `com.google.firebase.MESSAGING_EVENT`. Gradle: añadido `firebase-bom:33.7.0` + `firebase-messaging` en `android/app/build.gradle` (el plugin `com.google.gms.google-services` ya venía preparado de fábrica por Capacitor, solo esperaba a que existiera `google-services.json`).
- **`google-services.json`**: descargado por el usuario y colocado en `android/app/google-services.json`. Contiene solo un API key restringido por nombre de paquete (no es un secreto sensible al estilo `JWT_SECRET`), así que se deja comiteado como es práctica habitual en apps Android.
- **Frontend**: `src/routeGuard.ts` expone `registerLiveLocationToken()`; se llama desde `UsuarioRoutes` justo después de `updateRouteGuardSession()`, para que cualquier persona usuaria que abra la app en un móvil quede registrada para recibir el ping. `src/storage.ts` añade `getLiveConfig`/`requestLiveLocation`/`pollLiveLocation`. `src/Routes.tsx` añade el botón "Ver ahora" (icono `Locate` nuevo en `src/icons.tsx`) dentro de `LinkedUsuariosList` y el componente `LiveLocationModal` que hace el sondeo y pinta el mapa.

**Verificado en local**: `prisma validate`/`generate`, `tsc -b` (frontend), `tsc -p server/tsconfig.json`, `vite build`, `npx cap sync android` y `gradlew assembleDebug` — todo compila limpio. **No probado en un dispositivo real todavía** — para eso hace falta lo de la siguiente sección.

**Pendiente, en este orden:**
1. **Generar la clave de cuenta de servicio de Firebase**: en la consola de Firebase → Configuración del proyecto → Cuentas de servicio → "Generar nueva clave privada" (descarga un JSON). Ese JSON hay que codificarlo en base64 (`node -e "console.log(Buffer.from(require('fs').readFileSync('ruta/al/fichero.json')).toString('base64'))"`) y ponerlo como variable de entorno `FIREBASE_SERVICE_ACCOUNT_BASE64` en Easypanel — documentado ya en `.env.example`. Sin esto, `liveEnabled` queda en `false` y el botón "Ver ahora" ni siquiera aparece en la app del tutor.
2. **Redesplegar el backend en Easypanel** con este commit (se junta con el redespliegue de M3+M4 que ya estaba pendiente por el imprevisto del usuario) — el contenedor ejecuta `npx prisma db push` automáticamente al arrancar (ver `Dockerfile`), así que la tabla `fcm_tokens` se crea sola, no hace falta ninguna migración manual.
3. Instalar el último APK en el móvil de la persona usuaria, iniciar sesión como `USUARIO` (eso dispara `registerLiveLocationToken()` y registra el token FCM en el backend).
4. Desde una cuenta `TUTOR` (web o app), ir a "Personas vinculadas" y pulsar el icono de diana junto al nombre.
5. Cosa a vigilar en la prueba real: la recepción de "ver ahora" en segundo plano puede depender de que la persona usuaria tenga concedido el permiso de ubicación en segundo plano ("todo el tiempo"), no solo en primer plano — si con solo el permiso de primer plano falla, habrá que documentarlo como limitación real de Android, no como bug.

## Icono real de la app generado — 30 de julio de 2026

El usuario instaló el APK, vio que ya funcionaba el mapa, pero notó que el icono de la app en el móvil no era el de la app (salía el icono genérico de plantilla de Android Studio/Capacitor: un escudo con degradado en teal sobre fondo verde azulado). Diagnóstico: **nunca se había generado un icono real**. `public/icons/` estaba vacío pese a que `manifest.webmanifest` y `index.html` ya referenciaban ficheros ahí (`icon-192.png`, `favicon-32.png`, `apple-touch-icon.png`), y los `mipmap-*/ic_launcher*.png` de Android seguían siendo los de plantilla que genera Capacitor al crear el proyecto.

**Solución aplicada:**
- Instalado `@capacitor/assets` como devDependency (requiere `npm approve-scripts sharp` porque el build nativo de `sharp` viene bloqueado por defecto).
- Generadas 3 imágenes fuente en `assets/` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`, 1024×1024) a partir del `BrandMark` que ya existía en `src/icons.tsx` (el rombo/cubo de tres caras en los azules de marca `--brand-deep`/`--brand-mid`/`--brand`), sobre fondo `#eef3fb` (el mismo `background_color` del manifest).
- `npx capacitor-assets generate --android --pwa` generó todos los tamaños de Android (`mipmap-ldpi` a `mipmap-xxxhdpi`, adaptive icon foreground/background para Android 8+) y los iconos PWA (`icon-48.webp` a `icon-512.webp`).
- **Gotcha de la herramienta**: escribió los iconos PWA en una carpeta `icons/` en la raíz del proyecto (no en `public/icons/`) con rutas `../icons/...` y `type: image/png` sobre ficheros `.webp` — hubo que mover la carpeta a `public/icons/` a mano y corregir `src`/`type` en `manifest.webmanifest`. También reformateó (solo espacios en blanco, sin cambio funcional) `AndroidManifest.xml`; se revirtió ese fichero para no ensuciar el diff.
- Recompilado el APK de depuración en local (mismo toolchain JBR/trust-store de la sección de compilación) — `BUILD SUCCESSFUL` — y entregado al usuario para instalar y confirmar visualmente que ya sale el cubo azul en vez del icono genérico.

**Pendiente:**
- El usuario tiene que instalar este último APK y confirmar que el icono ya es el correcto en el launcher del teléfono (visualmente parece correcto en los PNG generados, pero falta la confirmación real en el dispositivo).
- **Los cambios no están comiteados todavía** — quedan en el árbol de trabajo: `assets/` (fuente reutilizable para regenerar en el futuro), `public/icons/*`, todos los `android/app/src/main/res/mipmap-*/ic_launcher*.png`, `public/manifest.webmanifest`, y `package.json`/`package-lock.json` (nueva devDependency `@capacitor/assets`). Falta decidir cuándo comitear y subir.
- Si en el futuro cambia el logo/colores de marca: editar las 3 imágenes fuente en `assets/` (o regenerarlas desde el SVG de `BrandMark`) y repetir `npx capacitor-assets generate --android --pwa` + el arreglo manual de rutas en `manifest.webmanifest` + mover `icons/` a `public/icons/`.

## El APK "no se podía analizar" al instalarlo — causa real y cómo evitarlo

El usuario bajó el APK de depuración a su Drive para instalarlo (igual que hacía con Pastillero) y Android daba **"No se ha podido analizar el paquete"**. Diagnóstico paso a paso (útil si vuelve a pasar):

1. `unzip -t` sobre el APK decía que no había errores, pero `apksigner verify` (la herramienta oficial de Android, mucho más estricta) daba **`ZIP End of Central Directory record not found`** — el archivo estaba realmente corrupto, no era cosa del teléfono ni de Drive.
2. Se descartó `gh run download` y Google Drive como causa: se bajó el `.zip` del artefacto **directo de la API de GitHub** (`gh api repos/.../actions/artifacts/<id>/zip`) y `unzip -t` sobre ESE zip confirmó que el `app-debug.apk` que contiene está perfectamente íntegro.
3. La corrupción aparecía **al extraerlo a disco en la carpeta de trabajo del proyecto** y comprobarlo en un segundo paso/comando separado: el fichero extraído terminaba con un fragmento de texto identificable como una línea del propio transcript JSONL de esta sesión de Claude Code (se veía literalmente el nombre de esta sesión y el `sessionId`). Es decir: **algo del entorno local (no el proyecto, no GitHub, no el teléfono) añadía datos de la sesión al final de un fichero recién escrito en el directorio de trabajo**, entre una llamada a herramienta y la siguiente.
4. **Solución fiable**: extraer el `.apk` y verificarlo con `apksigner` **en el mismo comando/paso**, sin dejar que pase otra llamada de herramienta por medio:
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat"
   Expand-Archive -Path "ruta\al\artifact.zip" -DestinationPath "$env:TEMP\apk-check" -Force
   & $apksigner verify --verbose "$env:TEMP\apk-check\app-debug.apk"
   ```
   Si dice `Verifies`, el APK es válido y se puede copiar/subir a Drive con confianza.
- **APK bueno y verificado de este commit**: `P:\PR\PRUEBAS\Ruta Segura\releases\android-test\ruta-segura-verificado.apk` (firma Android Debug estándar, verificado con `apksigner`). **El usuario ya lo instaló correctamente en su teléfono.**

## Cómo continuar en una nueva sesión

0. **Icono de la app**: confirmar con el usuario que el último APK instalado ya muestra el cubo azul de marca en vez del icono genérico, y **comitear los cambios pendientes** (`assets/`, `public/icons/`, `mipmap-*/ic_launcher*.png`, `manifest.webmanifest`, `package.json`/`package-lock.json`) — ver sección dedicada más arriba.
0.5. **"Ver ahora" (Firebase/FCM)**: pedir al usuario la clave de cuenta de servicio de Firebase (o confirmar que ya la ha puesto en Easypanel como `FIREBASE_SERVICE_ACCOUNT_BASE64`), redesplegar el backend, y probar el botón "Ver ahora" en un dispositivo real — ver sección dedicada más arriba. También pendiente de comitear.
1. **M1 y M2 verificados en producción real** (`rutasegura.placeat.org`): login/registro, emparejamiento, mapa con buscador de dirección, dibujo de ruta con horario — todo confirmado por el usuario.
2. **M3+M4 (commit `8ce28d1`) compilan limpio (CI + local) y el APK ya se instala en el teléfono del usuario.** Falta:
   - **Redesplegar el backend en Easypanel con el commit `8ce28d1`** (pendiente por un imprevisto del usuario, no técnico) — sin esto, el móvil no podrá reportar eventos reales a `/api/trips/events`.
   - Probar de verdad en el teléfono, en este orden: permiso de ubicación en primer plano → permiso "todo el tiempo" en segundo plano → que aparezca la notificación del servicio cuando toque la hora programada de una ruta real → salir de la geovalla de origen y comprobar que llega el aviso `DEPARTED` al tutor (necesita el backend redesplegado) → llegar a destino → forzar un desvío del camino → probar "no ha salido"/"retraso en la llegada" dejando pasar la ventana horaria.
   - Reiniciar el teléfono con una ruta activa y comprobar que las geovallas se restauran (`BootReceiver`).
3. Si hace falta compilar/verificar el APK localmente, usar la receta de PowerShell de la sección de compilación local (más arriba) y SIEMPRE verificar con `apksigner` en el mismo paso en que se extraiga, por el problema de corrupción documentado arriba.
4. Si el usuario pide desplegar en Easypanel: no tengo acceso propio, hay que darme credenciales explícitas (token de API o SSH) y la instrucción exacta.
5. Recordar las decisiones de privacidad ya tomadas (vista bajo demanda, desvío en el dispositivo, sin historial continuo, sin Firebase todavía) antes de proponer alternativas — fueron decisiones explícitas del cliente o del usuario, no supuestos.
6. Después de verificar M3/M4 en el dispositivo: seguir con M5 (documentos legales/RGPD y ficha de Play Console para datos de ubicación).
