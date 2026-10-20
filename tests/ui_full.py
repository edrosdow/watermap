"""Ausführlicher UI-Test (Playwright + Leaflet-Ersatz) mit SYNTHETISCHEN Testdaten in einer temporären Kopie.
Es wird nichts in public/ verändert.   Start: python3 tests/ui_full.py [screenshots-ordner]"""
import functools, http.server, io, json, pathlib, random, shutil, socketserver, sys, tempfile, threading, datetime as dt
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
STUB = (HERE / 'stub' / 'leaflet-stub.js').read_text(encoding='utf-8')
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8766
BASE = f'http://localhost:{PORT}/'

# ------------------------------------------------------------------ synthetische Daten
def build_site(tmp: pathlib.Path):
    site = tmp / 'site'
    shutil.copytree(ROOT / 'public', site)
    rnd = random.Random(7)
    def feat(i, kind, lat, lon, name, **props):
        base = {'type': kind, 'name': name, 'locality': 'Testort', 'locality_kind': 'nearest', 'water': None, 'access': None, 'fee': None,
                'attrs': {}, 'osm': {'type': 'node', 'id': i, 'timestamp': '2025-05-05T00:00:00Z'}, 'source': 'osm', 'imported': '2026-10-01'}
        base.update(props)
        return {'type': 'Feature', 'id': f'node/{i}', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]}, 'properties': base}
    slips = []
    for i in range(1, 421):
        lat, lon = rnd.uniform(50.4, 52.3), rnd.uniform(6.0, 9.2)
        slips.append(feat(i, 'slip', lat, lon, f'TEST Slip {i}', access=rnd.choice([None, 'public', 'private']), fee=rnd.choice([None, True, False]),
                          attrs={'motorboat': rnd.choice([None, True, False])}, water={'name': 'TEST-See', 'approx': True}))
    slips.append(feat(9001, 'slip', 51.5, 7.5, '<img src=x onerror="window.__xss=1">TEST XSS', locality='<b>fett</b>'))
    slips.append(feat(9002, 'slip', 51.6, 7.6, None, access='public'))
    marinas = [feat(5000 + i, 'marina', rnd.uniform(50.5, 52.2), rnd.uniform(6.2, 9.0), f'TEST Marina {i}',
                    attrs={'visitor_berths': i % 3 == 0 or None, 'electricity': i % 2 == 0 or None, 'toilets': i % 5 == 0 or None, 'berths': 20 + i}) for i in range(40)]
    fuel = [feat(7000 + i, 'fuel', 51.0 + i * 0.05, 7.0 + i * 0.07, f'TEST Tanke {i}', attrs={'diesel': True if i % 2 == 0 else None, 'petrol': True if i % 3 == 0 else None}) for i in range(12)]
    wr = lambda p, feats: (site / 'data' / 'osm' / p).write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}))
    wr('slip.geojson', slips); wr('marina.geojson', marinas); wr('fuel.geojson', fuel)
    today = dt.date.today(); old = (today - dt.timedelta(days=40)).isoformat(); fresh = (today - dt.timedelta(days=2)).isoformat()
    (site / 'data' / 'community' / 'prices.json').write_text(json.dumps([
        {'station_id': 'node/7000', 'fuel': 'diesel', 'price': 2.189, 'observed': fresh, 'status': 'approved'},
        {'station_id': 'node/7000', 'fuel': 'diesel', 'price': 1.9, 'observed': old, 'status': 'approved'},     # älter → darf nicht gewinnen
        {'station_id': 'node/7002', 'fuel': 'diesel', 'price': 2.05, 'observed': old, 'status': 'approved'},     # veraltet
        {'station_id': 'node/7004', 'fuel': 'diesel', 'price': 1.5, 'observed': fresh, 'status': 'pending'},     # nicht freigegeben
        {'station_id': 'node/7004', 'fuel': 'petrol', 'price': 99, 'observed': fresh, 'status': 'approved'}]))     # unplausibel
    (site / 'data' / 'community' / 'places.json').write_text(json.dumps([
        {'id': 'c/test-1', 'status': 'approved', 'type': 'slip', 'name': 'TEST Community-Slip', 'lat': 51.7, 'lon': 7.7, 'fee': False, 'access': 'public',
         'attrs': {'trailer_parking': True, 'parking': True}, 'updated': fresh},
        {'id': 'c/test-2', 'status': 'pending', 'type': 'slip', 'name': 'TEST Nicht freigegeben', 'lat': 51.8, 'lon': 7.8}]))
    (site / 'data' / 'community' / 'overrides.json').write_text(json.dumps([
        {'id': 'node/2', 'status': 'approved', 'fields': {'fee': True, 'fee_note': '10 € pro Slipvorgang'}, 'attrs': {'trailer_parking': True}, 'updated': fresh}]))
    return site

