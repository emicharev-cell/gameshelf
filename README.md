# 🎮 GameShelf: mi colección de videojuegos

Catálogo visual de mi colección: se amplía **a partir de fotos** (lomos de la estantería, carátulas, cartuchos), con **carátulas reales**, **horas de juego** (Exophase, RetroArch, CSV de 3DS/Wii U o a mano) y **acceso por QR**: quien escanea el QR de editor puede editar; el resto solo puede mirar.

**Úsala aquí:** https://emicharev-cell.github.io/gameshelf/

---

## Cómo funciona (todo en GitHub, sin servidor propio)

```
 Invitado ──lee──▶ GitHub Pages ──▶ data/games.json + covers/
 Editor  ──lee/escribe──▶ API de GitHub ──commit──▶ data/games.json  ──(≈1 min)──▶ Pages
        └─foto──▶ API de Claude (visión) desde el navegador
```

| Pieza | Cómo |
|---|---|
| Web | HTML + CSS + JS sin compilación, publicado con **GitHub Pages** |
| Base de datos | `data/games.json` en este repositorio. Cada cambio es un **commit** (los cambios seguidos se agrupan) → historial completo y deshacer con git |
| Carátulas | Wikipedia (EN/ES, sin clave). Al elegir una se **sube una copia a `covers/`** para que el enlace nunca se rompa; si falla, se usa la portada generada con el color de la consola |
| Visión | Claude `claude-opus-5-5` con imágenes y salida JSON estructurada, llamado **desde el navegador del editor** con su propia clave |
| Modo editor | Token *fine-grained* de GitHub limitado a este repo (permiso *Contents: read & write*) |

### Acceso por QR
- El QR de editor es `https://emicharev-cell.github.io/gameshelf/#k=…`. Lo que va tras `#` **nunca se envía a ningún servidor**: la app lo guarda en el dispositivo (localStorage) y lo borra de la barra de direcciones al instante.
- Quien entra sin QR solo puede ver, filtrar, ordenar e inspeccionar fichas. No ve los controles de edición y, aunque lo intentara, GitHub rechaza cualquier escritura sin token.
- **El QR es la llave.** Si se filtra, borra el token en GitHub (*Settings → Developer settings → Fine-grained tokens*): deja de funcionar al instante. Después crea otro y genera un QR nuevo.
- El repositorio es público (GitHub Pages gratuito lo requiere), así que **el catálogo y las notas son visibles para cualquiera**. Las claves nunca se guardan en el repo.

---

## Puesta en marcha (una sola vez, ~3 minutos)

