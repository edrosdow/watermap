"""UI-Smoke-Test mit Playwright + Leaflet-Ersatz und festen Testdaten (die 8 Slipanlagen aus V6 in tests/fixtures/v6-data,
unabhängig vom aktuellen OSM-Import). Start: python3 tests/ui_smoke.py [shots_dir]"""
import sys, pathlib, json
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
HERE = pathlib.Path(__file__).parent
STUB = (HERE / 'stub' / 'leaflet-stub.js').read_text(encoding='utf-8')
FIXTURE = HERE / 'fixtures' / 'v6-data'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'); SHOTS.mkdir(parents=True, exist_ok=True)

def route_libs(ctx):
    def handler(route):
        url = route.request.url
        if 'leaflet.markercluster' in url and url.endswith('.js'):
            return route.fulfill(status=200, content_type='application/javascript', body='/* kein Cluster im Test */')
        if url.endswith('leaflet.js'):
            return route.fulfill(status=200, content_type='application/javascript', body=STUB)
        if url.endswith('.css'):
            return route.fulfill(status=200, content_type='text/css', body='')
        return route.abort()
    ctx.route('**/unpkg.com/**', handler); ctx.route('**/cdn.jsdelivr.net/**', handler); ctx.route('**/vendor/**', handler)
    def data(route):
        rel = route.request.url.split('/data/', 1)[1].split('?')[0]
        f = FIXTURE / rel
        return route.fulfill(status=200, content_type='application/json', body=f.read_bytes()) if f.is_file() else route.fulfill(status=404, body='')
    ctx.route('**/data/**', data)
    # Details laden auch das Wetter (eigener Test: ui_wetter.py) – hier nur leere Antworten
    ctx.route('**/api/wetter/**', lambda r: r.fulfill(status=200, content_type='application/json',
              body=json.dumps({'current_weather': {'weather': None}, 'weather': {'weather': []}}.get(r.request.url.split('?')[0].rsplit('/', 1)[1], {'alerts': []}))))
    ctx.route('**/nominatim.openstreetmap.org/**', lambda r: r.fulfill(status=200, content_type='application/json',
        body=json.dumps([{'display_name': 'Möhnesee, Kreis Soest, Nordrhein-Westfalen, Deutschland', 'lat': '51.4817', 'lon': '8.1253', 'boundingbox': ['51.43', '51.53', '8.0', '8.25']}])))

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: problems.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1280, 'height': 800}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE',
                            geolocation={'latitude': 50.9, 'longitude': 6.99}, permissions=['geolocation'],
                            service_workers='block')   # sonst laufen Datenabrufe am Testdaten-Umweg vorbei
        route_libs(ctx)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto(BASE); pg.wait_for_selector('.place', timeout=8000)
        print(f'--- {name}')
        check(pg.locator('.place').count() == 8, f'{name}: 8 Slipanlagen in der Liste')
        check(pg.locator('.leaflet-marker-icon').count() >= 1, f'{name}: Marker im Kartenfenster ({pg.locator(".leaflet-marker-icon").count()})')
        pg.screenshot(path=str(SHOTS / f'{name}_start.png'))
        # Kategorie ohne Daten
        if mobile: pg.click('#sheet-handle'); pg.wait_for_timeout(350)
        pg.click('.chip-marina'); pg.wait_for_timeout(150)
        check('Noch keine Marinas' in pg.inner_text('#list'), f'{name}: Leerzustand Marinas ehrlich')
        pg.click('.chip-slip'); pg.wait_for_timeout(150)
        # Unterfilter ohne Daten ist deaktiviert und blendet nichts aus
        chip = pg.locator('.chip-sub:has-text("Kostenlos")')
        check(chip.get_attribute('aria-disabled') == 'true', f'{name}: Filter "Kostenlos" ohne Daten ist als deaktiviert markiert')
        chip.click(force=True); pg.wait_for_timeout(150)
        check(pg.locator('.place').count() == 8, f'{name}: Filter "Kostenlos" ohne Daten blendet nichts aus')
        check('bestätigten Angaben' in pg.inner_text('#toast'), f'{name}: Hinweis statt stiller Leere')
        # Detail
        pg.click('.place >> nth=0'); pg.wait_for_selector('#detail:not([hidden])')
        txt = pg.inner_text('#detail')
        check('Nicht bekannt' in txt, f'{name}: unbekannte Angaben als "Nicht bekannt"')
        check('keine Wasserroute' in txt, f'{name}: Hinweis Straßenroute ≠ Wasserroute')
        check('nicht vor Ort geprüft' in txt, f'{name}: OSM-Hinweis')
        check('#p=' in pg.url, f'{name}: Deep-Link gesetzt')
        pg.screenshot(path=str(SHOTS / f'{name}_detail.png'))
        # Favorit
        pg.click('#detail .fav'); pg.wait_for_timeout(100)
        check(pg.locator('#detail .fav.is-on').count() == 1, f'{name}: Favorit gesetzt')
        # Formular Fehler melden
        pg.click('#detail button:has-text("Fehler melden")'); pg.wait_for_selector('#dlg[open]')
        pg.screenshot(path=str(SHOTS / f'{name}_form.png'))
        pg.click('#dlg .btn-primary'); pg.wait_for_timeout(100)
        check('Pflichtfelder' in pg.inner_text('#dlg') or 'Standort' in pg.inner_text('#dlg'), f'{name}: Validierung meldet fehlende Angaben')
        pg.click('#dlg-close')
        # Suche
        pg.fill('#q', 'Moers'); pg.wait_for_timeout(300)
        check('Sliprampe Moers' in pg.inner_text('#suggest'), f'{name}: lokale Suche findet Standort')
        pg.fill('#q', 'Möhnesee'); pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
        check(pg.evaluate('window.__watermap.state.map.getZoom()') >= 10, f'{name}: Ortssuche zoomt')
        # Menü
        pg.click('#btn-menu'); pg.wait_for_selector('#menu[open]')
        check('Neue Slipanlage melden' in pg.inner_text('#menu'), f'{name}: Menü')
        pg.screenshot(path=str(SHOTS / f'{name}_menu.png'))
        pg.click('#menu-close')
        check(not errors, f'{name}: keine JS-Fehler {errors[:3]}')
        ctx.close()
    b.close()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