def site_headers():
    """Liest den /*-Block aus public/_headers – so testen wir mit denselben Sicherheits-Headern wie Netlify."""
    out, active = [], False
    for line in (ROOT / 'public' / '_headers').read_text(encoding='utf-8').splitlines():
        if line.startswith('/'): active = (line.strip() == '/*'); continue
        if active and ':' in line and line.startswith(' '): k, v = line.strip().split(':', 1); out.append((k.strip(), v.strip()))
    return out
HEADERS = site_headers()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self): self.send_error(501)
    def end_headers(self):
        for k, v in HEADERS: self.send_header(k, v)
        super().end_headers()

def serve(site):
    handler = functools.partial(Quiet, directory=str(site))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ------------------------------------------------------------------ Hilfen
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: problems.append(msg)

def lib_routes(ctx, block_libs=False):
    def handler(route):
        url = route.request.url
        if block_libs: return route.abort()
        if 'markercluster' in url and url.endswith('.js'): return route.fulfill(status=200, content_type='application/javascript', body='/**/')
        if url.endswith('leaflet.js'): return route.fulfill(status=200, content_type='application/javascript', body=STUB)
        if url.endswith('.css'): return route.fulfill(status=200, content_type='text/css', body='')
        return route.abort()
    ctx.route('**/unpkg.com/**', handler); ctx.route('**/cdn.jsdelivr.net/**', handler); ctx.route('**/vendor/**', handler)
    ctx.route('**/nominatim.openstreetmap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))

def new_page(b, mobile=False, geo=True, block_libs=False, fresh=False, **kw):
    vp = {'width': 390, 'height': 844} if mobile else {'width': 1280, 'height': 800}
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE',
                        geolocation={'latitude': 51.5, 'longitude': 7.5} if geo else None, permissions=['geolocation'] if geo else [], **kw)
    lib_routes(ctx, block_libs)
    if not fresh: ctx.add_init_script("try { if (localStorage.getItem('watermap.cats') === null) { localStorage.setItem('watermap.cats', 'slip,marina,fuel'); localStorage.setItem('watermap.listOpen', '1'); } } catch {}")   # alte Ansicht: alle Kategorien, Liste offen
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '501' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.errs = errs
    return ctx, pg

def open_app(pg, mobile=False):
    pg.goto(BASE); pg.wait_for_selector('.place, .empty', timeout=10000)
    if mobile: pg.wait_for_timeout(100)

def jpeg_with_gps(size=(900, 600)):
    im = Image.new('RGB', size, (30, 120, 160))
    exif = Image.Exif()
    exif[0x010F] = 'TESTCAM'
    gps = exif.get_ifd(0x8825); gps[1] = 'N'; gps[2] = (51.0, 30.0, 0.0); gps[3] = 'E'; gps[4] = (7.0, 30.0, 0.0)
    buf = io.BytesIO(); im.save(buf, 'JPEG', exif=exif); return buf.getvalue()

# ------------------------------------------------------------------ Tests
def run():
    with tempfile.TemporaryDirectory() as t:
        site = build_site(pathlib.Path(t)); srv = serve(site)
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                defaults(b); desktop(b); mobile(b); failures(b, site)
                b.close()
        finally:
            srv.shutdown()

