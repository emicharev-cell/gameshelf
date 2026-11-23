// Identificación de juegos por foto con Claude (visión + salida estructurada JSON).
// - identifyShelf(image): lee los lomos de una estantería → lista de juegos.
// - identifyItem(images): carátula / lomo / cartucho / disco → un juego con metadatos.
// Versión navegador: la clave de Claude vive SOLO en el dispositivo del editor (localStorage) y nunca llega al repo.
// El SDK oficial se carga bajo demanda desde un CDN (los invitados no lo descargan nunca).
const MODEL = 'claude-opus-5-5';
let client = null, clientKey = null, apiKey = null;

export function setVisionKey(k) { apiKey = k || null; }

export function visionAvailable() { return !!apiKey; }

async function getClient() {
  if (!apiKey) throw Object.assign(new Error('Falta la clave de Claude: añádela en 🔑 Configuración.'), { status: 503 });
  if (!client || clientKey !== apiKey) {
    const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk@1.13.0');
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

const PLATFORM_HINT = `Usa nombres de plataforma canónicos: "Nintendo Switch", "Nintendo Switch 2", "Nintendo 3DS", "Nintendo DS", "Wii U", "Wii", "GameCube", "Nintendo 64", "SNES", "NES", "Game Boy Advance", "Game Boy", "PlayStation 5", "PlayStation 4", "PlayStation 3", "PlayStation 2", "PlayStation", "PS Vita", "PSP", "Xbox Series X|S", "Xbox One", "Xbox 360", "Xbox", "PC", "Mega Drive", "Dreamcast", "Saturn". Deduce la plataforma por el diseño del lomo/caja (franja roja de Switch, caja blanca/roja de 3DS, azul de Wii U, negro/azul de PS4/PS5, verde de Xbox...).`;

const nullable = t => ({ type: [t, 'null'] });

const SHELF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['games'],
  properties: {
    games: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'platform', 'confidence', 'spine_text', 'position'],
        properties: {
          title: { type: 'string', description: 'Título oficial completo del juego' },
          platform: nullable('string'),
          confidence: { type: 'number', description: '0..1' },
          spine_text: { type: 'string', description: 'Texto literal leído en el lomo' },
          position: { type: 'integer', description: 'Orden de izquierda a derecha / arriba a abajo, empezando en 1' },
        },
      },
    },
  },
};

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'title', 'platform', 'year', 'genres', 'developer', 'publisher', 'format', 'edition', 'region', 'confidence', 'alternatives'],
  properties: {
    found: { type: 'boolean' },
    title: nullable('string'),
    platform: nullable('string'),
    year: nullable('integer'),
    genres: { type: 'array', items: { type: 'string' } },
    developer: nullable('string'),
    publisher: nullable('string'),
    format: { type: 'string', enum: ['fisico', 'digital', 'especial'] },
    edition: nullable('string'),
    region: nullable('string'),
    confidence: { type: 'number' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'platform'],
        properties: { title: { type: 'string' }, platform: nullable('string') },
      },
    },
  },
};

function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) { const e = new Error('Imagen no válida (se espera data URL JPEG/PNG/WebP)'); e.status = 400; throw e; }
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

async function ask(content, schema, maxTokens = 16000) {
  const response = await (await getClient()).beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // Si un clasificador de seguridad rechazara la petición, la API reintenta en otro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('El modelo rechazó analizar la imagen.'), { status: 422 });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('Respuesta truncada; prueba con una foto con menos juegos.'), { status: 422 });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

export async function identifyShelf(dataUrl) {
  const result = await ask([
    imageBlock(dataUrl),
    {
      type: 'text',
      text: `Esta foto muestra una estantería con videojuegos (lomos de cajas, quizá también cartuchos o discos).
Identifica CADA juego cuyo lomo sea legible, en orden de izquierda a derecha y de arriba a abajo.
- Devuelve el título oficial completo (corrige abreviaturas del lomo, p.ej. "Zelda BOTW" → "The Legend of Zelda: Breath of the Wild").
- ${PLATFORM_HINT}
- confidence: 0.9+ si el texto es claro; 0.5-0.8 si lo deduces por logo/diseño; no incluyas lomos ilegibles.
- No inventes juegos que no aparezcan.`,
    },
  ], SHELF_SCHEMA);
  return result.games || [];
}

export async function identifyItem(dataUrls) {
  const imgs = (Array.isArray(dataUrls) ? dataUrls : [dataUrls]).slice(0, 4).map(imageBlock);
  return ask([
    ...imgs,
    {
      type: 'text',
      text: `Identifica el videojuego de la(s) foto(s): puede ser una carátula, lomo, cartucho, disco, caja o captura de una tienda digital.
Rellena los metadatos con tu conocimiento del juego (año de lanzamiento original en esa plataforma, géneros en español, desarrolladora, editora).
- ${PLATFORM_HINT}
- format: "especial" si se ve una edición coleccionista/limitada/steelbook; "digital" si es una captura de tienda/biblioteca digital; si no, "fisico".
- edition: nombre de la edición si aparece (p.ej. "Edición Coleccionista", "Nintendo Selects", "Greatest Hits").
- region: "PAL", "NTSC-U" o "NTSC-J" si se puede deducir (clasificación PEGI → PAL, ESRB → NTSC-U, CERO → NTSC-J).
- alternatives: hasta 3 alternativas plausibles si hay ambigüedad.
- Si no hay ningún videojuego reconocible: found=false.`,
    },
  ], ITEM_SCHEMA);
}
