# Potatox Launcher

Fork de Helios Launcher (Electron). Todo en español. Ver README.md (sección "Para desarrolladores").

## Releases

- Antes de cada release, preguntar al admin si es obligatoria y poner la línea en docs/release-notes.md (`<!-- obligatoria: sí -->` u `<!-- obligatoria: no -->`, arriba de todo). Sin la línea cuenta como "no".
- Regla del admin para decidirlo: obligatoria cuando hay cambios grandes que cambian la experiencia del jugador (por ejemplo, un loader nuevo o una forma nueva de jugar). Opcional para parches y cambios visuales (tipografía, posiciones, menús). Igual preguntar siempre al admin antes de cada release.
- Versión: menor (1.x.0) para funciones nuevas, parche (1.x.y) para arreglos.
- Las notas de docs/release-notes.md son para jugadores: simples, en español, con `###` y viñetas. El workflow las copia al release de GitHub.
- La versión de package.json tiene que coincidir con el tag (`vX.Y.Z`); el tag es lo que dispara el workflow.
- El instalador de Windows se llama siempre `Potatox-Launcher-setup.exe` (la web enlaza a releases/latest/download/ con ese nombre).
- No cambiar `appId` ni `productName`: de ahí salen la carpeta de datos y el auto-update.
