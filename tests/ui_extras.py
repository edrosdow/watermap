"""UI-Test der OSM-Extras (Schleusen, Brücken, Wehre, Service, „In der Nähe“) mit echtem Leaflet und der CSP aus
public/_headers. Die Extras-Datei und der Verweis in meta.json werden im Test erzeugt – unabhängig davon, ob der
Import sie schon geschrieben hat.   Start: python3 tests/ui_extras.py [screenshots-ordner]"""
import functools, json, pathlib, re, struct, sys, tempfile, threading, zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8769
BASE = f'http://127.0.0.1:{PORT}/'

HDR, cur = {}, None
for line in (ROOT / '_headers').read_text(encoding='utf-8').splitlines():
    if not line.strip() or line.startswith('#'): continue
    if not line.startswith(' '): cur = line.strip(); continue
    if cur == '/*': k, v = line.strip().split(':', 1); HDR[k.strip()] = v.strip()

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HDR.items(): self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass

# Bezugspunkt: ein echter, benannter Standort aus den Daten
slips = json.loads((ROOT / 'data/osm/slip.geojson').read_text(encoding='utf-8'))['features']
ANCHOR = next(f for f in slips if f['properties'].get('name') and 50.5 < f['geometry']['coordinates'][1] < 52)
LON, LAT = ANCHOR['geometry']['coordinates']
D = 0.0009   # ≈ 100 m

def feat(i, kind, dlat, dlon, **p):
    attrs = p.pop('attrs', {})
    return {'type': 'Feature', 'id': f'node/{9_000_000 + i}', 'geometry': {'type': 'Point', 'coordinates': [round(LON + dlon, 6), round(LAT + dlat, 6)]},
            'properties': {'kind': kind, **p, 'attrs': attrs, 'osm': {'type': 'node', 'id': 9_000_000 + i}}}

EXTRAS = [
    feat(1, 'bridge', D * 1, 0, name='Hubbrücke Test', attrs={'clearance': 4.5, 'clearance_closed': 3.2, 'category': 'lifting'}),
    feat(2, 'lock', D * 2, D, name='Schleuse Test', attrs={'length': 110.0, 'width': 12.0, 'vhf': '20'}, opening_hours='Mo-Su 06:00-22:00'),
    feat(3, 'weir', -D * 3, 0, name='Wehr Test'),
    feat(4, 'toilets', 0, D * 0.5, fee=False, attrs={'wheelchair': True}),
    feat(5, 'water', 0, -D, attrs={'sub': 'water_point', 'drinkable': False}),
    feat(6, 'parking', -D, D, fee=True, attrs={'capacity': 40, 'trailer': True}),
    feat(7, 'food', D * 3, -D, name='Biergarten am Steg', attrs={'sub': 'biergarten', 'cuisine': 'german;regional'}, website='https://example.org'),
    feat(8, 'canoe', -D * 2, -D, attrs={'put_in': True, 'egress': True}),
    feat(9, 'rental', D * 4, D * 2, name='Kanuverleih Test', opening_hours='Sa-Su 10:00-18:00', phone='+49 201 123456'),
    feat(10, 'rest', -D * 4, D * 2, attrs={'sub': 'camp_site'}),
    feat(11, 'toilets', D * 30, D * 30),                       # ≈ 4 km entfernt: nicht „in der Nähe“
]
FC = json.dumps({'type': 'FeatureCollection', 'features': EXTRAS})
META = json.loads((ROOT / 'data/meta.json').read_text(encoding='utf-8'))
META.setdefault('files', {})['extras'] = 'osm/extras.geojson'
META['files']['hafeninfo'] = 'hafeninfo.json'
HAFENINFO = json.dumps({'generated': '2026-10-20', 'places': {ANCHOR['id']: {
    'checked': '2026-10-20', 'status': 'ok', 'source': 'https://www.marina-test.de/', 'facts': [
        {'key': 'gast_liegeplatz', 'value': '3,00 € pro lfd. Meter und Tag (mind. 7 m), inkl. Strom', 'price_eur': 3.0,
         'quote': '3,00 € / lfd. Meter / Tag (Berechnung mind. 7m) inkl. Strom', 'url': 'https://www.marina-test.de/hafen/'},
        {'key': 'faekalien', 'value': '15,00 € pro Tank (bis 300 l)', 'price_eur': 15.0, 'quote': '15,00 € Fäkalienabsaugung pro Tank (bis 300L)', 'url': 'https://www.marina-test.de/hafen/'},
        {'key': 'wlan', 'value': '<img src=x onerror="window.__xss=1">kostenlos', 'price_eur': None, 'quote': 'WLAN - kostenlos', 'url': 'https://www.marina-test.de/hafen/'},
        {'key': 'unbekannt', 'value': 'darf nicht erscheinen', 'price_eur': None, 'quote': 'x', 'url': 'https://www.marina-test.de/'}]}}})

