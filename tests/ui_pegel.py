"""UI-Test der Pegel-Ebene mit echtem (selbst gehostetem) Leaflet und der CSP aus public/_headers.
PEGELONLINE wird durch Testdaten im Format der echten Schnittstelle ersetzt (/api/pegel/** → hier erzeugt),
Kartenkacheln durch ein Platzhalterbild.   Start: python3 tests/ui_pegel.py [screenshots-ordner]"""
import datetime as dt, functools, json, math, pathlib, re, struct, sys, tempfile, threading, zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8767
BASE = f'http://127.0.0.1:{PORT}/'

# ------------------------------------------------------------------ Server mit den Headern aus public/_headers (Block "/*")
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

# ------------------------------------------------------------------ Testdaten im PEGELONLINE-Format
NOW = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
NOW = NOW - dt.timedelta(minutes=NOW.minute % 15)
iso = lambda t: t.isoformat()

def cv(**vals):
    return [{'shortname': k, 'longname': k, 'unit': 'cm', 'value': v} for k, v in vals.items()]

def station(uuid, number, name, water, lat, lon, value, state='normal', hsw='normal', trend=0, refs=None, age_h=0, ts='W'):
    return {'uuid': uuid, 'number': number, 'shortname': name, 'longname': name, 'km': 688.0, 'agency': 'WSA RHEIN',
            'longitude': lon, 'latitude': lat, 'water': {'shortname': water, 'longname': water},
            'timeseries': [{'shortname': ts, 'longname': 'WASSERSTAND ROHDATEN', 'unit': 'cm', 'equidistance': 15,
                            'currentMeasurement': {'timestamp': iso(NOW - dt.timedelta(hours=age_h)), 'value': value, 'trend': trend,
                                                   'stateMnwMhw': state, 'stateNswHsw': hsw},
                            'characteristicValues': cv(**(refs or {}))}]}

STATIONS = [
    station('a6ee8177-107b-47dd-bcfd-30960ccc6e9c', '2730010', 'KÖLN', 'RHEIN', 50.9369, 6.9628, 312, trend=1, refs={'MNW': 125, 'MW': 321, 'MHW': 641, 'HSW': 830}),
    station('1d26e504-7f9e-480a-b52c-5932be6549ab', '2570040', 'KAUB', 'RHEIN', 50.0855, 7.7647, 72, state='low', trend=-1, refs={'MNW': 85, 'MW': 221, 'MHW': 518}),
    station('70272185-b2b3-4178-96b8-43bea330dcae', '501060', 'DRESDEN', 'ELBE', 51.0544, 13.7388, 520, state='high', trend=1, refs={'MNW': 75, 'MW': 196, 'MHW': 480}),
    station('8cce7b0a-5a33-4d20-a2e4-49d38ef3b0e0', '10091008', 'PASSAU DONAU', 'DONAU', 48.5755, 13.4623, 780, state='high', hsw='high', refs={'MNW': 380, 'MW': 470, 'MHW': 650, 'HSW': 700}),
    station('2ff6d6d4-ce59-4fef-a0f8-8f6a0d1a7d71', '2640060', 'TRIER UP', 'MOSEL', 49.7590, 6.6270, 290, refs={'MNW': 150, 'MW': 260, 'MHW': 560}, age_h=48),
    station('ccccb57f-a2f9-4183-ae88-5710d3afaefd', '502180', 'MAGDEBURG-STROMBRÜCKE', 'ELBE', 52.1306, 11.6450, 150, state='unknown'),
    station('ffff0000-0000-0000-0000-000000000000', '999', 'NUR ABFLUSS', 'RHEIN', 51.0, 7.0, 1800, ts='Q'),
]
BY_ID = {s['uuid']: s for s in STATIONS}

def measurements(uuid):
    s = BY_ID[uuid]; cur = s['timeseries'][0]['currentMeasurement']['value']
    start = NOW - dt.timedelta(days=7)
    out = []
    for i in range(7 * 96 + 1):
        t = start + dt.timedelta(minutes=15 * i)
        if 300 <= i < 312: continue                      # Messlücke (3 h) – Linie darf hier nicht durchgezogen werden
        v = cur - 40 * (1 - i / (7 * 96)) + 12 * math.sin(i / 20)
        out.append({'timestamp': iso(t), 'value': round(v, 1)})
    return out

