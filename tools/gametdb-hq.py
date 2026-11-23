"""Sustituye las carátulas de GameTDB (coverM, escaneos pequeños) por su versión HQ, reducida a 900 px de alto.
Uso: python tools/gametdb-hq.py            (todos los juegos con gametdb_id)
     python tools/gametdb-hq.py 39 40 41   (solo esos ids)
Las DS no tienen HQ en GameTDB: se dejan como están.
"""
import io, json, os, sys, time, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'data', 'games.json')
FOLDER = {'Nintendo Switch': 'switch', 'Nintendo Switch 2': 'switch', 'Nintendo 3DS': '3ds',
          'Nintendo DS': 'ds', 'Wii': 'wii', 'GameCube': 'wii', 'Wii U': 'wiiu'}
UA = {'User-Agent': 'GameShelf/1.0 (catalogo personal; github.com/emicharev-cell/gameshelf)'}


def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            if r.headers.get('Content-Type', '').startswith('image/'):
                return r.read()
    except Exception:
        return None


only = {int(x) for x in sys.argv[1:]}
cat = json.load(open(CATALOG, encoding='utf-8'))
done = 0
for g in cat['games']:
    gid = g.get('gametdb_id')
    if not gid or (only and g['id'] not in only) or g['platform'] not in FOLDER:
        continue
    data = None
    for lang in ('ES', 'EN', 'FR', 'DE', 'IT'):
        url = f"https://art.gametdb.com/{FOLDER[g['platform']]}/coverHQ/{lang}/{gid}.jpg"
        data = fetch(url)
        if data:
            break
        time.sleep(0.1)
    if not data:
        print(f"- {g['id']} {g['title']}: sin HQ")
        continue
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if im.height > 900:
        im = im.resize((round(im.width * 900 / im.height), 900), Image.LANCZOS)
    new = f"covers/{g['id']}-tdbhq-{gid}.jpg"
    im.save(os.path.join(ROOT, new), quality=88, optimize=True)
    old = g.get('cover_local')
    if old and old != new and os.path.exists(os.path.join(ROOT, old)):
        os.remove(os.path.join(ROOT, old))
    g['cover_local'], g['cover_url'] = new, url
    done += 1
    print(f"✓ {g['id']} {g['title']} {im.size}")
    time.sleep(0.3)

json.dump(cat, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"\nHQ aplicadas: {done}")
