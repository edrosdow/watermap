"""UI-Test „Wetter und Wind“ mit echtem (selbst gehostetem) Leaflet und der CSP aus public/_headers.
Bright Sky (DWD-Daten) wird durch Testdaten im Format der echten Schnittstelle ersetzt (/api/wetter/** → hier erzeugt).
Start: python3 tests/ui_wetter.py [screenshots-ordner]"""
import datetime as dt, functools, json, math, pathlib, re, struct, sys, tempfile, threading, zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8768
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

# ------------------------------------------------------------------ Testdaten im Bright-Sky-Format (Einheiten „dwd“: km/h, °C, mm)
NOW = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
iso = lambda t: t.isoformat()
ICONS = ['clear-day', 'partly-cloudy-day', 'cloudy', 'rain', 'rain', 'cloudy', 'partly-cloudy-night', 'clear-night']

def current(lat, lon):
    return {'weather': {'timestamp': iso(NOW), 'source_id': 1, 'temperature': 12.4, 'icon': 'partly-cloudy-day', 'condition': 'dry',
                        'wind_speed_10': 18.0, 'wind_direction_10': 225, 'wind_gust_speed_10': 34.2},
            'sources': [{'id': 1, 'station_name': 'KÖLN/BONN', 'distance': 12345, 'observation_type': 'synop', 'lat': lat, 'lon': lon}]}

