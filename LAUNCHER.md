# Potatox Launcher — guía de proyecto

Launcher propio basado en **Helios Launcher** para los modpacks de Potatox, empezando por **Tierras Malditas**. El objetivo: que los amigos instalen un `.exe`, inicien sesión con Microsoft y aprieten **Jugar**; el launcher baja Java, Minecraft, Forge, mods y configs, y se mantiene sincronizado con el servidor solo.

> Este documento sirve de contexto para trabajar en el launcher desde el PC personal (con o sin Claude Code). Lo del servidor (Nebula, hosting) se hace en el homelab.

---

## Descripciones listas para copiar

**Corta (GitHub, Azure):**
> Launcher de Minecraft para los servidores de Potatox. Instala y mantiene actualizados los modpacks automáticamente.

**Larga (README del repo / página):**
> Potatox Launcher es el launcher oficial de los servidores de Potatox. Inicias sesión con tu cuenta de Microsoft, eliges el servidor y aprietas Jugar: el launcher instala Java, Minecraft, Forge y todos los mods y configuraciones del modpack, y los mantiene sincronizados con el servidor. Si el modpack cambia, el launcher lo actualiza solo; no hay que bajar zips ni copiar carpetas. Basado en Helios Launcher (MIT).

**Para el formulario de Mojang/Microsoft (uso de la API):**
> Custom launcher for a small private community server (about 10 players). It authenticates players with their Microsoft accounts to launch Minecraft Java Edition 1.20.1 with Forge and a curated modpack that is downloaded and kept in sync from our own server. Based on the open-source Helios Launcher. No account data is stored or shared beyond what is needed to launch the game.

---

## 1. Contexto del servidor (Tierras Malditas)

| Dato | Valor |
|---|---|
| Dirección | `mc.potatox.me` (puerto 25565) |
| Minecraft | **1.20.1** |
| Loader | **Forge 47.4.10** |
| Java | **17** |
| Whitelist | activa (solo amigos) |
| Mods en el servidor | 96 (`~/mc-server/mods`, montado de solo lectura) |
| Mods de cliente | 94 (todos los del server menos `SmartBrainLib` y `modernfix`, que hoy están solo en el server) |
| Web | `https://mc.potatox.me` (nginx en `~/mc-web/site`, detrás de Caddy) |
| Descarga actual | `site/descargas/TierrasMalditas-mods.zip` (~351 MB). El launcher lo reemplaza. |

Infra:
- Servidor: contenedor `mc-forge` (itzg/minecraft-server:java17), `~/mc-server/docker-compose.yml`.
- Web: contenedor nginx `web` sirve `~/mc-web/site` → `mc.potatox.me`. Caddy (`mc-caddy`) pone HTTPS.
- Todo lo que esté en `~/mc-web/site/launcher/` queda público en `https://mc.potatox.me/launcher/`.

Reglas que importan:
- Si un mod nuevo también lo necesita el cliente y falta, el juego dice *"server mod list is not compatible"*. Con el launcher esto se acaba: cada mod que se agregue al pack lo reciben todos.
- Mods solo de cliente (shaders, minimapas, etc.) van en el pack pero **no** en el server.
- Mods solo de servidor no van en el pack.
- Nunca publicar `~/mc-server/.env` (contraseña de RCON) ni nada de `data/`, salvo configs de cliente.

Identidad visual (de la web, para que el launcher combine):

| Token | Color |
|---|---|
| fondo | `#0b0708` / `#140c0d` |
| tarjetas | `#1a1112`, borde `#3a2324` |
| texto | `#f3e9e4`, secundario `#b9a29b` |
| brasa (acento) | `#ff6a2b` → `#ffb347` |
| sangre | `#c3192e` |
| oro | `#e8b75a` |

Tipografías: **Cinzel** y **Cinzel Decorative** (Google Fonts). Ambiente: oscuro, brasas, medieval maldito.

---