extras_calls = []
mode = {'missing': False}

# „In der Nähe“ live (/.netlify/functions/umgebung): standardmäßig überlastet (503) → Rückfall auf den Import
def m2deg(dn, de):
    import math
    return LAT + dn / 111_000, LON + de / (111_000 * math.cos(math.radians(LAT)))
def osm(t, i, dn, de, tags, area=False):
    la, lo = m2deg(dn, de)
    return {'type': t, 'id': 8_000_000 + i, 'tags': tags, **({'center': {'lat': la, 'lon': lo}} if area else {'lat': la, 'lon': lo})}
LIVE = [
    osm('way', 1, 300, 0, {'tourism': 'camp_site', 'name': 'Abenteuercamp Test'}, area=True),      # Fläche, Mittelpunkt 300 m
    osm('node', 2, 0, 200, {'shop': 'supermarket', 'name': 'Markt Test'}),
    osm('way', 3, -450, 0, {'amenity': 'parking'}, area=True),
    osm('node', 4, 120, 0, {'amenity': 'restaurant', 'name': 'Gasthof Test'}),
    osm('way', 5, 0, -600, {'amenity': 'parking', 'name': 'Zu weit'}, area=True),                  # Mittelpunkt > 500 m
    osm('way', 6, 50, 50, {'amenity': 'parking', 'access': 'private', 'name': 'Privat'}, area=True),
    osm('way', 7, 250, 250, {'tourism': 'caravan_site'}, area=True),
    osm('node', 8, 10, 10, {'amenity': 'bench'}),                                                    # nicht gefragt
]
live = {'mode': 'down', 'queries': []}
def overpass(route):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(route.request.url).query)
    if route.request.method == 'POST':   # direkt aus dem Browser: Overpass-Abfrage im Formular
        m = re.search(r'around:\d+,([\d.]+),([\d.]+)', parse_qs(route.request.post_data or '').get('data', [''])[0])
        q = {'lat': [m.group(1)], 'lon': [m.group(2)], 'direkt': ['1']} if m else {}
    live['queries'].append(q)
    cors = {'access-control-allow-origin': '*'}   # wie der echte Overpass-Server
    if live['mode'] == 'down': return route.fulfill(status=503, headers=cors, body='busy')
    els = LIVE if live['mode'] == 'data' else []
    route.fulfill(status=200, content_type='application/json', headers=cors, body=json.dumps({'elements': els}))

def extras(route):
    extras_calls.append(1)
    if mode['missing']: return route.fulfill(status=404, body='')
    route.fulfill(status=200, content_type='application/geo+json', body=FC)

