<p align="center"><img src="./app/assets/images/SealCircle.png" width="150px" height="150px" alt="Potatox Launcher"></p>

<h1 align="center">Potatox Launcher</h1>

<p align="center">Launcher de Minecraft para los servidores de Potatox. Instala y mantiene actualizados los modpacks automáticamente.</p>

---

Potatox Launcher es el launcher oficial de los servidores de Potatox. Inicias sesión con tu cuenta de Microsoft, eliges el servidor y aprietas **Jugar**: el launcher instala Java, Minecraft, Forge y todos los mods y configuraciones del modpack, y los mantiene sincronizados con el servidor. Si el modpack cambia, el launcher lo actualiza solo; no hay que bajar zips ni copiar carpetas.

Basado en [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) (MIT).

> **Estado:** en desarrollo. Todavía no hay instaladores publicados: el inicio de sesión con Microsoft espera la aprobación de Mojang para el ID de la aplicación.

## Servidores

| Servidor | Versión | Loader | Java |
| -------- | ------- | ------ | ---- |
| **Tierras Malditas** (`mc.potatox.me`) | 1.20.1 | Forge 47.4.10 | 17 |

Los servidores tienen whitelist: son para la comunidad de Potatox. Más info en [mc.potatox.me](https://mc.potatox.me).

## Qué hace

* 🔒 **Cuentas de Microsoft.** Puedes agregar varias y cambiar entre ellas. Inicias sesión en la página oficial de Microsoft; el launcher no guarda tu contraseña.
* ☕ **Java automático.** Si no tienes la versión de Java que pide el modpack, el launcher la instala por ti.
* 📦 **Modpack siempre al día.** Compara los archivos con el servidor y baja solo lo que cambió. Los archivos dañados o incorrectos se vuelven a bajar antes de jugar.
* 🗺️ **Varios modpacks.** Cada servidor tiene su propia carpeta de instancia (mods, configs y mundos separados).
* 🧩 **Mods opcionales y propios.** Activa o desactiva los opcionales del pack y agrega shaders o mods tuyos desde los ajustes.
* 👥 **Estado del servidor.** Muestra los jugadores conectados del servidor elegido.
* 🇪🇸 **En español.**

## Instalar

Cuando haya versiones publicadas, estarán en [GitHub Releases](https://github.com/MrPotatoXx/PotatoxLauncher/releases).

| Plataforma | Archivo |
| ---------- | ------- |
| Windows x64 | `Potatox-Launcher-setup-VERSION.exe` |

El instalador no está firmado, así que Windows mostrará *"Windows protegió su PC"*. Para seguir: **Más información → Ejecutar de todas formas**.

## Consola

Si algo falla, la consola tiene los detalles:

```console
ctrl + shift + i
```

Abre la pestaña **Console**. Para guardar lo que muestra, haz clic derecho en la consola y elige **Save as..**

No pegues nada en la consola si no sabes exactamente qué hace: puede exponer información de tu cuenta.

## Desarrollo

**Requisitos:** [Node.js][nodejs] 22.

```console
> git clone https://github.com/MrPotatoXx/PotatoxLauncher.git
> cd PotatoxLauncher
> npm ci
> npm start
```

Con npm 11 o superior, `npm ci` puede bloquear el script que descarga Electron. Si `npm start` no encuentra Electron:

```console
> node node_modules/electron/install.js
```

### Instaladores

| Plataforma  | Comando              |
| ----------- | -------------------- |
| Windows x64 | `npm run dist:win`   |
| macOS       | `npm run dist:mac`   |
| Linux x64   | `npm run dist:linux` |

El resultado queda en `dist/`. Los builds de macOS no suelen funcionar desde Windows o Linux, ni al revés.

### Dónde está cada cosa

| Qué | Dónde |
| --- | ----- |
| URL de la distribución (lista de servidores y mods) | `app/assets/js/distromanager.js` → `REMOTE_DISTRO_URL` |
| ID de la app de Microsoft | `app/assets/js/ipcconstants.js` → `AZURE_CLIENT_ID` |
| Textos (español) | `app/assets/lang/es_ES.toml`, título y bienvenida en `_custom.toml` |
| Logo, fondos y pantalla de carga | `app/assets/images/` |
| Ícono de la app | `build/icon.png` y `build/icon.ico` |
| Estilos | `app/assets/css/launcher.css` |

La distribución (`distribution.json`) se genera en el servidor con [Nebula][nebula]. El formato está en [`docs/distro.md`](docs/distro.md) y la configuración de Microsoft en [`docs/MicrosoftAuth.md`](docs/MicrosoftAuth.md).

## Créditos

Potatox Launcher es un fork de [Helios Launcher](https://github.com/dscalzi/HeliosLauncher), de Daniel Scalzi, bajo licencia [MIT](LICENSE.txt). Gracias por hacerlo libre.

No está afiliado a Mojang ni a Microsoft.

[nodejs]: https://nodejs.org/ 'Node.js'
[nebula]: https://github.com/dscalzi/Nebula 'dscalzi/Nebula'
