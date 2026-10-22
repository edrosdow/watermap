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
    ctx.route('**/.netlify/functions/umgebung*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"elements": []}'))   # „In der Nähe“ live
    ctx.route('https://overpass-api.de/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"elements": []}'))
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
        ctx.add_init_script("try { if (localStorage.getItem('watermap.cats') === null) { localStorage.setItem('watermap.cats', 'slip,marina,fuel'); localStorage.setItem('watermap.listOpen', '1'); } } catch {}")   # alte Ansicht: alle Kategorien, Liste offen
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto(BASE + '#liste'); pg.wait_for_selector('.place', timeout=8000)
        print(f'--- {name}')
        check(pg.locator('.place').count() == 8, f'{name}: 8 Slipanlagen in der Liste')
        check(pg.locator('.leaflet-marker-icon').count() >= 1, f'{name}: Marker im Kartenfenster ({pg.locator(".leaflet-marker-icon").count()})')
        pg.screenshot(path=str(SHOTS / f'{name}_start.png'))
        # Kategorie ohne Daten
        pg.click('.cat-slip'); pg.click('.cat-fuel'); pg.wait_for_timeout(150)      # nur Häfen
        check('Noch keine Marinas' in pg.inner_text('#list'), f'{name}: Leerzustand Marinas ehrlich')
        pg.click('.cat-marina'); pg.click('.cat-slip'); pg.wait_for_timeout(150)    # nur Slipanlagen
        check(pg.locator('.cat-slip').get_attribute('aria-pressed') == 'true' and pg.locator('.cat-marina').get_attribute('aria-pressed') == 'false', f'{name}: Kategorie-Umschalter mit aria-pressed')
        # Unterfilter ohne Daten ist deaktiviert und blendet nichts aus
        pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]')
        chip = pg.locator('#filter-panel [data-key=sub-free]')
        check(chip.get_attribute('aria-disabled') == 'true', f'{name}: Filter "Kostenlos" ohne Daten ist als deaktiviert markiert')
        chip.click(force=True); pg.wait_for_timeout(150)
        check('bestätigten Angaben' in pg.inner_text('#toast'), f'{name}: Hinweis statt stiller Leere')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        check(pg.locator('#filter-panel[open]').count() == 0 and pg.evaluate("document.activeElement.id") == 'btn-filter', f'{name}: Escape schließt Filter, Fokus zurück auf den Knopf')
        check(pg.locator('.place').count() == 8, f'{name}: Filter "Kostenlos" ohne Daten blendet nichts aus')
        # Detail
        pg.click('.place >> nth=0')
        if mobile:   # Handy: erst die Vorschau-Karte, „Details“ öffnet das Panel
            pg.wait_for_selector('#peek:not([hidden])')
            check(pg.locator('#sidebar').is_hidden() and pg.locator('#bottomnav [data-nav=karte]').get_attribute('aria-current') == 'page', f'{name}: Antippen in der Liste zeigt die Karte mit Vorschau')
            pg.click('#peek button:has-text("Details")')
        pg.wait_for_selector('#detail:not([hidden])')
        txt = pg.inner_text('#detail')
        check('Nicht bekannt' not in txt and pg.locator('#detail .facts-more').is_visible(), f'{name}: unbekannte Angaben eingeklappt')
        pg.click('#detail .facts-more')
        check('Nicht bekannt' in pg.inner_text('#detail'), f'{name}: aufgeklappt als "Nicht bekannt"')
        check('keine Wasserroute' in (pg.get_attribute('#detail .dbtn-primary', 'title') or ''), f'{name}: Hinweis Straßenroute ≠ Wasserroute')
        check(pg.locator('#detail', has_text='OpenStreetMap-Route').count() == 0, f'{name}: keine OpenStreetMap-Route')
        check('OpenStreetMap · ungeprüft' in txt and 'nicht vor ort geprüft' not in txt.lower(), f'{name}: OSM-Herkunft dezent')
        pg.click('#detail .trust')
        check('nicht vor ort geprüft' in pg.inner_text('#detail').lower(), f'{name}: OSM-Hinweis beim Antippen')
        check('p=' in pg.url.split('#')[-1], f'{name}: Deep-Link gesetzt ({pg.url.split("#")[-1]})')
        pg.screenshot(path=str(SHOTS / f'{name}_detail.png'))
        # Favorit
        pg.click('#detail .fav'); pg.wait_for_timeout(100)
        check(pg.locator('#detail .fav[aria-pressed=true]').count() == 1 and 'Gemerkt' in pg.inner_text('#detail .fav'), f'{name}: Favorit gesetzt („Merken“)')
        nav = '#bottomnav' if mobile else '#topnav'
        check(pg.locator(f'{nav} [data-nav=favoriten] .nav-badge').inner_text() == '1', f'{name}: Favoriten mit Anzahl in der Navigation')
        pg.evaluate('window.__watermap.applyFilters()')   # Stub zeichnet setIcon in Gruppen nicht neu
        check(pg.locator('.wm-pin.is-fav .wm-fav').count() >= 1, f'{name}: Favorit-Pin mit Stern')
        # Formular Fehler melden
        pg.click('#detail .detail-links button:has-text("Fehler melden")'); pg.wait_for_selector('#dlg[open]')
        pg.screenshot(path=str(SHOTS / f'{name}_form.png'))
        pg.click('#dlg .btn-primary'); pg.wait_for_timeout(100)
        check('Pflichtfelder' in pg.inner_text('#dlg') or 'Standort' in pg.inner_text('#dlg'), f'{name}: Validierung meldet fehlende Angaben')
        pg.click('#dlg-close')
        # Suche
        pg.fill('#q', 'Moers'); pg.wait_for_timeout(300)
        check('Sliprampe Moers' in pg.inner_text('#suggest'), f'{name}: lokale Suche findet Standort')
        pg.fill('#q', 'Möhnesee'); pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
        check(pg.evaluate('window.__watermap.state.map.getZoom()') >= 10, f'{name}: Ortssuche zoomt')
        # Melden
        pg.click('#bottomnav [data-nav=melden]' if mobile else '#btn-report'); pg.wait_for_selector('#report-menu[open]')
        txt = pg.inner_text('#report-menu')
        check(all(t in txt for t in ['Neue Slipanlage melden', 'Kraftstoffpreis melden', 'Foto einreichen', 'Fehler oder Hinweis melden', 'Impressum', 'Version']), f'{name}: Melden mit vier Aktionen und Links')
        pg.screenshot(path=str(SHOTS / f'{name}_menu.png'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        check(pg.locator('#report-menu[open]').count() == 0, f'{name}: Escape schließt „Melden“')
        # Navigation und Zurück-Taste
        pg.click(f'{nav} [data-nav=favoriten]'); pg.wait_for_timeout(150)
        check(pg.url.endswith('#favoriten') and pg.locator('#list-title').inner_text() == 'Favoriten' and pg.locator('.place').count() == 1, f'{name}: Favoriten in der Liste, Adresse #favoriten')
        pg.click(f'{nav} [data-nav=karte]'); pg.wait_for_timeout(150)
        check(pg.locator('#sidebar').is_hidden(), f'{name}: Karte schließt die Liste')
        pg.go_back(); pg.wait_for_timeout(300)
        check(pg.locator('#list-title').inner_text() == 'Favoriten' and pg.locator('#sidebar').is_visible(), f'{name}: Zurück-Taste öffnet wieder die Favoriten')
        pg.reload(); pg.wait_for_selector('.place', timeout=8000)
        check(pg.locator(f'{nav} [data-nav=favoriten]').get_attribute('aria-current') == 'page', f'{name}: Neuladen behält den Bereich')
        check(not errors, f'{name}: keine JS-Fehler {errors[:3]}')
        ctx.close()
    b.close()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