## 2. Cómo funciona Helios

```
 PC del jugador                      Homelab (mc.potatox.me)
┌──────────────────┐   HTTPS     ┌──────────────────────────────┐
│ Potatox Launcher │ ─────────▶ │ /launcher/distribution.json   │
│ (Electron)       │            │ /launcher/servers/.../*.jar    │
│  - login MS      │            │   (generado con Nebula)        │
│  - baja Java     │            └──────────────────────────────┘
│  - baja MC+Forge │
│  - sincroniza    │   juego     ┌──────────────────────────────┐
│    mods/configs  │ ─────────▶ │ mc-forge :25565               │
└──────────────────┘            └──────────────────────────────┘
```

- **Helios** es la app de escritorio. Al abrir lee `distribution.json`, compara hashes y baja solo lo que cambió.
- **distribution.json** es la lista de servidores. Por cada uno indica la versión de MC, Forge, los mods (con URL, tamaño y MD5), los archivos extra y la dirección del server.
- **Nebula** es la herramienta que genera ese JSON a partir de una carpeta ordenada.
- Varios modpacks = varios servidores en el mismo JSON (sirve para el Soulbound u otros a futuro).

---

## 3. Lo que hago en mi PC (paso a paso)

### 3.1 Herramientas
- Git — git-scm.com
- Node.js **20 LTS** — nodejs.org (verificar la versión exacta en el README de Helios)
- VS Code (y opcionalmente Claude Code)

### 3.2 Fork y primera prueba
1. Fork de `https://github.com/dscalzi/HeliosLauncher` → repo `PotatoxLauncher`.
2. ```
   git clone https://github.com/TU_USUARIO/PotatoxLauncher.git
   cd PotatoxLauncher
   npm install
   npm start
   ```
3. Iniciar sesión y entrar a un server de demo. Si funciona, el entorno está bien. **No cambiar nada antes de esto.**

### 3.3 Microsoft / Azure (empezar YA, es lo lento)
1. portal.azure.com → **App registrations** → **New registration**
   - Nombre: `Potatox Launcher`
   - Cuentas: **Personal Microsoft accounts only**
   - Redirect URI: **Public client/native (mobile & desktop)** → `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. Copiar el **Application (client) ID**.
3. Llenar el formulario de Mojang para acceso a la API de Minecraft con ese ID (link en el README de Helios, sección Microsoft). Usar la descripción de arriba.
4. Hasta que aprueben: desarrollar con el ID que trae Helios. Al aprobarse: cambiar `AZURE_CLIENT_ID` en `app/assets/js/ipcconstants.js`.

### 3.4 Personalización
| Qué | Dónde |
|---|---|
| Nombre, descripción | `package.json` (`name`, `productName`, `description`), `electron-builder.yml` (`appId` p. ej. `me.potatox.launcher`, `productName`) |
| Ícono | `build/icon.png` (≥ 256×256) |
| Logo, fondos | `app/assets/images/` (fondos en `backgrounds/`) |
| Colores, fuentes | `app/assets/css/launcher.css` |
| Textos / idioma | `app/assets/lang/` |
| URL del pack | `app/assets/js/distromanager.js` → `REMOTE_DISTRO_URL = 'https://mc.potatox.me/launcher/distribution.json'` |

> Las rutas son de Helios v2; si cambiaron, buscar `REMOTE_DISTRO_URL` y `AZURE_CLIENT_ID` en el código.

### 3.5 Instalador
```
npm run dist:win
```
El `.exe` queda en `dist/`. Windows mostrará "Windows protegió su PC" porque no está firmado: *Más información → Ejecutar de todas formas*. (Un certificado de firma cuesta dinero; no vale la pena por ahora.)

### 3.6 Auto-actualización (después)
- Helios se actualiza desde las **Releases de GitHub** (electron-builder + `publish` en `electron-builder.yml` apuntando al repo).
- GitHub Actions compila el `.exe` en cada tag `v*` y lo sube al release.

---

## 4. Lo que se hace en el servidor (Claude en el homelab)

> **Estado (2026-10-08): HECHO.** `https://mc.potatox.me/launcher/distribution.json` publicado con Forge 47.4.10 y 94 mods.
> - Nebula en `~/mc-launcher/Nebula`, corre en Docker (`potatox-nebula`: Node 22 + Java 17).
> - Parche local en Nebula: el instalador de Forge corre con `--installClient` (sin ventana).
> - Mods con nombres raros (corchetes, espacios) se renombran a nombres seguros para URL.
> - Republicar tras cambiar mods: `~/mc-server/tools/publicar_pack.sh`.
> - nginx: `distribution.json` sin caché; `/launcher/cache/` y `/launcher/modpacks/` dan 404.
> - **Probado 2026-10-08:** el fork (pasos 1, 2 y 4 hechos) bajó los 94 mods + Forge y entró al server.
> - Ícono del servidor: dragón coronado (originales en `~/mc-launcher/assets/`, también el de Soulbound) (`servers/TierrasMalditas-1.20.1/icono.png`).