def png(w=256, h=256, rgb=(220, 233, 229)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
TILE = png()
EMPTY_WX = lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(
    {'current_weather': {'weather': None}, 'weather': {'weather': []}}.get(r.request.url.split('?')[0].rsplit('/', 1)[1], {'alerts': []})))

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1280, 'height': 900}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        print(f'--- {name}')
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE', service_workers='block')
        ctx.route('**/data/meta.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(META)))
        ctx.route('**/data/osm/extras.geojson', extras)
        ctx.route('**/data/hafeninfo.json', lambda r: r.fulfill(status=200, content_type='application/json', body=HAFENINFO))
        ctx.route('**/api/wetter/**', EMPTY_WX)
        ctx.route('**/.netlify/functions/umgebung*', overpass)
        ctx.route('https://overpass-api.de/**', overpass)
        ctx.route(re.compile(r'https://([a-c]\.)?tile\.openstreetmap\.org/.*'), lambda r: r.fulfill(status=200, content_type='image/png', body=TILE))
        ctx.route(re.compile(r'https://(?!(([a-c]\.)?tile\.openstreetmap\.org|overpass-api\.de/)).*'), lambda r: r.abort())
        ctx.add_init_script("document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI));")
        ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); } catch {}")
        ctx.add_init_script("try { if (localStorage.getItem('watermap.cats') === null) { localStorage.setItem('watermap.cats', 'slip,marina,fuel'); localStorage.setItem('watermap.listOpen', '1'); } } catch {}")   # alte Ansicht: alle Kategorien, Liste offen
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 503' not in m.text else None)   # 503 = Overpass absichtlich überlastet
        pg.goto(BASE); pg.wait_for_selector('.wm-cluster, .wm-pin', timeout=20000)

        check(pg.locator('.chip-extra').count() == 2, f'{name}: Chips „Schleusen & Brücken“ und „Service“')
        check(not extras_calls, f'{name}: Extras werden erst bei Bedarf geladen')

        # Standort öffnen → „In der Nähe“
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(ANCHOR['id'])})")
        pg.wait_for_selector('#detail .nearby-item', timeout=8000)
        items = pg.locator('#detail .nearby-item')
        check(items.count() == 10, f'{name}: 10 Einträge in der Nähe, der entfernte nicht ({items.count()})')
        dists = [t for t in pg.locator('#detail .nearby-dist').all_inner_texts()]
        check(dists[0].endswith(' m') and 'Toilette' in items.first.inner_text(), f'{name}: nach Entfernung sortiert ({dists[:3]})')
        txt = pg.inner_text('#detail .nearby-list')
        check('Durchfahrtshöhe 4,5 m' in txt and 'kein Trinkwasser' in txt and 'Kanu-Ein- und Ausstieg' in txt, f'{name}: Kurzinfos in der Liste')
        check('null' not in txt and 'undefined' not in txt, f'{name}: kein „null“/„undefined“ im Text')
        pg.wait_for_selector('#detail .nearby-hinweis', timeout=8000)
        hint = pg.inner_text('#detail .nearby-hinweis')
        check('overpass-api.de: HTTP 503' in hint and 'HTTP 503' in hint.split(';')[-1], f'{name}: Hinweis nennt den Grund der fehlgeschlagenen Live-Abfrage ({hint})')
        pg.locator('#detail .nearby-list').scroll_into_view_if_needed()
        pg.screenshot(path=str(SHOTS / f'{name}_1_in_der_naehe.png'))

        # Hafeninfos laut Website füllen die Eigenschaften-Tabelle
        pg.wait_for_selector('#detail .facts-block .hi-note', timeout=8000)
        fb = pg.locator('#detail .facts-block')
        hi = fb.inner_text()
        check('Eigenschaften' in hi and 'Gastliegeplatz' in hi and '3,00 € pro lfd. Meter und Tag' in hi and 'Fäkalienabsaugung' in hi and 'WLAN' in hi,
              f'{name}: Website-Angaben als Zeilen der Eigenschaften')
        check(pg.locator('#detail .facts-block .facts').count() == 1 and pg.locator('#detail .hi-block').count() == 0, f'{name}: eine Tabelle, kein eigener Block')
        check(pg.locator('#detail .facts-block dd.from-web .web-mark').count() == 3, f'{name}: Website-Werte markiert')
        check('darf nicht erscheinen' not in hi, f'{name}: unbekannte Schlüssel werden nicht gezeigt')
        check('marina-test.de' in hi and 'ohne gewähr' in hi.lower() and '20.10.2026' in hi, f'{name}: Quelle, Datum und Hinweis')
        check('<img' in hi and not pg.evaluate('window.__xss') and pg.locator('#detail .facts-block img').count() == 0, f'{name}: HTML in Daten bleibt Text')
        check(fb.locator('.web-line').first.get_attribute('title') == '„3,00 € / lfd. Meter / Tag (Berechnung mind. 7m) inkl. Strom“', f'{name}: Zitat als Tooltip')
        rows = pg.evaluate("""() => import('./js/hafeninfo.js').then(m => m.mergeFacts(
            ['Zugang', 'Gastliegeplätze', 'Liegeplatzgebühr', 'Stromanschluss', 'Öffnungszeiten'].map(label => ({ label, value: null })),
            [{ key: 'gast_liegeplatz', value: '3 €' }, { key: 'strom', value: '0,70 €/kWh' }, { key: 'kran', value: 'Kran bis 10 t' }, { key: 'sonstiges', value: 'x' }])
            .map(r => [r.label, r.value, (r.web || []).map(w => w.value).join('|')]))""")
        check(rows == [['Zugang', None, ''], ['Gastliegeplätze', 'Ja', ''], ['Liegeplatzgebühr', None, '3 €'], ['Stromanschluss', None, '0,70 €/kWh'],
                       ['Kran', None, 'Kran bis 10 t'], ['Öffnungszeiten', None, '']], f'{name}: Marina-Felder werden gefüllt, Rest als eigene Zeilen ({rows})')
        fb.scroll_into_view_if_needed(); pg.screenshot(path=str(SHOTS / f'{name}_0_hafeninfo.png'))

        # Eintrag anklicken → Detail
        pg.locator('#detail .nearby-item', has_text='Hubbrücke').click()
        pg.wait_for_selector('#detail .facts')
        d = pg.inner_text('#detail')
        check('Hubbrücke Test' in d and '4,5 m' in d and '3,2 m' in d and 'Hubbrücke' in d, f'{name}: Brücken-Detail mit Höhen und Bauart')
        check('Pegel' in d, f'{name}: Hinweis, dass die Höhe vom Pegel abhängt')
        check('#x=node%2F9000001' in pg.url, f'{name}: Deep-Link #x=')
        pg.screenshot(path=str(SHOTS / f'{name}_2_bruecke.png'))
        pg.evaluate("window.__watermap.selectExtra('node/9000003', { fly: false })"); pg.wait_for_timeout(150)
        check('lebensgefährlich' in pg.inner_text('#detail'), f'{name}: Wehr mit Warnhinweis')
        pg.evaluate("window.__watermap.selectExtra('node/9000002', { fly: false })"); pg.wait_for_timeout(150)
        d = pg.inner_text('#detail')
        check('110 m' in d and '12 m' in d and '20' in d and 'Mo-Su 06:00-22:00' in d, f'{name}: Schleusen-Detail')
        pg.evaluate("window.__watermap.selectExtra('node/9000004', { fly: false })"); pg.wait_for_timeout(150)
        d = pg.inner_text('#detail')
        check('Rollstuhlgerecht' in d and 'Wickeltisch' in d and 'Nicht bekannt' in d, f'{name}: Unbekanntes bleibt „Nicht bekannt“')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        check(pg.locator('#detail').is_hidden(), f'{name}: Escape schließt')

        # Ebenen
        pg.locator('.chip-extra-wasser').click(); pg.wait_for_timeout(400)
        pg.evaluate(f"window.__watermap.state.map.raw.setView([{LAT}, {LON}], 16, {{ animate: false }})"); pg.wait_for_timeout(500)
        check(pg.locator('.wm-extra').count() == 3, f'{name}: Ebene „Schleusen & Brücken“ zeigt 3 Einträge ({pg.locator(".wm-extra").count()})')
        check(pg.locator('.wm-extra.has-label', has_text='4,5').count() == 1, f'{name}: Brücke zeigt Durchfahrtshöhe am Marker')
        check(pg.locator('.chip-extra-wasser .chip-n').inner_text() == '3', f'{name}: Zähler am Chip')
        pg.locator('.chip-extra-service').click(); pg.wait_for_timeout(500)
        check(pg.locator('.wm-extra').count() == 10, f'{name}: mit „Service“ 10 Einträge im Ausschnitt ({pg.locator(".wm-extra").count()})')
        pg.screenshot(path=str(SHOTS / f'{name}_3_ebenen.png'))
        m = pg.locator('.wm-extra', has_text='4,5')
        bx = m.bounding_box()
        (pg.touchscreen.tap if mobile else pg.mouse.click)(bx['x'] + 13, bx['y'] + 13)
        pg.wait_for_selector('#detail .facts', timeout=5000)
        check('Hubbrücke Test' in pg.inner_text('#detail') and pg.locator('.wm-extra.is-selected').count() == 1, f'{name}: Marker-Klick öffnet Detail und hebt hervor')
        pg.keyboard.press('Escape')

        # Deep-Link und gemerkte Ebenen
        pg2 = ctx.new_page(); pg2.goto(BASE + '#x=node%2F9000009')
        pg2.wait_for_selector('#detail .facts', timeout=15000)
        check('Kanuverleih Test' in pg2.inner_text('#detail'), f'{name}: Deep-Link öffnet Eintrag direkt')
        check(pg2.locator('.chip-extra.is-active').count() == 2, f'{name}: eingeschaltete Ebenen werden gemerkt')
        pg2.close()

        pg.locator('.chip-extra-wasser').click(); pg.locator('.chip-extra-service').click(); pg.wait_for_timeout(300)
        check(pg.locator('.wm-extra').count() == 0, f'{name}: Ausschalten entfernt die Marker')

        # „In der Nähe“ live aus OSM: Flächen mit Mittelpunkt, Supermarkt, Campingplatz; Import ergänzt Brücken/Wehre/Kanu/Verleih
        live['mode'] = 'data'; live['queries'].clear()
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(ANCHOR['id'])})")
        pg.wait_for_selector('#detail .nearby-item:has-text("Markt Test")', timeout=8000)
        q = live['queries'][-1] if live['queries'] else {}
        check(abs(float(q.get('lat', ['0'])[0]) - LAT) < 1e-4 and abs(float(q.get('lon', ['0'])[0]) - LON) < 1e-4, f'{name}: Abfrage mit den Koordinaten des Standorts')
        check(q.get('direkt') == ['1'], f'{name}: Abfrage direkt beim Overpass-Server')
        txt = pg.inner_text('#detail .nearby-list')
        check('Abenteuercamp Test' in txt and 'Markt Test' in txt and 'Gasthof Test' in txt and 'Wohnmobilstellplatz' in txt and 'Parkplatz' in txt,
              f'{name}: Campingplatz, Supermarkt, Restaurant, Wohnmobilstellplatz, Parkplatz aus OSM')
        check('Zu weit' not in txt and 'Privat' not in txt, f'{name}: Mittelpunkt über 500 m und private Parkplätze nicht dabei')
        check('Hubbrücke Test' in txt and 'Wehr Test' in txt and 'Kanuverleih Test' in txt and 'Biergarten am Steg' not in txt,
              f'{name}: Brücken/Wehre/Kanu aus dem Import, Service nur live (keine Doppelten)')
        ds = [int(re.sub(r'\D', '', t)) if t.endswith(' m') else 99999 for t in pg.locator('#detail .nearby-dist').all_inner_texts()]
        check(ds == sorted(ds), f'{name}: nach Entfernung sortiert {ds}')
        camp = next(t for t in pg.locator('#detail .nearby-item').all_inner_texts() if 'Abenteuercamp' in t)
        check(re.search(r'\b(29\d|30\d) m', camp) is not None, f'{name}: Entfernung zum Mittelpunkt der Fläche ({camp.splitlines()[-1]})')
        sub = pg.locator('#detail .nearby-item', has_text='Abenteuercamp').locator('.nearby-sub').inner_text()
        check(sub == 'Campingplatz', f'{name}: Untertitel nur „Campingplatz“ ({sub})')
        pg.locator('#detail .nearby-item', has_text='Markt Test').click(); pg.wait_for_timeout(200)
        check('Markt Test' in pg.inner_text('#detail h2') and 'Supermarkt' in pg.inner_text('#detail'), f'{name}: Live-Eintrag öffnet seine Details')
        # Nichts gefunden: neuer Text, keine Behauptung über OSM
        live['mode'] = 'empty'
        far = next(f for f in slips if abs(f['geometry']['coordinates'][1] - LAT) > 1)
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(far['id'])})")
        pg.wait_for_selector('#detail .nearby-list:not([aria-busy])'); pg.wait_for_timeout(300)
        check(pg.inner_text('#detail .nearby-list').strip() == 'Keine weiteren Einrichtungen in unseren Daten gefunden.', f'{name}: Text bei leerem Ergebnis')
        live['mode'] = 'down'
        pg.keyboard.press('Escape')

        csp = pg.evaluate('window.__csp || []')
        check(not csp, f'{name}: keine CSP-Verstöße {csp[:3]}')
        errs = [e for e in errors if 'favicon' not in e]
        check(not errs, f'{name}: keine Konsolenfehler {errs[:3]}')

        # Datei fehlt → Hinweis, Chip bleibt aus (frische Seite, damit nichts zwischengespeichert ist)
        mode['missing'] = True
        pg3 = ctx.new_page(); pg3.goto(BASE); pg3.wait_for_selector('.chip-extra')
        pg3.locator('.chip-extra-service').click(); pg3.wait_for_timeout(500)
        check('nicht geladen' in pg3.inner_text('#toast') and pg3.locator('.chip-extra-service').get_attribute('aria-pressed') == 'false',
              f'{name}: fehlende Datei → Hinweis, Ebene bleibt aus')
        mode['missing'] = False
        ctx.close(); extras_calls.clear()
    b.close()
srv.shutdown()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
