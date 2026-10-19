"""PWA-/Offline-Test: Service Worker registriert sich, Daten bleiben offline lesbar. Start: python3 tests/pwa_test.py"""
import pathlib, sys
from playwright.sync_api import sync_playwright
STUB = (pathlib.Path(__file__).parent / 'stub' / 'leaflet-stub.js').read_text(encoding='utf-8')
BASE = 'http://localhost:8765/'
bad = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: bad.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1200, 'height': 800}, service_workers='allow')
    def h(route):
        u = route.request.url
        if u.endswith('leaflet.js'): return route.fulfill(status=200, content_type='application/javascript', body=STUB)
        if u.endswith('.css') or 'markercluster' in u: return route.fulfill(status=200, content_type='text/css' if u.endswith('.css') else 'application/javascript', body='')
        route.abort()
    ctx.route('**/unpkg.com/**', h); ctx.route('**/cdn.jsdelivr.net/**', h)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('.place')
    pg.wait_for_function("navigator.serviceWorker.ready.then(r => !!r.active)", timeout=10000)
    pg.reload(); pg.wait_for_selector('.place')
    check(pg.evaluate("!!navigator.serviceWorker.controller"), 'Service Worker steuert die Seite')
    names = pg.evaluate("caches.keys()")
    check(any(n.startswith('watermap-shell') for n in names), f'Zwischenspeicher angelegt {names}')
    cached = pg.evaluate("caches.open(%r).then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname))" % [n for n in names if 'shell' in n][0])
    check('/data/osm/slip.geojson' in cached and '/index.html' in cached or '/' in cached, f'Daten und Seite zwischengespeichert ({len(cached)} Dateien)')
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('.place', timeout=10000)
    check(pg.locator('.place').count() == 8, 'Offline: Standortliste weiterhin vorhanden')
    check(pg.locator('#offline').is_visible(), 'Offline: Hinweis sichtbar')
    pg.click('.place >> nth=0'); pg.wait_for_selector('#detail:not([hidden])')
    check('Nicht bekannt' in pg.inner_text('#detail'), 'Offline: Details öffnen')
    ctx.set_offline(False)
    check(not errs, f'Keine JS-Fehler {errs[:2]}')
    # Manifest
    import json, urllib.request
    m = json.load(urllib.request.urlopen(BASE + 'manifest.webmanifest'))
    check(all(pathlib.Path('/home/claude/watermap/public', i['src']).exists() for i in m['icons']), 'Manifest-Icons vorhanden')
    b.close()
sys.exit(1 if bad else 0)