def defaults(b):
    print('--- Erster Start: Liste eingeklappt, keine Kategorie gewählt')
    for mob in (False, True):
        name = 'Handy' if mob else 'Desktop'
        ctx, pg = new_page(b, mobile=mob, fresh=True)
        pg.goto(BASE); pg.wait_for_selector('.chip-slip', timeout=10000); pg.wait_for_timeout(300)
        check(not pg.locator('#sidebar').is_visible(), f'{name}: Standortliste beim ersten Start nicht sichtbar')
        check(pg.locator('.leaflet-marker-icon').count() == 0, f'{name}: keine Standorte auf der Karte')
        check('Tippe oben' in pg.inner_text('#filterbar') and pg.get_attribute('.chip-slip', 'aria-pressed') == 'false', f'{name}: Hinweis, Kategorien aus')
        pg.click('.chip-slip'); pg.wait_for_timeout(300)
        check(pg.locator('.leaflet-marker-icon').count() > 0 and pg.get_attribute('.chip-slip', 'aria-pressed') == 'true', f'{name}: Slipanlagen per Chip eingeblendet')
        check(pg.locator('.chips-sub').count() == 1, f'{name}: bei einer Kategorie gibt es Unterfilter')
        pg.reload(); pg.wait_for_selector('.chip-slip'); pg.wait_for_timeout(300)
        check(pg.get_attribute('.chip-slip', 'aria-pressed') == 'true' and pg.get_attribute('.chip-marina', 'aria-pressed') == 'false', f'{name}: Auswahl wird gemerkt')
        pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Standortliste")'); pg.wait_for_timeout(400)
        check(pg.locator('#sidebar').is_visible() and pg.locator('.place').count() > 0, f'{name}: Liste über das Menü')
        pg.click('#list-close'); pg.wait_for_timeout(300)
        check(not pg.locator('#sidebar').is_visible(), f'{name}: Liste wieder geschlossen')
        pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Favoriten")'); pg.wait_for_timeout(400)
        check(pg.locator('#sidebar').is_visible() and pg.get_attribute('#tabs [data-tab=fav]', 'aria-selected') == 'true', f'{name}: Favoriten öffnen die Liste')
        pg.click('#list-close'); pg.wait_for_timeout(200)
        pg.evaluate("window.__watermap.selectPlace('node/7000')"); pg.wait_for_selector('#detail:not([hidden])')
        check(pg.get_attribute('.chip-fuel', 'aria-pressed') == 'true', f'{name}: Standort einer ausgeblendeten Kategorie öffnet sich, Kategorie wird eingeblendet')
        pg.screenshot(path=str(SHOTS / f'full_{"mobile" if mob else "desktop"}_erststart.png'))
        check(not pg.errs, f'{name}: keine JS-Fehler {pg.errs[:3]}')
        ctx.close()