Plan original:

1. Instalar Node 20 y **Nebula** (`https://github.com/dscalzi/Nebula`) con Java 17 disponible.
2. Estructura de Nebula (verificar contra su README):
   ```
   nebula-root/
     servers/TierrasMalditas-1.20.1/
       servermeta.json         ← nombre, dirección mc.potatox.me:25565, ícono, descripción
       forgemods/required/     ← los 94 mods de cliente
       forgemods/optionalon/   ← opcionales activados (p. ej. minimapa)
       forgemods/optionaloff/  ← opcionales desactivados (p. ej. shaders)
       files/                  ← configs de cliente (config/, options por defecto, etc.)
   ```
   - `generate server TierrasMalditas 1.20.1 --forge 47.4.10`
   - `generate distro` → `distribution.json`
   - `BASE_URL=https://mc.potatox.me/launcher/`
3. Publicar `distribution.json` y los archivos en `~/mc-web/site/launcher/`.
4. Script `~/mc-server/tools/publicar_pack.sh`: copia los mods de cliente desde `~/mc-server/mods` (menos los solo-server), regenera con Nebula y publica. Se corre cada vez que cambia un mod.
5. nginx: `/launcher/distribution.json` sin caché.
6. Agregar un botón "Descargar launcher" en la web (enlace al release de GitHub).

---

## 5. Orden de trabajo

1. **Ya:** pedir la aprobación de Azure/Mojang (PC). Generar `distribution.json` de Tierras Malditas (servidor) y validar que Forge 1.20.1 se instala bien con los 94 mods.
2. Fork y prueba sin cambios (PC).
3. Apuntar el fork a `mc.potatox.me/launcher/` y probar entrar a Tierras Malditas desde el launcher.
4. Branding (colores, fondos, logo, textos en español).
5. Instalador + GitHub Actions + auto-update.
6. Reemplazar el zip de la web por el launcher.

## 6. Riesgos y pendientes
- **Aprobación de Microsoft**: puede tardar semanas o ser rechazada. Mientras, se usa el ID de Helios.
- **Forge 1.20.1 en Nebula**: es lo primero que hay que validar.
- **Mods solo-server**: confirmar que `SmartBrainLib` y `modernfix` no los necesita el cliente (hoy el zip no los trae y funciona).
- **Licencias de mods**: redistribuir jars desde tu servidor es para un grupo privado; no publicar el pack abiertamente.
- **Tamaño**: ~351 MB la primera vez; después solo baja lo que cambia.

## 7. Prompt para Claude Code en el PC