def png(w=256, h=256, rgb=(220, 233, 229)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
TILE = png()

api_calls, foreign = [], []
fail_api = {'on': False}

def api(route):
    u = urlparse(route.request.url)
    api_calls.append(u.path + ('?' + u.query if u.query else ''))
    if fail_api['on']: return route.fulfill(status=502, body='Bad Gateway')
    rest = u.path.split('/api/pegel/', 1)[1]
    if rest == 'stations.json':
        assert 'timeseries=W' in u.query and 'includeCurrentMeasurement=true' in u.query and 'includeCharacteristicValues=true' in u.query, u.query
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and m.group(1) in BY_ID and 'start=P7D' in u.query:
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(measurements(m.group(1))))
    return route.fulfill(status=404, body='[]')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

CSP_HOOK = "document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI));"
KOELN = STATIONS[0]['uuid']

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()


def layer(pg, key, click=False):
    """Schalter im Filter-Fenster (Kartenebenen, Unterfilter): (vorhanden, an?, Zähler); optional umschalten. Fenster wird wieder geschlossen."""
    if not pg.locator('#filter-panel[open]').count():
        pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]')
    sw = pg.locator(f'#filter-panel [data-key="{key}"]')
    res = (sw.count(), sw.get_attribute('aria-checked') if sw.count() else None, sw.locator('.fswitch-n').inner_text() if sw.locator('.fswitch-n').count() else None)
    if click: sw.click(); pg.wait_for_timeout(50)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(80)
    return res

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1280, 'height': 860}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        print(f'--- {name}')
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE',
                            timezone_id='Europe/Berlin', service_workers='block')
        ctx.route('**/api/pegel/**', api)
        # Das Pegel-Detail lädt auch das Wetter (eigener Test: ui_wetter.py) – hier nur leere Antworten
        ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": []}'))   # „Heute vor Ort“ (eigener Test: ui_meldungen.py)
        ctx.route('**/api/wetter/**', lambda r: r.fulfill(status=200, content_type='application/json',
                  body=json.dumps({'current_weather': {'weather': None}, 'weather': {'weather': []}}.get(urlparse(r.request.url).path.rsplit('/', 1)[1], {'alerts': []}))))
        ctx.route(re.compile(r'https://([a-c]\.)?tile\.openstreetmap\.org/.*'), lambda r: r.fulfill(status=200, content_type='image/png', body=TILE))
        ctx.route(re.compile(r'https://(?!([a-c]\.)?tile\.openstreetmap\.org).*'), lambda r: (foreign.append(r.request.url), r.abort()))
        ctx.add_init_script(CSP_HOOK)
        ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); } catch {}")
        ctx.add_init_script("try { if (localStorage.getItem('watermap.cats') === null) { localStorage.setItem('watermap.cats', 'slip,marina,fuel'); localStorage.setItem('watermap.listOpen', '1'); } } catch {}")   # alte Ansicht: alle Kategorien, Liste offen
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto(BASE); pg.wait_for_selector('.wm-cluster, .wm-pin', timeout=20000)

        n, on, _ = layer(pg, 'gauges')
        check(n == 1 and on == 'false', f'{name}: Schalter „Pegelstände“ im Filter-Fenster, aus')
        check(not api_calls, f'{name}: ohne Einschalten keine Pegel-Abfrage')
        layer(pg, 'gauges', click=True); pg.wait_for_selector('.wm-gauge', timeout=8000)
        check(pg.locator('.wm-gauge').count() == 6, f'{name}: 6 Pegel mit Wasserstand auf der Karte ({pg.locator(".wm-gauge").count()})')
        n, on, cnt = layer(pg, 'gauges')
        check(cnt == '6', f'{name}: Zähler am Schalter ({cnt})')
        check(on == 'true', f'{name}: Schalter an')
        check('PEGELONLINE' in pg.inner_text('.leaflet-control-attribution'), f'{name}: Quellenangabe in der Karte')
        check(pg.evaluate("document.querySelector('#map').classList.contains('wm-gauges-compact')"), f'{name}: bei Deutschland-Zoom nur Punkte')
        pg.screenshot(path=str(SHOTS / f'{name}_1_uebersicht.png'))

        # Zu Köln zoomen: Werte sichtbar
        pg.evaluate("window.__watermap.state.map.raw.setView([50.94, 6.96], 11, { animate: false })"); pg.wait_for_timeout(500)
        pill = pg.locator('.wm-gauge-pill', has_text='312')
        check(pill.count() == 1 and pill.is_visible(), f'{name}: Wert „312 cm“ am Marker sichtbar')
        check('↑' in pill.inner_text(), f'{name}: Trendpfeil am Marker')
        pg.screenshot(path=str(SHOTS / f'{name}_2_koeln_marker.png'))

        # Marker antippen: Handy → kompakte Vorschau, Desktop → Panel rechts (bleibt auf der Karte)
        box = pill.bounding_box()
        (pg.touchscreen.tap if mobile else pg.mouse.click)(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        if mobile:
            pg.wait_for_selector('#peek:not([hidden]) .gpeek', timeout=8000)
            ptxt = pg.inner_text('#peek')
            check('Köln' in ptxt and '312' in ptxt and 'Passt mein Boot?' in ptxt, f'{name}: Vorschau mit Wert und „Passt mein Boot?“')
            check(pg.get_attribute('#peek a.dbtn-primary', 'href') == './pegel-ampel?pegel=' + KOELN, f'{name}: Vorschau verlinkt die Pegel-Ampel')
            pg.click('#peek button:has-text("Details")')
        pg.wait_for_selector('#detail:not([hidden]) .gc-line', timeout=8000)
        txt = pg.inner_text('#detail')
        check('Köln' in txt and 'Rhein' in txt.title(), f'{name}: Name und Gewässer lesbar')
        check('312' in txt and 'Normal' in txt and 'steigend' in txt, f'{name}: Wert, Zustand und Trend als Text')
        check(pg.locator('#detail .ps-mark').count() == 1 and pg.locator('#detail .ps-labels > span').count() == 4, f'{name}: Einordnung MNW/MW/MHW/HSW')
        d = pg.locator('#detail .gc-line').get_attribute('d')
        check(d.count('M') == 2, f'{name}: Messlücke unterbricht die Linie ({d.count("M")} Abschnitte)')
        check('#karte/pegel/' + KOELN in pg.url, f'{name}: Adresse #karte/pegel/…')
        link = pg.locator('#detail a.pd-kachel')
        check(link.count() == 1 and 'Passt mein Boot?' in link.inner_text() and link.get_attribute('href') == './pegel-ampel?pegel=' + KOELN,
              f'{name}: Kachel „Passt mein Boot?“')
        check(pg.locator('.wm-gauge-pill.is-selected').count() == 1, f'{name}: gewählter Pegel hervorgehoben')
        check(pg.locator('#detail #heute-vor-ort').count() == 0, f'{name}: keine Karte „Heute vor Ort“')
        # Fadenkreuz
        pg.locator('#detail .gc-svg').scroll_into_view_if_needed()
        svg = pg.locator('#detail .gc-svg').bounding_box()
        pg.mouse.move(svg['x'] + svg['width'] * 0.5, svg['y'] + svg['height'] * 0.5); pg.wait_for_timeout(150)
        tip = pg.locator('#detail .gc-tip')
        check(tip.is_visible() and 'cm' in tip.inner_text(), f'{name}: Tooltip im Verlauf ({tip.inner_text() if tip.is_visible() else "-"})')
        pg.screenshot(path=str(SHOTS / f'{name}_3_detail.png'))
        pg.locator('#detail .detail-scroll').evaluate('e => e.scrollTop = 99999'); pg.wait_for_timeout(100)
        pg.screenshot(path=str(SHOTS / f'{name}_4_detail_unten.png'))

        # Weitere Zustände
        for uuid, expect in [(STATIONS[1]['uuid'], 'Niedrig'), (STATIONS[2]['uuid'], 'Hoch'),
                             (STATIONS[3]['uuid'], 'über HSW'), (STATIONS[4]['uuid'], 'veraltet'), (STATIONS[5]['uuid'], 'ohne Kennwerte')]:
            pg.evaluate(f"window.__watermap.selectGauge({json.dumps(uuid)}, {{ fly: false, full: true }})"); pg.wait_for_timeout(200)
            check(expect in pg.inner_text('#detail .pd-kopf'), f'{name}: Zustand „{expect}“')
        check(pg.locator('#detail .ps-track').count() == 0, f'{name}: ohne Kennwerte keine leere Skala')
        pg.evaluate(f"window.__watermap.selectGauge({json.dumps(STATIONS[3]['uuid'])}, {{ fly: false, full: true }})"); pg.wait_for_selector('#detail .gc-line')
        pg.screenshot(path=str(SHOTS / f'{name}_5_hsw.png'))

        # Schließen
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check(pg.locator('#detail').is_hidden() and 'pegel/' not in pg.url, f'{name}: Escape schließt Pegel-Detail')

        # Deep-Link in neuer Seite (Ebene war eingeschaltet → bleibt gemerkt); alter Link #g= geht weiter
        for link in ['#karte/pegel/' + KOELN, '#g=' + KOELN]:
            pg2 = ctx.new_page(); pg2.goto(BASE + link)
            pg2.wait_for_selector('#peek:not([hidden]) .gpeek' if mobile else '#detail:not([hidden]) .gc-line', timeout=15000)
            check('Köln' in pg2.inner_text('#peek' if mobile else '#detail'), f'{name}: Deep-Link {link[:13]}… öffnet Pegel auf der Karte')
            pg2.close()

        # Ausschalten
        layer(pg, 'gauges', click=True); pg.wait_for_timeout(200)
        check(pg.locator('.wm-gauge').count() == 0 and 'PEGELONLINE' not in pg.inner_text('.leaflet-control-attribution'), f'{name}: Ausschalten entfernt Pegel und Quellenangabe')

        # Schnittstelle gestört
        fail_api['on'] = True
        # a) mit gespeichertem Stand (neue Seite, gleicher Browser): letzte Werte mit Hinweis „Stand von …“
        pg3 = ctx.new_page(); pg3.goto(BASE); pg3.wait_for_selector('.wm-cluster, .wm-pin', timeout=20000)
        layer(pg3, 'gauges', click=True); pg3.wait_for_timeout(500)
        check('Stand von' in pg3.inner_text('#toast') and pg3.locator('.wm-gauge').count() == 6, f'{name}: ohne Verbindung letzter Stand mit Hinweis')
        pg3.close()
        # b) ohne gespeicherten Stand: Hinweis, Schalter wieder aus
        pg3 = ctx.new_page(); pg3.goto(BASE); pg3.wait_for_selector('.wm-cluster, .wm-pin', timeout=20000)
        pg3.evaluate("localStorage.removeItem('watermap.pegel.stand')")
        layer(pg3, 'gauges', click=True); pg3.wait_for_timeout(500)
        check('nicht erreichbar' in pg3.inner_text('#toast'), f'{name}: Hinweis, wenn PEGELONLINE ausfällt')
        check(layer(pg3, 'gauges')[1] == 'false', f'{name}: Schalter danach wieder aus')
        pg3.close()
        fail_api['on'] = False

        csp = pg.evaluate('window.__csp || []')
        check(not csp, f'{name}: keine CSP-Verstöße {csp[:3]}')
        errors = [e for e in errors if 'favicon' not in e and '502' not in e]
        check(not errors, f'{name}: keine Konsolenfehler {errors[:3]}')
        ctx.close()
        api_calls.clear()
    b.close()
srv.shutdown()
check(not [u for u in foreign if 'pegelonline' in u], 'keine direkte Anfrage an pegelonline.wsv.de')
check(not foreign, f'keine Anfragen an fremde Server außer Kacheln {foreign[:3]}')
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