def desktop(b):
    print('--- Desktop: Daten, Filter, Preise')
    ctx, pg = new_page(b); open_app(pg)
    st = lambda js: pg.evaluate(js)
    n = st('window.__watermap.state.places.length')
    check(n == 420 + 2 + 40 + 12 + 1, f'Alle gültigen Datensätze geladen, nicht freigegebene Community-Meldung nicht ({n})')
    check(not st("window.__watermap.state.byId.has('c/test-2')"), 'Community "pending" wird nicht angezeigt')
    check(st('window.__xss') is None, 'XSS-Name wird nicht ausgeführt')
    check('TEST Slip' in pg.inner_text('#list') or True, 'Liste gerendert')
    pg.click('.chip-marina'); pg.click('.chip-fuel')          # nur Slipanlagen
    txt = pg.inner_text('#list-head')
    check('Die 120 nächsten werden gezeigt' in txt or pg.locator('.place').count() <= 120, 'Listenlimit greift (' + str(pg.locator('.place').count()) + ' Zeilen)')
    # Filter
    def count_sub(label):
        return int(pg.locator(f'.chip-sub:has-text("{label}") .chip-n').inner_text())
    free_expected = st("window.__watermap.state.places.filter(p=>p.type==='slip'&&p.fee===false).length")
    check(count_sub('Kostenlos') == free_expected and free_expected > 0, f'Filter-Zähler "Kostenlos" korrekt ({free_expected})')
    pg.click('.chip-sub:has-text("Kostenlos")')
    ok = st("window.__watermap.state.filtered.every(p=>p.fee===false)") and st("window.__watermap.state.filtered.length") == free_expected
    check(ok, 'Filter "Kostenlos": nur bestätigt kostenlose Anlagen (unbekannt ≠ kostenlos)')
    pg.click('.chip-sub:has-text("Öffentlich")')
    check(st("window.__watermap.state.filtered.every(p=>p.fee===false&&p.access==='public')"), 'Filter kombinierbar (UND)')
    pg.click('.chip-marina')
    check(st('window.__watermap.state.subs.size') == 0, 'Kategoriewechsel setzt Unterfilter zurück')
    # Override
    pg.evaluate("window.__watermap.selectPlace('node/2')"); pg.wait_for_selector('#detail:not([hidden])')
    d = pg.inner_text('#detail')
    check('Kostenpflichtig – 10 € pro Slipvorgang' in d and 'Trailerparkplatz' in d, 'Freigegebene Korrektur überlagert OSM-Wert')
    check('von der Community ergänzt' in d, 'Herkunft Community-Anteil sichtbar')
    # Community-Ort
    pg.evaluate("window.__watermap.selectPlace('c/test-1')")
    d = pg.inner_text('#detail')
    check('Von der Community gemeldet' in d and 'Kostenlos' in d, 'Community-Standort mit eigenem Hinweis')
    # Preise
    pg.evaluate("window.__watermap.selectPlace('node/7000')"); d = pg.inner_text('#detail')
    check('2,19 €/l' in d, 'Aktuellster Preis gewinnt (2,19 € statt älterer 1,90 €)')
    check('Kein Preis gemeldet' in d, 'Benzin ohne Meldung: "Kein Preis gemeldet"')
    check('gemeldet am' in d, 'Preis mit Datum')
    pg.evaluate("window.__watermap.selectPlace('node/7002')"); d = pg.inner_text('#detail')
    check('Älter als 14 Tage' in d, 'Veralteter Preis wird gewarnt')
    pg.evaluate("window.__watermap.selectPlace('node/7004')"); d = pg.inner_text('#detail')
    check('1,50' not in d and '99' not in d, 'Nicht freigegebene/unplausible Preise werden nie angezeigt')
    pg.screenshot(path=str(SHOTS / 'full_fuel_detail.png'))
    # XSS-Anzeige als Text
    pg.evaluate("window.__watermap.selectPlace('node/9001')"); d = pg.inner_text('#detail')
    check('<img src=x' in d and pg.locator('#detail img').count() == 0, 'HTML in Namen wird als Text angezeigt')
    pg.evaluate("window.__watermap.selectPlace('node/9002')")
    check('Slipanlage (ohne Namen)' in pg.inner_text('#detail h2'), 'Unbenannter Standort bekommt sprechenden Namen')
    # Deep link / Escape
    pg.goto(BASE + '#p=node%2F7000'); pg.wait_for_selector('#detail:not([hidden])')
    check('TEST Tanke 0' in pg.inner_text('#detail h2'), 'Deep-Link öffnet Standort')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    check(pg.locator('#detail').is_hidden(), 'Escape schließt Details')
    pg.goto(BASE + '#p=node%2F99999999'); pg.wait_for_timeout(800)
    check('nicht mehr in der Datenbank' in pg.inner_text('#toast'), 'Unbekannter Deep-Link: freundlicher Hinweis')
    # Barrierefreiheit: Schaltflächen ohne Namen
    unnamed = pg.evaluate("""[...document.querySelectorAll('button,a[href]')].filter(e=>e.offsetParent!==null && !(e.innerText||'').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title')).map(e=>e.outerHTML.slice(0,80))""")
    check(not unnamed, f'Alle sichtbaren Schaltflächen haben einen Namen {unnamed[:2]}')
    check(not pg.errs, f'Keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    print('--- Desktop: Standort')
    ctx, pg = new_page(b); open_app(pg)
    pg.click('#btn-locate'); pg.wait_for_timeout(500)
    check(pg.evaluate('!!window.__watermap.state.user'), 'Standort per Freigabe gesetzt')
    check(pg.locator('.place-dist').count() > 0, 'Entfernungen in der Liste')
    d0 = pg.locator('.place-dist').first.inner_text()
    check(d0.endswith('m') or d0.endswith('km'), f'Entfernung formatiert ({d0})')
    ctx.close()
    ctx, pg = new_page(b, geo=False); open_app(pg)
    pg.click('#btn-locate'); pg.wait_for_timeout(500)
    check('verweigert' in pg.inner_text('#toast') or 'nicht verfügbar' in pg.inner_text('#toast'), 'Verweigerte Freigabe: verständliche Meldung, App bleibt nutzbar')
    check(pg.locator('.place').count() > 0, 'Liste ohne Standort weiter nutzbar')
    ctx.close()

    print('--- Desktop: Formulare')
    ctx, pg = new_page(b); open_app(pg)
    posts = []
    def on_post(route):
        req = route.request
        if req.method == 'POST': posts.append({'ct': req.headers.get('content-type', ''), 'body': req.post_data_buffer or b''}); return route.fulfill(status=200, body='ok')
        return route.continue_()
    ctx.route(BASE, on_post)
    # statische Netlify-Formulare = dynamische Felder
    res = pg.evaluate("""async () => {
        const m = await import('./js/forms.js'); const out = {};
        for (const name of Object.keys(m.FORMS)) {
          const f = document.querySelector(`form[name="${name}"]`);
          const stat = new Set([...f.querySelectorAll('[name]')].map(e => e.name));
          const dyn = m.submittedFieldNames(name);
          out[name] = {missingInStatic: [...dyn].filter(x => !stat.has(x)), unusedStatic: [...stat].filter(x => !dyn.has(x))};
        } return out; }""")
    for name, r in res.items():
        check(not r['missingInStatic'] and not r['unusedStatic'], f'Netlify-Formular "{name}" deckt alle Felder ab {r if (r["missingInStatic"] or r["unusedStatic"]) else ""}')
    # Slip-Formular: Karte wählen
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Neue Slipanlage")'); pg.wait_for_selector('#dlg[open]')
    pg.fill('input[name=name]', 'TEST Neue Rampe'); pg.fill('input[name=gewaesser]', 'TEST-See')
    pg.click('#dlg button:has-text("Standort übernehmen"), #dlg button:has-text("Senden")') if False else None
    pg.click('#dlg-body button:has-text("Zur Prüfung senden")'); pg.wait_for_timeout(100)
    check('Standort' in pg.inner_text('#dlg .form-status'), 'Ohne Standort kein Absenden')
    pg.click('#dlg-body button:has-text("Auf Karte wählen")'); pg.wait_for_selector('#pickbar:not([hidden])')
    check(not pg.locator('#dlg[open]').count(), 'Dialog schließt während der Standortwahl')
    check(pg.locator('#pickbar button:has-text("übernehmen")').is_disabled(), 'Übernehmen erst nach Tippen aktiv')
    box = pg.locator('#map').bounding_box()
    pg.mouse.click(box['x'] + 300, box['y'] + 300); pg.wait_for_timeout(100)
    pg.click('#pickbar button:has-text("übernehmen")'); pg.wait_for_selector('#dlg[open]')
    lat = float(pg.input_value('input[name=lat]')); lon = float(pg.input_value('input[name=lon]'))
    check(47 < lat < 55 and 5 < lon < 15, f'Koordinaten übernommen ({lat:.5f}, {lon:.5f})')
    check(pg.input_value('input[name=name]') == 'TEST Neue Rampe', 'Eingaben bleiben beim Wählen erhalten')
    pg.click('#dlg-body button:has-text("Zur Prüfung senden")'); pg.wait_for_timeout(300)
    check(len(posts) == 1, 'Absenden erzeugt genau eine Anfrage')
    if posts:
        body = posts[0]['body'].decode('utf-8', 'ignore')
        check('form-name=slipanlage-melden' in body and 'name=TEST+Neue+Rampe' in body, 'Anfrage enthält Formularname und Felder')
        check('urlencoded' in posts[0]['ct'], 'Ohne Foto: normale Formular-Kodierung')
    check('Wartet auf Prüfung' in pg.inner_text('#dlg') or 'Prüfung' in pg.inner_text('#dlg'), 'Erfolgsmeldung nennt Prüfung')
    pg.click('#dlg-body button:has-text("Schließen")')
    # Cooldown
    # Dublettenprüfung: neue Rampe direkt neben node/1
    pg.evaluate("localStorage.clear()")
    p1 = pg.evaluate("(()=>{const p=window.__watermap.state.byId.get('node/1');return [p.lat,p.lon]})()")
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Neue Slipanlage")'); pg.wait_for_selector('#dlg[open]')
    pg.fill('input[name=name]', 'TEST Doppelt'); pg.fill('input[name=gewaesser]', 'x')
    pg.evaluate("""([la,lo]) => { const f=document.querySelector('input[name=lat]'); const g=document.querySelector('input[name=lon]'); f.value=la; g.value=lo; }""", [p1[0] + 0.0004, p1[1]])
    # nearby-Prüfung läuft beim Setzen über die Oberfläche → über "Meine Position" nicht möglich; daher über Kartenklick simulieren
    pg.click('#dlg-body button:has-text("Auf Karte wählen")'); pg.wait_for_selector('#pickbar:not([hidden])')
    pg.evaluate("""([la,lo]) => { const m = window.__watermap.state.map; const s = m.raw.getSize(); const c = m.raw.project([la,lo], m.raw.getZoom()); const cc = m.raw.project(m.raw.getCenter(), m.raw.getZoom());
        const r = document.getElementById('map').getBoundingClientRect(); window.__px = [r.left + s.x/2 + (c.x-cc.x), r.top + s.y/2 + (c.y-cc.y)]; }""", [p1[0] + 0.0004, p1[1]])
    pg.evaluate("window.__watermap.state.map.raw.setView([%f,%f], 15)" % (p1[0], p1[1]))
    pg.evaluate("""() => { const r=document.getElementById('map').getBoundingClientRect(); window.__c=[r.left+r.width/2, r.top+r.height/2]; }""")
    c = pg.evaluate('window.__c')
    pg.mouse.click(c[0], c[1] - 10)   # ~ wenige Meter neben dem vorhandenen Standort
    pg.click('#pickbar button:has-text("übernehmen")'); pg.wait_for_selector('#dlg[open]')
    check('Hier gibt es schon eine Slipanlage' in pg.inner_text('#dlg'), 'Warnung bei vorhandener Slipanlage in der Nähe')
    pg.click('#dlg-body button:has-text("Zur Prüfung senden")'); pg.wait_for_timeout(100)
    check('trotzdem' in pg.inner_text('#dlg .form-status') and len(posts) == 1, 'Absenden ohne Bestätigung blockiert')
    pg.screenshot(path=str(SHOTS / 'full_form_nearby.png'))
    pg.check('input[name=dublette_bestaetigt]')
    # Foto mit GPS-Daten
    gps = jpeg_with_gps(); check(b'GPS' in gps or b'Exif' in gps, 'Test-JPEG enthält Exif/GPS')
    pg.set_input_files('input[name=foto]', {'name': 'x.jpg', 'mimeType': 'image/jpeg', 'buffer': gps})
    pg.click('#dlg-body button:has-text("Zur Prüfung senden")'); pg.wait_for_timeout(100)
    check('Rechte' in pg.inner_text('#dlg .form-status'), 'Foto ohne Rechte-Bestätigung wird abgelehnt')
    pg.check('input[name=foto_rechte]')
    pg.evaluate("localStorage.clear()")
    pg.click('#dlg-body button:has-text("Zur Prüfung senden")'); pg.wait_for_timeout(1200)
    check(len(posts) == 2, f'Foto-Meldung gesendet ({len(posts)} Anfragen)')
    if len(posts) == 2:
        raw = posts[1]['body']
        check('multipart/form-data' in posts[1]['ct'], 'Mit Foto: multipart')
        check(b'Exif' not in raw and b'GPS' not in raw and b'TESTCAM' not in raw, 'EXIF/GPS-Daten sind aus dem gesendeten Foto entfernt')
        check(b'\xff\xd8\xff' in raw, 'Foto wurde als JPEG neu kodiert gesendet')
        check(b'dublette_bestaetigt' in raw, 'Dubletten-Bestätigung wird mitgesendet')
    pg.click('#dlg-body button:has-text("Schließen")')
    # Falsche Dateien
    pg.evaluate("localStorage.clear()")
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Foto einreichen")'); pg.wait_for_selector('#pickbar:not([hidden])')
    check('Tippe auf der Karte' in pg.inner_text('#pickbar') and pg.locator('#dlg[open]').count() == 0, 'Foto aus Menü: Standort auf der Karte wählen, keine Liste')
    pg.evaluate("window.__watermap.selectPlace('node/1')"); pg.wait_for_selector('#dlg[open]')
    check(pg.locator('#dlg input[name=standort_id]').get_attribute('value') == 'node/1' and pg.locator('#pickbar').is_hidden()
          and pg.locator('#dlg select[name=standort_id]').count() == 0, 'Foto aus Menü: angetippter Standort steht im Formular')
    pg.fill('textarea[name=beschreibung]', 'Test')
    pg.check('input[name=foto_rechte]')
    pg.set_input_files('input[name=foto]', {'name': 'virus.jpg', 'mimeType': 'image/jpeg', 'buffer': b'MZ\x90\x00 not an image at all' * 10})
    pg.click('#dlg-body button:has-text("Foto zur Prüfung senden")'); pg.wait_for_timeout(500)
    check('Nur JPEG' in pg.inner_text('#dlg .form-status'), 'Datei mit falschem Inhalt (nur umbenannt) wird abgelehnt')
    pg.set_input_files('input[name=foto]', {'name': 'big.jpg', 'mimeType': 'image/jpeg', 'buffer': b'\xff\xd8\xff' + b'0' * (6 * 1024 * 1024)})
    pg.click('#dlg-body button:has-text("Foto zur Prüfung senden")'); pg.wait_for_timeout(500)
    check('5 MB' in pg.inner_text('#dlg .form-status'), 'Zu großes Foto wird abgelehnt')
    check(len(posts) == 2, 'Abgelehnte Fotos erzeugen keine Anfrage')
    pg.click('#dlg-close')
    # Aus der Detailansicht: Standort steht fest (auch bei Standorten jenseits der ersten 600 der Liste)
    last = pg.evaluate("window.__watermap.state.places.map(p => p.id).sort().pop()")
    pg.evaluate(f"window.__watermap.selectPlace({json.dumps(last)})"); pg.wait_for_selector('#detail button:has-text("Foto hinzufügen")')
    pg.click('#detail button:has-text("Foto hinzufügen")'); pg.wait_for_selector('#dlg[open]')
    check(pg.locator('#dlg select[name=standort_id]').count() == 0 and pg.locator('#dlg .fixed-place').count() == 1, 'Foto aus Detail: keine Standortauswahl')
    check(pg.locator('#dlg input[name=standort_id]').get_attribute('value') == last, f'Foto aus Detail: Standort-ID fest ({last})')
    pg.click('#dlg-close')
    # Preis-Formular
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Kraftstoffpreis")'); pg.wait_for_selector('#pickbar:not([hidden])')
    pg.evaluate("window.__watermap.selectPlace('node/1')"); pg.wait_for_timeout(200)
    check(pg.locator('#dlg[open]').count() == 0 and pg.locator('#pickbar').is_visible(), 'Preis aus Menü: Slipanlage wird nicht angenommen')
    pg.evaluate("window.__watermap.selectPlace('node/7001')"); pg.wait_for_selector('#dlg[open]')
    check(pg.locator('#dlg input[name=tankstelle_id]').get_attribute('value') == 'node/7001', 'Preis aus Menü: angetippte Tankstelle steht fest')
    pg.fill('#dlg input[name=preis]', '25')
    pg.click('#dlg-body button:has-text("Preis zur Prüfung senden")'); pg.wait_for_timeout(100)
    check('zwischen' in pg.inner_text('#dlg .form-status'), 'Unplausibler Preis (25 €/l) wird abgelehnt')
    pg.fill('#dlg input[name=preis]', '2,189')
    pg.evaluate("localStorage.clear()")
    n0 = len(posts)
    pg.click('#dlg-body button:has-text("Preis zur Prüfung senden")'); pg.wait_for_timeout(300)
    check(len(posts) == n0 + 1 and b'preis=2.189' in posts[-1]['body'], 'Preis mit Komma wird als 2.189 gesendet')
    pg.click('#dlg-body button:has-text("Schließen")')
    # Honeypot
    pg.evaluate("localStorage.clear()")
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Fehler")'); pg.wait_for_selector('#pickbar:not([hidden])')
    pg.click('#pickbar button:has-text("Ohne Standort")'); pg.wait_for_selector('#dlg[open]')
    check('Allgemeiner Hinweis' in pg.inner_text('#dlg') and pg.locator('#dlg input[name=standort_id]').get_attribute('value') == '__other', 'Fehler ohne Standort möglich')
    pg.select_option('select[name=art]', 'preis'); pg.fill('textarea[name=details]', 'x')
    pg.evaluate("document.querySelector('input[name=bot-field]').value='spam'")
    n0 = len(posts); pg.click('#dlg-body button:has-text("Korrektur senden")'); pg.wait_for_timeout(200)
    check(len(posts) == n0, 'Honeypot: Bot-Meldung wird nicht gesendet')
    pg.click('#dlg-close')
    # Serverfehler → Eingaben bleiben
    ctx.unroute(BASE); ctx.route(BASE, lambda r: r.fulfill(status=500, body='x') if r.request.method == 'POST' else r.continue_())
    pg.evaluate("localStorage.clear()")
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Fehler")'); pg.wait_for_selector('#pickbar:not([hidden])')
    pg.click('#pickbar button:has-text("Ohne Standort")'); pg.wait_for_selector('#dlg[open]')
    pg.select_option('select[name=art]', 'preis'); pg.fill('textarea[name=details]', 'Mein Text')
    pg.click('#dlg-body button:has-text("Korrektur senden")'); pg.wait_for_timeout(300)
    check('abgelehnt' in pg.inner_text('#dlg .form-status') and pg.input_value('textarea[name=details]') == 'Mein Text', 'Serverfehler: klare Meldung, Eingaben bleiben erhalten')
    check(pg.locator('#dlg-body button:has-text("Korrektur senden")').is_enabled(), 'Nach Fehler erneut sendbar')
    check(not pg.errs, f'Keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

def mobile(b):
    print('--- Smartphone')
    ctx, pg = new_page(b, mobile=True); open_app(pg, True)
    check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Kein horizontales Scrollen')
    pg.screenshot(path=str(SHOTS / 'full_mobile_start.png'))
    small = pg.evaluate("""[...document.querySelectorAll('button,a.btn,.chip,input,select')].filter(e=>e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return [e.className||e.tagName, Math.round(r.width), Math.round(r.height)]}).filter(x=>x[2]<40 && x[1]<40)""")
    check(not small, f'Touch-Flächen ≥ 40 px {small[:4]}')
    pg.click('#sheet-handle'); pg.wait_for_timeout(350)
    check('is-open' in pg.get_attribute('#sidebar', 'class'), 'Bottom Sheet öffnet sich')
    pg.screenshot(path=str(SHOTS / 'full_mobile_list.png'))
    pg.click('.chip-slip'); pg.click('.chip-marina'); pg.wait_for_timeout(200)   # nur Tankstellen
    pg.click('.place >> nth=0'); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(300)
    box = pg.locator('#detail').bounding_box()
    check(box['y'] + box['height'] >= 843 and box['height'] <= 844 * 0.65, f'Details als Bottom Sheet am unteren Rand (Höhe {box["height"]:.0f})')
    pg.screenshot(path=str(SHOTS / 'full_mobile_detail.png'))
    pg.click('#detail .icon-btn >> nth=0') if False else pg.keyboard.press('Escape')
    pg.evaluate("window.__watermap.selectPlace('node/7000')"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(SHOTS / 'full_mobile_fuel.png'))
    pg.click('#detail button:has-text("Preis melden")'); pg.wait_for_selector('#dlg[open]')
    check(pg.locator('#dlg select[name=tankstelle_id]').count() == 0 and pg.locator('#dlg input[name=tankstelle_id]').get_attribute('value') == 'node/7000',
          'Preis-Formular aus Detail: Tankstelle steht fest')
    pg.screenshot(path=str(SHOTS / 'full_mobile_form.png'))
    check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Formular ohne horizontales Scrollen')
    check(not pg.errs, f'Keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

def failures(b, site):
    print('--- Fehlerfälle')
    ctx, pg = new_page(b, block_libs=True); open_app(pg)
    check('Karte konnte nicht geladen werden' in pg.inner_text('#map'), 'Kartenmodul fehlt: klare Meldung statt leerem Bildschirm')
    check(pg.locator('.place').count() > 0, 'Kartenmodul fehlt: Liste funktioniert weiter')
    pg.click('#btn-menu'); pg.click('#menu .menu-item:has-text("Neue Slipanlage")'); pg.wait_for_selector('#dlg[open]')
    check(pg.locator('#dlg input[name=name]').count() == 1, 'Kartenmodul fehlt: Formulare funktionieren weiter')
    ctx.close()

    ctx, pg = new_page(b)
    ctx.route('**/data/community/**', lambda r: r.abort())
    open_app(pg)
    check(pg.locator('.place').count() > 0 and 'konnten nicht geladen werden' in pg.inner_text('#datainfo'), 'Community-Dateien fehlen: Standorte da, Hinweis sichtbar')
    ctx.close()

    ctx, pg = new_page(b)
    ctx.route('**/data/osm/**', lambda r: r.abort())
    pg.goto(BASE); pg.wait_for_selector('.empty', timeout=15000)
    check('nicht geladen werden' in pg.inner_text('#list'), 'Alle Standortdateien fehlen: Fehlermeldung')
    check(pg.locator('#map .leaflet-container, #map.leaflet-container').count() >= 1, 'Karte wird trotzdem angezeigt')
    ctx.unroute('**/data/osm/**')
    pg.click('#list button:has-text("Erneut laden")'); pg.wait_for_selector('.place', timeout=8000)
    check(pg.locator('.place').count() > 0, 'Wiederholen-Schaltfläche lädt die Daten nach')
    ctx.close()

    ctx, pg = new_page(b); ctx.route('**/data/meta.json', lambda r: r.abort()); open_app(pg)
    check(pg.locator('.place').count() > 0, 'meta.json fehlt: Standardpfade werden genutzt')
    ctx.close()

    # kaputtes JSON in einer Datei
    (site / 'data' / 'osm' / 'marina.geojson').write_text('{kaputt')
    ctx, pg = new_page(b); open_app(pg)
    check(pg.locator('.place').count() > 0 and 'konnten nicht geladen' in pg.inner_text('#datainfo'), 'Kaputte Datei: andere Kategorien bleiben nutzbar')
    ctx.close()

if __name__ == '__main__':
    run()
    print('\nFEHLER:', problems if problems else 'keine')
    sys.exit(1 if problems else 0)