def forecast(q):
    start = dt.datetime.fromisoformat(q['date'][0].replace('Z', '+00:00')).replace(minute=0, second=0, microsecond=0)
    end = dt.datetime.fromisoformat(q['last_date'][0].replace('Z', '+00:00'))
    out, t, i = [], start, 0
    while t <= end:
        wind = 14 + 12 * math.sin(i / 7) + (8 if 6 <= i <= 12 else 0)
        out.append({'timestamp': iso(t), 'source_id': 2, 'temperature': 10 + 4 * math.sin((i - 6) / 24 * 2 * math.pi), 'icon': ICONS[(i // 3) % 8],
                    'wind_speed': round(max(wind, 2), 1), 'wind_direction': (200 + i * 4) % 360, 'wind_gust_speed': round(max(wind, 2) * 1.7, 1),
                    'precipitation': 0.6 if (i // 3) % 8 in (3, 4) else 0.0, 'precipitation_probability': 70 if (i // 3) % 8 in (3, 4) else 5})
        t += dt.timedelta(hours=1); i += 1
    return {'weather': out, 'sources': [{'id': 2, 'observation_type': 'forecast', 'station_name': 'KOELN/BONN'}]}

def alerts(lat):
    if lat < 51: return {'alerts': [], 'location': {'name': 'Stadt Mainz', 'warn_cell_id': 1}}
    return {'alerts': [
        {'id': 1, 'alert_id': 'x1', 'status': 'actual', 'effective': iso(NOW), 'onset': iso(NOW + dt.timedelta(hours=2)), 'expires': iso(NOW + dt.timedelta(hours=14)),
         'category': 'met', 'response_type': 'prepare', 'urgency': 'future', 'severity': 'moderate', 'certainty': 'likely',
         'event_code': 52, 'event_en': 'gale-force gusts', 'event_de': 'STURMBÖEN', 'headline_en': 'Official WARNING of GALE-FORCE GUSTS',
         'headline_de': 'Amtliche WARNUNG vor STURMBÖEN', 'description_de': 'Es treten Sturmböen mit Geschwindigkeiten um 75 km/h (21 m/s, 41 kn, Bft 9) aus südwestlicher Richtung auf.',
         'instruction_de': 'Achten Sie besonders auf herabstürzende Äste.'},
        {'id': 2, 'alert_id': 'x2', 'status': 'actual', 'effective': iso(NOW), 'onset': iso(NOW), 'expires': iso(NOW + dt.timedelta(hours=6)),
         'severity': 'minor', 'event_de': 'WINDBÖEN', 'headline_de': 'Amtliche WARNUNG vor WINDBÖEN', 'description_de': 'Windböen um 55 km/h.'},
    ], 'location': {'name': 'Stadt Köln', 'warn_cell_id': 2}}

calls, foreign = [], []
fail = {'on': False}

def api(route):
    u = urlparse(route.request.url); q = parse_qs(u.query)
    calls.append((u.path, q))
    if fail['on']: return route.fulfill(status=502, body='Bad Gateway')
    lat, lon = float(q['lat'][0]), float(q['lon'][0])
    ep = u.path.split('/api/wetter/', 1)[1]
    body = {'current_weather': lambda: current(lat, lon), 'weather': lambda: forecast(q), 'alerts': lambda: alerts(lat)}.get(ep)
    if not body: return route.fulfill(status=404, body='{}')
    return route.fulfill(status=200, content_type='application/json', body=json.dumps(body()))

def gauges(route):
    st = [{'uuid': 'a6ee8177-107b-47dd-bcfd-30960ccc6e9c', 'number': '2730010', 'shortname': 'KÖLN', 'longname': 'KÖLN', 'km': 688.0, 'agency': 'WSA RHEIN',
           'longitude': 6.9628, 'latitude': 50.9369, 'water': {'shortname': 'RHEIN', 'longname': 'RHEIN'},
           'timeseries': [{'shortname': 'W', 'unit': 'cm', 'currentMeasurement': {'timestamp': iso(NOW), 'value': 312, 'trend': 1, 'stateMnwMhw': 'normal', 'stateNswHsw': 'normal'},
                           'characteristicValues': []}]}]
    if '/measurements' in route.request.url: return route.fulfill(status=200, content_type='application/json', body='[]')
    return route.fulfill(status=200, content_type='application/json', body=json.dumps(st))

def png(w=256, h=256, rgb=(220, 233, 229)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
TILE = png()

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

PICK = """(north) => { const ps = window.__watermap.state.places;
  return (north ? ps.find(p => p.lat > 51.5 && p.name) : ps.find(p => p.lat < 50.5 && p.name)).id; }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1280, 'height': 900}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        print(f'--- {name}')
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE',
                            timezone_id='Europe/Berlin', service_workers='block',
                            geolocation={'latitude': 48.1, 'longitude': 11.6}, permissions=['geolocation'])
        ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": []}'))   # „Heute vor Ort“ (eigener Test: ui_meldungen.py)
        ctx.route('**/api/wetter/**', api)
        ctx.route('**/.netlify/functions/umgebung*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"elements": []}'))   # „In der Nähe“ live
        ctx.route('https://overpass-api.de/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"elements": []}'))
        ctx.route('**/api/pegel/**', gauges)
        ctx.route(re.compile(r'https://([a-c]\.)?tile\.openstreetmap\.org/.*'), lambda r: r.fulfill(status=200, content_type='image/png', body=TILE))
        ctx.route(re.compile(r'https://(?!(([a-c]\.)?tile\.openstreetmap\.org|overpass-api\.de/)).*'), lambda r: (foreign.append(r.request.url), r.abort()))
        ctx.add_init_script("document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI));")
        ctx.add_init_script("try { if (localStorage.getItem('watermap.cats') === null) { localStorage.setItem('watermap.cats', 'slip,marina,fuel'); localStorage.setItem('watermap.listOpen', '1'); } } catch {}")   # alte Ansicht: alle Kategorien, Liste offen
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto(BASE); pg.wait_for_selector('.wm-cluster, .wm-pin', timeout=20000)
        # Standort freigeben (München) – darf NICHT an den Wetterdienst gehen
        if pg.locator('#banner .btn-primary').count(): pg.click('#banner .btn-primary'); pg.wait_for_timeout(800)
        check(not calls, f'{name}: ohne Detailansicht keine Wetterabfrage')

        north = pg.evaluate(PICK, True)
        place = pg.evaluate(f"window.__watermap.state.byId.get({json.dumps(north)})")
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(north)}, {{ full: true }})")
        pg.wait_for_selector('#detail .wx-wind', timeout=8000)
        txt = pg.inner_text('#detail .wx-block')
        check('Sturmböen'.upper() in txt and 'Markante Wetterwarnung' in txt, f'{name}: amtliche Warnung mit Stufe als Text')
        check(pg.locator('#detail .wx-alert').count() == 2 and pg.locator('#detail .wx-alert').first.get_attribute('class').endswith('moderate'),
              f'{name}: Warnungen nach Schwere sortiert')
        check('18 km/h' in txt and '3 Bft' in txt and 'aus SW' in txt and 'Böen 34 km/h' in txt, f'{name}: aktueller Wind mit Beaufort und Richtung')
        check('12 °C' in txt and 'Köln/Bonn' in txt and '12 km entfernt' in txt, f'{name}: Temperatur und Messstation')
        check('Böen bis' in txt and 'erwartet' in txt, f'{name}: Hinweis auf starke Böen in den nächsten 12 Stunden')
        # Wind aus SW (225°) weht nach NO: der nach Süden zeigende Pfeil wird um 225° gedreht
        check('rotate(225 ' in pg.locator('#detail .wx-now-arrow g').get_attribute('transform'), f'{name}: Pfeil zeigt, wohin der Wind weht')
        check(pg.locator('#detail .wx-dir').count() >= 15, f'{name}: Windrichtungspfeile ({pg.locator("#detail .wx-dir").count()})')
        check(pg.locator('#detail .wx-strip li').count() == 9, f'{name}: 3-Stunden-Übersicht')
        check('Deutscher Wetterdienst' in txt, f'{name}: Quellenangabe DWD')
        q = {path.rsplit('/', 1)[1]: qq for path, qq in calls}
        check(set(q) == {'current_weather', 'weather', 'alerts'}, f'{name}: drei Abfragen über /api/wetter ({sorted(q)})')
        check(all(abs(float(qq['lat'][0]) - place['lat']) < 1e-3 and abs(float(qq['lon'][0]) - place['lon']) < 1e-3 for qq in q.values()),
              f'{name}: gesendet werden die Koordinaten des Standorts')
        check(all(abs(float(qq['lat'][0]) - 48.1) > 0.5 for qq in q.values()), f'{name}: eigener Standort wird nicht gesendet')
        # Fadenkreuz
        pg.locator('#detail .wx .gc-svg').scroll_into_view_if_needed()
        bx = pg.locator('#detail .wx .gc-svg').bounding_box()
        pg.mouse.move(bx['x'] + bx['width'] * 0.4, bx['y'] + bx['height'] * 0.4); pg.wait_for_timeout(150)
        tip = pg.locator('#detail .wx .gc-tip')
        check(tip.is_visible() and 'Wind' in tip.inner_text() and 'Böen' in tip.inner_text() and 'Bft' in tip.inner_text(), f'{name}: Tooltip ({tip.inner_text() if tip.is_visible() else "-"})')
        tb, wb = tip.bounding_box(), pg.locator('#detail .wx .gc-wrap').bounding_box()
        check(tb['x'] >= wb['x'] - 1 and tb['x'] + tb['width'] <= wb['x'] + wb['width'] + 1, f'{name}: Tooltip bleibt im Diagramm')
        pg.mouse.move(bx['x'] + bx['width'] * 34 / 360 + 2, bx['y'] + bx['height'] * 0.4); pg.wait_for_timeout(100)   # linker Rand der Zeichenfläche
        tb = tip.bounding_box()
        check(tb['x'] >= wb['x'] - 1, f'{name}: Tooltip am linken Rand nicht abgeschnitten')
        pg.mouse.move(bx['x'] + bx['width'] * 0.4, bx['y'] + bx['height'] * 0.4); pg.wait_for_timeout(100)
        pg.screenshot(path=str(SHOTS / f'{name}_1_wetter.png'))
        pg.locator('#detail .wx-block').screenshot(path=str(SHOTS / f'{name}_2_abschnitt.png'))

        # Zwischenspeicher: gleicher Standort erneut → keine neuen Abfragen
        n = len(calls)
        pg.keyboard.press('Escape'); pg.evaluate(f"window.__watermap.selectPlace({json.dumps(north)}, {{ full: true }})"); pg.wait_for_selector('#detail .wx-wind')
        check(len(calls) == n, f'{name}: kurzzeitiger Zwischenspeicher je Ort')

        # Ohne Warnung
        south = pg.evaluate(PICK, False)
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(south)}, {{ full: true }})"); pg.wait_for_selector('#detail .wx-noalert', timeout=8000)
        check('keine amtlichen Wetterwarnungen für Stadt Mainz' in pg.inner_text('#detail'), f'{name}: Hinweis ohne Warnung nennt den Warnbereich')

        # Pegel-Detail enthält ebenfalls Wetter
        pg.evaluate("window.__watermap.setGauges(true)"); pg.wait_for_selector('.wm-gauge')
        pg.evaluate("window.__watermap.selectGauge('a6ee8177-107b-47dd-bcfd-30960ccc6e9c', { fly: false })")
        pg.wait_for_selector('#detail .wx-wind', timeout=8000)
        check('Pegel' in pg.inner_text('#detail .detail-head') and pg.locator('#detail .wx-block').count() == 1, f'{name}: Wetter auch im Pegel-Detail')
        pg.evaluate("window.__watermap.setGauges(false)")

        # Dienst gestört (neuer Ort, damit nichts aus dem Zwischenspeicher kommt)
        fail['on'] = True
        other = pg.evaluate("window.__watermap.state.places.find(p => p.lat > 53 && p.lon > 10).id")
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(other)}, {{ full: true }})"); pg.wait_for_timeout(800)
        check('Wetterdaten sind gerade nicht erreichbar' in pg.inner_text('#detail'), f'{name}: Hinweis bei Ausfall')
        check(pg.locator('#detail .facts').count() == 1, f'{name}: restliche Details trotzdem da')
        fail['on'] = False

        csp = pg.evaluate('window.__csp || []')
        check(not csp, f'{name}: keine CSP-Verstöße {csp[:3]}')
        errors = [e for e in errors if 'favicon' not in e and '502' not in e]
        check(not errors, f'{name}: keine Konsolenfehler {errors[:3]}')
        ctx.close(); calls.clear()
    b.close()
srv.shutdown()
check(not foreign, f'keine Anfragen an fremde Server außer Kacheln {foreign[:3]}')
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
