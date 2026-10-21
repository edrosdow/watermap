"""UI-Test der Pegel-Ampel (/pegel-ampel) unter der CSP aus public/_headers.
PEGELONLINE wird durch Testdaten im Format der echten Schnittstelle ersetzt.   Start: python3 tests/ui_ampel.py [screenshots-ordner]"""
import datetime as dt, functools, json, pathlib, re, sys, tempfile, threading
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
# Kurzadresse wie in public/_redirects
REWRITE = {l.split()[0]: l.split()[1] for l in (ROOT / '_redirects').read_text(encoding='utf-8').splitlines()
           if l.strip() and not l.startswith('#') and l.split()[2:3] == ['200'] and not l.split()[1].startswith('http')}

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        u = urlparse(path)
        return super().translate_path(REWRITE.get(u.path, u.path) + ('?' + u.query if u.query else ''))
    def end_headers(self):
        for k, v in HDR.items(): self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass

NOW = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
NOW = NOW - dt.timedelta(minutes=NOW.minute % 15)
iso = lambda t: t.isoformat()

def station(uuid, name, water, lat, lon, value, trend=0):
    return {'uuid': uuid, 'number': '1', 'shortname': name, 'longname': name, 'km': 500.0, 'agency': 'WSA',
            'longitude': lon, 'latitude': lat, 'water': {'shortname': water, 'longname': water},
            'timeseries': [{'shortname': 'W', 'unit': 'cm', 'currentMeasurement': {'timestamp': iso(NOW), 'value': value, 'trend': trend,
                            'stateMnwMhw': 'normal', 'stateNswHsw': 'normal'}, 'characteristicValues': []}]}

KAUB = '1d26e504-7f9e-480a-b52c-5932be6549ab'
KOELN = 'a6ee8177-107b-47dd-bcfd-30960ccc6e9c'
STATIONS = [station(KOELN, 'KÖLN', 'RHEIN', 50.9369, 6.9628, 312, 1), station(KAUB, 'KAUB', 'RHEIN', 50.0855, 7.7647, 72, -1),
            station('70272185-b2b3-4178-96b8-43bea330dcae', 'DRESDEN', 'ELBE', 51.0544, 13.7388, 220, 0)]
SLOPE = {KOELN: 5, KAUB: -20, STATIONS[2]['uuid']: 0}   # cm pro Tag
DAYS = {KOELN: 14, KAUB: 14, STATIONS[2]['uuid']: 5}     # Dresden: nur 5 Tage Verlauf

def measurements(uuid):
    s = next(x for x in STATIONS if x['uuid'] == uuid); v0 = s['timeseries'][0]['currentMeasurement']['value']
    n = DAYS[uuid] * 96
    return [{'timestamp': iso(NOW - dt.timedelta(minutes=15 * (n - i))), 'value': round(v0 - SLOPE[uuid] * (n - i) / 96, 1)} for i in range(n + 1)]

calls = []
def api(route):
    u = urlparse(route.request.url); calls.append(u.path + '?' + u.query)
    rest = u.path.split('/api/pegel/', 1)[1]
    if rest == 'stations.json': return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and 'start=P14D' in u.query: return route.fulfill(status=200, content_type='application/json', body=json.dumps(measurements(m.group(1))))
    return route.fulfill(status=404, body='[]')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