1. **Crea el token de GitHub:** [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - *Repository access* → **Only select repositories** → `gameshelf`
   - *Permissions* → **Contents → Read and write** (nada más)
   - Caducidad a tu gusto → *Generate token* → cópialo.
2. Abre https://emicharev-cell.github.io/gameshelf/ en el PC → botón **🔑 Editor** → pega el token. Si quieres escanear juegos por foto, pega también tu clave de Claude ([console.anthropic.com](https://console.anthropic.com/settings/keys), con límite de gasto) → **Guardar y verificar**.
3. Se abre el **QR de editor**: escanéalo con el móvil y ese móvil queda en modo editor. Puedes imprimirlo o descargarlo en PNG. Hay también un **QR de invitado** para compartir.

Las claves quedan solo en cada navegador. Si borras los datos del navegador, vuelve a escanear el QR.

**Coste de la visión:** cada foto es una petición a Claude. Una estantería de 8 fotos cuesta unos pocos céntimos.

### Ejecutar en local (opcional)
```powershell
python -m http.server 8000
```
Abre http://localhost:8000. El modo editor guarda igualmente en el repositorio de GitHub.

---

## Funciones

- **Escanear estantería:** hasta 8 fotos de lomos → lista de juegos detectados con confianza, consola deducida por el diseño de la caja y aviso de **duplicados** («Ya lo tienes» / «En otra consola»). Se corrige en la lista y se añade con un clic.
- **Añadir por foto:** carátula, lomo, cartucho o disco → ficha prellenada (año, géneros, desarrolladora, editora, edición, región PEGI/ESRB/CERO) + selector de carátulas.
- **Vistas:** portadas, **estantería** (lomos con el color de cada sistema y la altura real de su caja, en baldas de madera) y lista.
- **Filtros** combinables (consola, estado, formato) y búsqueda instantánea.
- **11 órdenes:** título, año, horas, plataforma, estado, añadidos recientemente, valoración, última partida y tres de coleccionista:
  - 🧓 **Veterano:** horas ÷ años desde su lanzamiento.
  - 💎 **Gemas olvidadas:** pendientes ordenados por cuánto llevan en la estantería.
  - 🏃 **Maratón:** horas comparadas con la media de su consola.
- **Horas:** −1h / +1h / ⟳ estado en cada tarjeta; +½ / +1 / +5 / fijar en la ficha; **editor rápido** en tabla.
- **Estadísticas**, **🎲 Elige al azar** (con filtros y animación), tema claro/oscuro y barra inferior en el móvil.

## Horas de juego

### Exophase
Exophase no tiene API pública oficial y su web está protegida por Cloudflare: las peticiones automáticas reciben un 403, y GameShelf no intenta saltarse esa protección. En su lugar, **Horas → Exophase** te da un **marcador** para la barra del navegador:
1. Arrastra el botón verde a la barra de marcadores.
2. Abre `exophase.com/user/<tu-usuario>/`, baja hasta el final y pulsa el marcador. Copiará tus juegos y horas.
3. Vuelve a GameShelf → **Pegar del portapapeles** → vista previa con el emparejado → **Aplicar**. Por defecto solo sube horas, nunca las baja.

Exophase recoge horas de Steam, PlayStation, Xbox y otras tiendas. No tiene horas de 3DS ni de Wii U.

### Nintendo 3DS
- **Sin modificar la consola:** menú HOME → **Registro de actividad** muestra el tiempo total por juego. Transcríbelo en **Horas → ⚡ Editor rápido** (elige «Nintendo 3DS»; Tab entre casillas, se guarda solo).
- **Con homebrew:** los datos del Registro de actividad están en un archivo de sistema (la comunidad suele citar `pld.dat`). Se pueden volcar con gestores de partidas como Checkpoint o JKSM y convertir con herramientas comunitarias. El formato no está documentado oficialmente: revisa la herramienta antes de usarla. Cualquier CSV `titulo;plataforma;horas` entra por **📄 CSV**.

### Wii U
- **Sin modificar:** Control parental → **Registro diario** muestra el tiempo por juego y día. Ve sumando con los botones de la ficha o transcribe totales en el editor rápido.
- **Con homebrew (Aroma):** la consola guarda estadísticas de uso por título en datos de sistema; hay utilidades comunitarias que las leen. Exporta a CSV e importa.

### RetroArch
Activa *Ajustes → Guardado → Registrar tiempo de juego (por contenido)*. Después, en **Horas → 🕹 RetroArch**, elige la carpeta `playlists/logs`. La consola se deduce del núcleo (Snes9x → SNES, mGBA → GBA, Citra → 3DS…).

### CSV
Columnas `titulo`, `plataforma`, `horas` (admite `12,5`, `12:30`, `12h 30m`) o `minutos`, y opcional `ultima_vez`. Separador `,`, `;` o tabulador.

Todas las fuentes se normalizan a `{title, platform, hours, last_played, source}`. El emparejado usa similitud de títulos normalizados (sin tildes, números romanos → arábigos…) más la plataforma, y siempre hay vista previa antes de guardar.

## Estructura

| Archivo | Función |
|---|---|
| `index.html`, `css/styles.css` | Interfaz |
| `js/app.js` | Vistas, filtros, órdenes, fichas, fotos, importación, QR, estadísticas |
| `js/backend.js` | «Servidor» sobre GitHub: lectura de Pages, commits por API, sesión de editor por QR |
| `js/vision.js` | Identificación por foto con Claude |
| `js/covers.js` | Búsqueda de carátulas en Wikipedia |
| `js/importers.js`, `js/util.js` | Importadores de horas y normalización/similitud de títulos |
| `js/platforms.js` | Colores, abreviaturas y alturas de caja por consola, y portada generada |
| `data/games.json` | El catálogo |
| `covers/` | Copias de las carátulas |
