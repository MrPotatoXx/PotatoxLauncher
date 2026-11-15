# Potatox Launcher

Fork de Helios Launcher (Electron). Todo en español. Ver README.md (sección "Para desarrolladores").

## Releases

- Antes de cada release, preguntar al admin si es obligatoria y poner la línea en docs/release-notes.md (`<!-- obligatoria: sí -->` u `<!-- obligatoria: no -->`, arriba de todo). Sin la línea cuenta como "no".
- Las notas de docs/release-notes.md son para jugadores: simples, en español, con `###` y viñetas. El workflow las copia al release de GitHub.
- La versión de package.json tiene que coincidir con el tag (`vX.Y.Z`); el tag es lo que dispara el workflow.
- El instalador de Windows se llama siempre `Potatox-Launcher-setup.exe` (la web enlaza a releases/latest/download/ con ese nombre).
- No cambiar `appId` ni `productName`: de ahí salen la carpeta de datos y el auto-update.