> Estoy creando "Potatox Launcher", un fork de Helios Launcher (Electron) para mis servidores de Minecraft. Lee `LAUNCHER.md` para el contexto. El pack se sirve en `https://mc.potatox.me/launcher/distribution.json` (Forge 1.20.1 / 47.4.10, Java 17, server `mc.potatox.me:25565`). Ayúdame con: [tarea]. Respeta la paleta y tipografías de la sección 1. Háblame en español.

---

## 8. Assets para generar (IA de imágenes)

> Nombres de archivo de Helios v2 de memoria: confirmarlos en `app/assets/images/` del fork y reemplazar con el **mismo nombre y formato**.

Estilo común para todos: *dark fantasy medieval, cursed kingdom, glowing embers, blood red and molten orange accents, antique gold details, deep near-black background (#0b0708), cinematic, high contrast*. Sin texto dentro de la imagen (las IAs escriben mal; el texto lo pone el launcher con Cinzel).

| # | Asset | Dónde va | Tamaño / formato | Notas |
|---|---|---|---|---|
| 1 | **Logo / sello** | `app/assets/images/SealCircle.png` | 1024×1024 PNG transparente | Emblema circular. Se ve chico (arriba a la izquierda): simple y legible. |
| 2 | **Ícono de la app** | `build/icon.png` (+ `.ico` para Windows) | 1024×1024 PNG | Puede ser el mismo sello. El `.ico` se genera desde el PNG (256, 128, 64, 48, 32, 16). |
| 3 | **Fondos** | `app/assets/images/backgrounds/0.jpg`, `1.jpg`, … | 1920×1080 JPG (ideal 2560×1440) | 3 a 5. El launcher elige uno al azar. Dejar la **zona inferior y el centro más oscuros y tranquilos** (ahí van el botón Jugar y los menús). |
| 4 | **Pantalla de carga** | `app/assets/images/LoadingSeal.png` (+ `LoadingText.png` si existe) | 512×512 PNG transparente | El sello en versión simple; se anima al cargar. |
| 5 | **Ícono por modpack** | `servers/<pack>/icono.png` en el **servidor** (me lo pasas) | 512×512 PNG | Uno por servidor/modpack (Tierras Malditas, Soulbound…). Hoy está el de Ice and Fire de relleno. |
| 6 | *(opcional)* Barra del instalador | `build/installerSidebar.bmp` | 164×314 BMP | Imagen vertical del instalador NSIS. Solo si quieres el instalador bonito. |

Prompts de ejemplo (en inglés, rinden mejor):

- **Sello:** `circular emblem of a cursed medieval kingdom, a cracked golden crown wrapped in thorns over a burning ember, blood red and molten orange glow, antique gold border, dark background, flat vector-like icon, centered, no text, transparent background`
- **Fondo 1:** `wide cinematic landscape of a cursed medieval kingdom at night, a blood red moon over ruined castle towers, a dragon silhouette in the distance, glowing embers floating in the air, dark lower third, painterly dark fantasy, no text, 16:9`
- **Fondo 2:** `ancient stone altar with seven empty sockets in a dark forest camp, a lone old chronicler by a campfire, embers rising, deep shadows, dark fantasy, no text, 16:9`
- **Fondo 3:** `vast underground cavern with molten ore veins and a sleeping dragon on treasure, orange and red glow, smoke, dark fantasy, darker bottom area, no text, 16:9`
- **Ícono Tierras Malditas:** `square game server icon, red-eyed dragon head emerging from embers, cursed crown, blood red and gold, dark background, bold readable at small size, no text`

---

## 9. Cómo funciona con varios modpacks

- `distribution.json` tiene una lista `servers`. **Cada entrada es un modpack**: su versión de Minecraft, su loader (Forge, Fabric o vanilla), sus mods, sus archivos, su ícono y la dirección del server.
- En el launcher aparece un **selector de servidor**. Cada uno tiene su **propia carpeta de instancia** (mods, configs y mundos separados); Minecraft, assets y Java se comparten cuando coinciden.
- Agregar un modpack nuevo (en el servidor, lo hago yo):
  1. `generate server <Id> <versión> --forge <ver>` (o `--fabric <ver>`, o nada para vanilla).
  2. Poner sus mods en `forgemods/` o `fabricmods/` y sus archivos en `files/`.
  3. Completar `servermeta.json` (nombre, descripción, dirección, ícono).
  4. `generate distro` → el launcher de todos lo muestra al abrir.
- Cada modpack puede tener:
  - **Mods obligatorios** (`required`) y **opcionales** que el jugador activa o desactiva desde el launcher (`optionalon` / `optionaloff`), por ejemplo shaders o minimapa.
  - **Archivos** (`files/`): configs de mods, `options.txt` por defecto, resource packs, `servers.dat`. Con `untrackedFiles` se marcan los que el jugador puede cambiar sin que el launcher los pise (por ejemplo `options.txt`).
  - Un **servidor principal** (`mainServer`) que sale elegido por defecto, y **autoconnect** para entrar directo al server.
- Para todo el launcher:
  - **Noticias:** `meta/distrometa.json` → `rss` muestra un feed de noticias en el launcher. Se puede generar desde la web (por ejemplo, la actividad de Tierras Malditas).
  - **Discord:** estado "Jugando Tierras Malditas" si se crea una app de Discord.
- Ideas de modpacks a futuro:
  - **Soulbound** (vanilla con datapack): entraría como servidor sin loader. Usa una versión de Minecraft más nueva, que pide otro Java; Helios lo maneja, pero hay que probarlo.
  - Un modpack **de prueba/dev** (`mainServer: false`) para probar mods nuevos antes de pasarlos a Tierras Malditas.

---

## 10. Estado del fork (PC, `D:\git\PotatoxLauncher`) — 2026-10-08

Fork de Helios 2.2.1 (Electron 39), rama `master`.

Hecho:
- URL del pack → `https://mc.potatox.me/launcher/distribution.json`. **Probado de punta a punta**: login Microsoft (ID de Helios), descarga de Forge + 94 mods y entrada al server.
- Identidad: `potatoxlauncher` / `Potatox Launcher` / `me.potatox.launcher`, carpeta de datos `.potatoxlauncher`, feed de releases → `MrPotatoXx/PotatoxLauncher`.
- Español: `app/assets/lang/es_ES.toml` (266 claves), cadena en_US → es_ES → _custom.
- Imágenes: SealCircle (.png/.ico), LoadingSeal, LoadingText (anillo "POTATOX LAUNCHER" en Cinzel), `build/icon.png/.ico`, `backgrounds/0-5.jpg`. Originales en `/assets/` (gitignore).
- Ícono del servidor Tierras Malditas (dragón coronado): publicado en el servidor.

Pendiente:
1. Commit de todo.
2. `launcher.css`: paleta de la sección 1 y Cinzel / Cinzel Decorative (empaquetar las fuentes en el proyecto, no por Google Fonts).
3. Links sociales: no hay redes. Quitar Discord/X/Instagram/YouTube; dejar solo GitHub (`https://github.com/MrPotatoXx`), la página del server (`https://mc.potatox.me`) y la página personal (`https://potatox.me`).
4. Instalador `npm run dist:win`, `publish` a GitHub Releases, workflow de Actions para tags `v*`.
5. `AZURE_CLIENT_ID` propio cuando Mojang apruebe.
6. Sumar Soulbound como segundo servidor (ícono ya guardado en `~/mc-launcher/assets/`).

Notas del PC:
- `npm ci` con npm 11 bloquea el postinstall de Electron → `node node_modules/electron/install.js`.
- `npx eslint .` ya fallaba antes (CRLF vs LF, 2 `;` de sobra en index.js:151-152). Conviene un `.gitattributes` (`* text=auto eol=lf`) para cortar el problema de line endings.
- La versión canónica de este documento es la del servidor (`~/mc-server/LAUNCHER.md`); copiarla al repo cuando cambie.
