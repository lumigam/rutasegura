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
- No hay iconos PNG reales (`manifest.webmanifest` referencia `/icons/icon-192.png` etc. que no existen todavía) — pendiente de recursos gráficos reales basados en `BrandMark`.
- FCM (necesario para "ver ahora" y los avisos push de M4) no está configurado todavía.
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
- Pendiente explícitamente para cuando exista un proyecto Firebase de PLACEAT: **"ver ahora"** (despertar bajo demanda el móvil de la persona usuaria para una localización puntual).

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

1. **M1 y M2 verificados en producción real** (`rutasegura.placeat.org`): login/registro, emparejamiento, mapa con buscador de dirección, dibujo de ruta con horario — todo confirmado por el usuario.
2. **M3+M4 (commit `8ce28d1`) compilan limpio (CI + local) y el APK ya se instala en el teléfono del usuario.** Falta:
   - **Redesplegar el backend en Easypanel con el commit `8ce28d1`** (pendiente por un imprevisto del usuario, no técnico) — sin esto, el móvil no podrá reportar eventos reales a `/api/trips/events`.
   - Probar de verdad en el teléfono, en este orden: permiso de ubicación en primer plano → permiso "todo el tiempo" en segundo plano → que aparezca la notificación del servicio cuando toque la hora programada de una ruta real → salir de la geovalla de origen y comprobar que llega el aviso `DEPARTED` al tutor (necesita el backend redesplegado) → llegar a destino → forzar un desvío del camino → probar "no ha salido"/"retraso en la llegada" dejando pasar la ventana horaria.
   - Reiniciar el teléfono con una ruta activa y comprobar que las geovallas se restauran (`BootReceiver`).
3. Si hace falta compilar/verificar el APK localmente, usar la receta de PowerShell de la sección de compilación local (más arriba) y SIEMPRE verificar con `apksigner` en el mismo paso en que se extraiga, por el problema de corrupción documentado arriba.
4. Si el usuario pide desplegar en Easypanel: no tengo acceso propio, hay que darme credenciales explícitas (token de API o SSH) y la instrucción exacta.
5. Recordar las decisiones de privacidad ya tomadas (vista bajo demanda, desvío en el dispositivo, sin historial continuo, sin Firebase todavía) antes de proponer alternativas — fueron decisiones explícitas del cliente o del usuario, no supuestos.
6. Después de verificar M3/M4 en el dispositivo: seguir con M5 (documentos legales/RGPD y ficha de Play Console para datos de ubicación).