SHARE_STUB = "window.__shared = null; navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };"
CSP_HOOK = "document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective));"

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1100, 'height': 900}, False), ('mobile', {'width': 375, 'height': 760}, True)]:
        print(f'--- {name}')
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE',
                            timezone_id='Europe/Berlin', service_workers='block')
        ctx.route('**/api/pegel/**', api)
        ctx.route(re.compile(r'https?://(?!127\.0\.0\.1).*'), lambda r: r.abort())
        ctx.add_init_script(SHARE_STUB); ctx.add_init_script(CSP_HOOK)
        pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        pg.goto(BASE + 'pegel-ampel'); pg.locator('#am-q').wait_for()
        check('Pegel-Ampel' in pg.title() and pg.locator('meta[name=description]').get_attribute('content').startswith('Pegel-Ampel'), f'{name}: Title und Meta-Description')
        check('Passt mein Boot heute aufs Wasser?' in pg.inner_text('main'), f'{name}: Untertitel')
        pg.wait_for_function('() => !document.getElementById("am-msg").textContent') if False else pg.wait_for_timeout(600)
        check(pg.locator('#am-result').is_hidden(), f'{name}: ohne Pegel kein Ergebnis')

        # Suche
        pg.fill('#am-q', 'kau'); pg.locator('#am-list li').first.wait_for()
        check(pg.locator('#am-list li').count() == 1 and 'Kaub' in pg.inner_text('#am-list'), f'{name}: Suche findet „Kaub“')
        pg.fill('#am-q', 'rhein')
        check(pg.locator('#am-list li').count() == 2, f'{name}: Suche über das Gewässer')
        pg.fill('#am-q', 'xyz'); check('Kein Pegel gefunden' in pg.inner_text('#am-list'), f'{name}: Suche ohne Treffer')
        pg.fill('#am-q', 'kaub'); pg.keyboard.press('Enter')
        pg.locator('#am-result:not([hidden])').wait_for(); pg.locator('#am-chart .gc-line').wait_for(state='attached')
        check(any('KAUB' not in c and '1d26e504' in c and 'start=P14D' in c for c in calls), f'{name}: 14 Tage Verlauf abgefragt')
        check(pg.inner_text('#am-status') == 'Mindestpegel eingeben', f'{name}: ohne Mindestpegel keine Ampel')
        check(pg.evaluate('document.activeElement.id') == 'am-min', f'{name}: Fokus springt zum Mindestpegel')

        def setmin(v):
            pg.fill('#am-min', str(v)); pg.wait_for_timeout(400)
            return pg.inner_text('#am-status')
        # Kaub 72 cm, fällt 20 cm/Tag
        check(setmin(100) == 'Nicht befahrbar' and pg.inner_text('#am-res') == '−28 cm', f'{name}: 72 < 100 → rot, Reserve −28')
        check('am-light is-rot' in pg.get_attribute('#am-light', 'class'), f'{name}: Ampel rot')
        check(setmin(60) == 'Knapp' and pg.inner_text('#am-res') == '+12 cm', f'{name}: Reserve 12 < 20 → gelb')
        check(setmin(30) == 'Knapp', f'{name}: grün, aber fallend: 72 − 3×20 = 12 < 30 → gelb')
        check('fällt' in pg.inner_text('#am-hints'), f'{name}: Hinweis zum fallenden Pegel')
        check('↓ fallend' in pg.inner_text('#am-trend') and '−20 cm pro Tag' in pg.inner_text('#am-trend-sub'), f'{name}: Trend-Kachel')
        check(setmin(0) == 'Heute befahrbar', f'{name}: 72 − 60 = 12 ≥ 0 → grün')
        check(1 <= pg.locator('#am-hints li').count() <= 3, f'{name}: 1–3 Hinweise')
        check(pg.locator('#am-chart .gc-threshold').count() == 1, f'{name}: Mindestpegel gestrichelt im Diagramm')
        check('14 Tage' in pg.inner_text('#am-chart-card h2'), f'{name}: Verlauf 14 Tage')
        check('null' not in pg.inner_text('main') and 'undefined' not in pg.inner_text('main'), f'{name}: keine „null“/„undefined“ im Text')
        # Bootstyp
        pg.click('#am-boot label:has-text("Kanu/SUP")'); pg.wait_for_timeout(100)
        check('Kanu/SUP' in pg.inner_text('#am-where'), f'{name}: Bootstyp wird angezeigt')

        # Slipanlagen
        pg.locator('#am-slips a').first.wait_for(timeout=15000)
        slips = pg.locator('#am-slips a')
        check(slips.count() == 3 and all(slips.nth(i).get_attribute('href').startswith('./#p=') for i in range(3)), f'{name}: 3 Slipanlagen, verlinkt auf die Karte')
        dists = pg.locator('#am-slips .s-dist').all_inner_texts()
        check(all(re.search(r'\d', d) for d in dists), f'{name}: Entfernungen {dists}')

        # URL und Teilen
        q = parse_qs(urlparse(pg.url).query)
        check(q.get('pegel') == [KAUB] and q.get('min') == ['0'] and q.get('boot') == ['kanu'], f'{name}: URL-Parameter {q}')
        pg.click('#am-share'); pg.wait_for_timeout(200)
        sh = pg.evaluate('window.__shared')
        check(sh and 'pegel=' + KAUB in sh['url'] and 'Heute befahrbar' in sh['text'], f'{name}: Teilen mit Link und Ergebnis')
        pg.screenshot(path=str(SHOTS / f'{name}_1_ergebnis.png'), full_page=True)
        check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{name}: kein seitliches Scrollen')
        if mobile:
            small = pg.evaluate("""() => [...document.querySelectorAll('main button, main input, .am-seg span, #am-slips a')]
                .filter(e => e.offsetParent && e.type !== 'radio').map(e => e.getBoundingClientRect()).filter(r => r.height < 44).length""")
            check(small == 0, f'{name}: Touch-Ziele mindestens 44 px ({small} kleiner)')

        # Wiederkehr: Eingaben aus dem lokalen Speicher
        pg.goto(BASE + 'pegel-ampel'); pg.locator('#am-chart .gc-line').wait_for(state='attached')
        check(pg.input_value('#am-min') == '0' and pg.input_value('#am-q') == 'Kaub' and pg.is_checked('#am-boot input[value=kanu]'), f'{name}: Eingaben gespeichert')

        # Geteilter Link in einem neuen Browser: zeigt das Ergebnis, überschreibt eigene Einstellungen nicht
        ctx2 = b.new_context(viewport=vp, service_workers='block', locale='de-DE'); ctx2.route('**/api/pegel/**', api)
        ctx2.route(re.compile(r'https?://(?!127\.0\.0\.1).*'), lambda r: r.abort())
        pg2 = ctx2.new_page()
        pg2.goto(BASE + 'pegel-ampel'); pg2.evaluate("localStorage.setItem('watermap.ampel', JSON.stringify({pegel: null, min: 55, boot: 'segel'}))")
        pg2.goto(BASE + f'pegel-ampel?pegel={KOELN}&min=280'); pg2.locator('#am-chart .gc-line').wait_for(state='attached')
        check(pg2.inner_text('#am-status') == 'Heute befahrbar' and pg2.inner_text('#am-res') == '+32 cm', f'{name}: geteilter Link zeigt das Ergebnis direkt')
        check(json.loads(pg2.evaluate("localStorage.getItem('watermap.ampel')"))['min'] == 55, f'{name}: geteilter Link überschreibt eigene Einstellungen nicht')
        pg2.goto(BASE + 'pegel-ampel?pegel=gibtsnicht&min=10'); pg2.wait_for_timeout(800)
        check('nicht gefunden' in pg2.inner_text('#am-msg'), f'{name}: unbekannter Pegel im Link: klare Meldung')
        # Kurzer Verlauf (Dresden: 5 Tage)
        pg2.goto(BASE + 'pegel-ampel?pegel=70272185-b2b3-4178-96b8-43bea330dcae&min=150'); pg2.locator('#am-chart .gc-line').wait_for(state='attached')
        check('Nur 5 Tage Verlauf verfügbar' in pg2.inner_text('#am-chart-card'), f'{name}: Hinweis bei kürzerem Verlauf')
        check('→ gleich' in pg2.inner_text('#am-trend'), f'{name}: gleichbleibender Trend')
        ctx2.close()

        # Pegel nicht erreichbar
        ctx3 = b.new_context(viewport=vp, service_workers='block'); ctx3.route('**/api/pegel/**', lambda r: r.fulfill(status=502, body='x'))
        pg3 = ctx3.new_page(); pg3.goto(BASE + 'pegel-ampel'); pg3.wait_for_timeout(1500)
        check('nicht erreichbar' in pg3.inner_text('#am-msg'), f'{name}: Fehlermeldung, wenn PEGELONLINE ausfällt')
        ctx3.close()

        check(not errors, f'{name}: keine JS-Fehler {errors[:3]}')
        check(not pg.evaluate('window.__csp || null'), f'{name}: keine CSP-Verstöße')
        ctx.close()

    # Menü der Karte führt zur Pegel-Ampel
    ctx = b.new_context(service_workers='block'); ctx.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    ctx.route(re.compile(r'https?://(?!127\.0\.0\.1).*'), lambda r: r.abort())
    pg = ctx.new_page(); pg.goto(BASE); pg.locator('#btn-menu').wait_for()
    pg.click('#btn-menu'); pg.locator('#menu .menu-item', has_text='Pegel-Ampel').click(); pg.wait_for_url('**/pegel-ampel')
    check(pg.locator('#am-q').count() == 1, 'Menü → Pegel-Ampel öffnet die Seite')
    b.close()

print('FEHLER:', problems or 'keine')
sys.exit(1 if problems else 0)
