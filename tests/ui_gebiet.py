"""UI-Test Kartengebiet Deutschland – mit dem ECHTEN Leaflet (public/vendor), Kacheln werden durch eine graue Kachel ersetzt.
Prüft: Startansicht, Herauszoomen, Ziehen nach Osten/Westen (Maus und Touch), Helgoland/Ostsee, Kachelabrufe nur im Gebiet,
Maske, Ortssuche außerhalb (Moskau) und innerhalb (Hamburg), Standort im Ausland, Slipanlage öffnen.
Start: python3 tests/ui_gebiet.py [screenshots-ordner]"""
import importlib.util, io, json, math, pathlib, re, sys, tempfile
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def png():
    from PIL import Image
    b = io.BytesIO(); Image.new('RGB', (256, 256), (230, 226, 218)).save(b, 'PNG'); return b.getvalue()
KACHEL = png()

GEO = {'moskau': [{'display_name': 'Moskau, Zentralrussland, Russland', 'lat': '55.75', 'lon': '37.62', 'boundingbox': ['55.1', '56.0', '36.8', '38.0']}],
       'london': [{'display_name': 'London, England, Vereinigtes Königreich', 'lat': '51.507', 'lon': '-0.128', 'boundingbox': ['51.28', '51.69', '-0.51', '0.33']}],
       'hamburg': [{'display_name': 'Hamburg, Deutschland', 'lat': '53.55', 'lon': '9.99', 'boundingbox': ['53.39', '53.74', '9.73', '10.33']}],
       'europa': [{'display_name': 'Europa', 'lat': '51.0', 'lon': '10.0', 'boundingbox': ['34.0', '72.0', '-25.0', '45.0']}]}

def page(b, w, hh, mobile, geo=None):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block',
                        geolocation=geo, permissions=['geolocation'] if geo else [])
    tiles = []
    def kachel(route):
        m = re.search(r'/(\d+)/(\d+)/(\d+)\.png', route.request.url)
        if m: tiles.append(tuple(int(v) for v in m.groups()))
        route.fulfill(status=200, content_type='image/png', body=KACHEL)
    ctx.route('**/tile.openstreetmap.org/**', kachel)
    geo_q = []
    def nominatim(route):
        u = route.request.url; geo_q.append(u)
        q = re.search(r'[?&]q=([^&]+)', u).group(1).lower()
        route.fulfill(status=200, content_type='application/json', body=json.dumps(GEO.get(q, [])))
    ctx.route('**/nominatim.openstreetmap.org/**', nominatim)
    ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": [], "zeit": 0}'))
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.errs, pg.tiles, pg.geo_q = errs, tiles, geo_q
    return ctx, pg

MAP = 'window.__watermap.state.map.raw'
def zustand(pg):
    return pg.evaluate(f"(() => {{ const m = {MAP}, b = m.getBounds(), c = m.getCenter(); return {{ z: m.getZoom(), min: m.getMinZoom(), lat: c.lat, lon: c.lng, s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() }}; }})()")
def ruhe(pg, ms=700):
    pg.wait_for_timeout(ms)

def ziehen(pg, dx, dy, mobile, mal=6):
    box = pg.locator('#map').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    if mobile:   # Touch-Wischen über CDP (wie ein Finger)
        cdp = pg.context.new_cdp_session(pg)
        for _ in range(mal):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
            for i in range(1, 11):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx + dx * i / 10, 'y': cy + dy * i / 10}]})
                pg.wait_for_timeout(16)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            pg.wait_for_timeout(250)
        cdp.detach()
    else:
        for _ in range(mal):
            pg.mouse.move(cx, cy); pg.mouse.down()
            pg.mouse.move(cx + dx, cy + dy, steps=10); pg.mouse.up(); pg.wait_for_timeout(250)
    ruhe(pg, 900)

def kacheln_ausserhalb(pg):
    """Abgerufene Kacheln ab z 9 (Straßenkarten), die weiter als ≈ 1,5° (bzw. 2,4° in Ost-West) von Deutschland entfernt liegen.
    Europa wird leicht grau gezeigt (CONFIG.GEBIET.nachbarn), bis z 8 sind alle Kacheln erlaubt."""
    (s, w), (n, e) = [[47.2613, 5.8586], [55.1047, 15.0471]]
    falsch = []
    for z, x, y in pg.tiles:
        if z <= 8: continue
        k = 2 ** z; lw, le = x / k * 360 - 180, (x + 1) / k * 360 - 180
        lat = lambda yy: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / k))))
        if le < w - 2.41 or lw > e + 2.41 or lat(y + 1) > n + 1.51 or lat(y) < s - 1.51: falsch.append((z, x, y))
    return falsch

def run(b, w, hh):
    mobile = w < 768; tag = f'{w}px'
    print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile, geo={'latitude': 40.42, 'longitude': -3.70})   # Standort: Madrid
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-tile-loaded', timeout=15000); ruhe(pg, 1200)
    # Test 1: Startansicht ganz Deutschland, keine Weltkarte
    s = zustand(pg)
    check(s['s'] <= 47.4 and s['n'] >= 55.0 and s['w'] <= 6.0 and s['e'] >= 14.9, f'{tag}: Start zeigt ganz Deutschland mit Küsten ({s})')
    check(s['e'] - s['w'] < 45 and s['z'] >= 5, f'{tag}: Start auf Deutschland, nicht auf Europa (Breite {s["e"] - s["w"]:.1f}°, Zoom {s["z"]})')
    check(pg.locator('.leaflet-wm-maske-pane canvas').count() == 1, f'{tag}: grauer Schleier außerhalb Deutschlands (Canvas-Ebene)')
    check('OpenStreetMap' in pg.inner_text('.leaflet-control-attribution'), f'{tag}: OSM-Namensnennung sichtbar')
    if mobile:   # die schwebende Navigationsleiste darf die Namensnennung nicht verdecken (ODbL)
        at = pg.locator('.leaflet-control-attribution').bounding_box(); bn = pg.locator('#bottomnav').bounding_box()
        check(at['y'] + at['height'] <= bn['y'] + 1 and at['width'] > 40, f'{tag}: OSM-Namensnennung liegt über der Navigationsleiste ({at["y"] + at["height"]:.0f} ≤ {bn["y"]:.0f})')
    pg.screenshot(path=str(SHOTS / f'gebiet_{w}_1start.png'))
    # Test 2: Herauszoomen
    pg.evaluate(f"{MAP}.setView([51, 10], 9, {{animate: false}})"); ruhe(pg, 400)
    for _ in range(8):   # Minus-Knopf (am Handy ausgeblendet: Zwei-Finger-Zoom → gleiches zoomOut)
        if mobile: pg.evaluate(f"{MAP}.zoomOut()")
        else: pg.click('.leaflet-control-zoom-out', force=True)
        pg.wait_for_timeout(400)
    s2 = zustand(pg)
    check(s2['z'] == s2['min'] and 25 < s2['e'] - s2['w'] <= 125 and s2['n'] - s2['s'] > 20, f'{tag}: Herauszoomen endet bei Europa, keine Weltkarte (Zoom {s2["z"]}, Breite {s2["e"] - s2["w"]:.0f}°)')
    if not mobile: check(pg.locator('.leaflet-control-zoom-out.leaflet-disabled').count() == 1, f'{tag}: Minus-Knopf am kleinsten Zoom deaktiviert')
    pg.evaluate(f"{MAP}.setZoom(1, {{animate: false}})"); ruhe(pg, 300)
    check(zustand(pg)['z'] == s2['min'], f'{tag}: auch per Programm kein kleinerer Zoom')
    pg.screenshot(path=str(SHOTS / f'gebiet_{w}_2europa.png'))
    # Test 3/4: Ziehen – nur bis zum Rand Europas (Ural, Atlantik, Nordkap)
    pg.evaluate(f"{MAP}.setView([52.5, 13.4], 5, {{animate: false}})"); ruhe(pg)
    ziehen(pg, -350 if w > 500 else -250, 0, mobile, mal=12)
    o = zustand(pg)
    check(o['lon'] <= 42.2, f'{tag}: nach Osten höchstens bis zum Rand Europas (Mitte {o["lon"]:.1f})')
    ziehen(pg, 350 if w > 500 else 250, 0, mobile, mal=24)
    we = zustand(pg)
    check(we['lon'] >= -12.2, f'{tag}: nach Westen höchstens bis zum Atlantik (Mitte {we["lon"]:.1f})')
    ziehen(pg, 0, 300 if w > 500 else 220, mobile, mal=12)
    nn = zustand(pg)
    check(nn['lat'] <= 71.7, f'{tag}: nach Norden höchstens bis zum Nordkap (Mitte {nn["lat"]:.1f})')
    # eingezoomt im Ausland (z. B. London): keine Straßenkarten
    pg.tiles.clear(); pg.evaluate(f"{MAP}.setView([51.5, -0.12], 12, {{animate: false}})"); ruhe(pg, 900)
    check(not [t for t in pg.tiles if t[0] >= 9], f'{tag}: London eingezoomt lädt keine Straßenkacheln ({pg.tiles[:3]})')
    pg.screenshot(path=str(SHOTS / f'gebiet_{w}_2rand.png'))
    # Test 5/6: Nordsee (Helgoland) und Ostsee (Rügen) bleiben erreichbar
    for name, (la, lo) in {'Helgoland': (54.18, 7.885), 'Rügen': (54.45, 13.4), 'Bodensee': (47.6, 9.4)}.items():
        pg.evaluate(f"{MAP}.setView([{la}, {lo}], 12, {{animate: false}})"); ruhe(pg, 500)
        c = zustand(pg)
        check(abs(c['lat'] - la) < 0.02 and abs(c['lon'] - lo) < 0.02 and pg.evaluate(f"window.__watermap && (async () => (await import('./js/gebiet.js')).imGebiet({la}, {lo}))()"),
              f'{tag}: {name} erreichbar und im Gebiet')
    pg.screenshot(path=str(SHOTS / f'gebiet_{w}_3helgoland.png')) if False else None
    falsch = kacheln_ausserhalb(pg)
    check(not falsch and len(pg.tiles) > 0, f'{tag}: keine Kacheln fern von Deutschland geladen ({len(pg.tiles)} geladen, außerhalb: {falsch[:5]})')
    # Test 7: Suche außerhalb (Moskau, London) – kein Sprung, Hinweis
    pg.evaluate(f"{MAP}.setView([51.0, 10.0], 7, {{animate: false}})"); ruhe(pg, 400)
    vorher = zustand(pg)
    for ort in ('Moskau', 'London'):
        pg.fill('#q', ort); pg.wait_for_timeout(200); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
        nach = zustand(pg)
        hinweis = 'WaterMap ist derzeit auf Deutschland sowie die deutschen Nord- und Ostseegebiete begrenzt.' in pg.inner_text('body')
        check(abs(nach['lat'] - vorher['lat']) < 0.01 and abs(nach['lon'] - vorher['lon']) < 0.01 and hinweis, f'{tag}: Suche „{ort}“: kein Sprung, Hinweis')
        pg.fill('#q', ''); pg.keyboard.press('Escape')
    check(pg.geo_q and 'bounded=1' in pg.geo_q[-1] and 'viewbox=' in pg.geo_q[-1], f'{tag}: Geocoder nur im Rechteck um Deutschland')
    # große Bounding-Box („Europa“) wird beschnitten
    pg.fill('#q', 'Europa'); pg.wait_for_timeout(200); pg.keyboard.press('Enter'); pg.wait_for_timeout(1200)
    eu = zustand(pg)
    check(eu['e'] - eu['w'] < 45 and eu['lon'] > 5 and eu['lon'] < 15.7, f'{tag}: großer Treffer bleibt im Gebiet ({eu["lon"]:.1f}, Breite {eu["e"] - eu["w"]:.1f}°)')
    pg.fill('#q', ''); pg.keyboard.press('Escape')
    # Hamburg: Sprung dorthin
    pg.fill('#q', 'Hamburg'); pg.wait_for_timeout(200); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
    hb = zustand(pg)
    check(53.3 < hb['lat'] < 53.9 and 9.4 < hb['lon'] < 10.6, f'{tag}: Suche „Hamburg“ springt nach Hamburg ({hb["lat"]:.2f}, {hb["lon"]:.2f})')
    pg.fill('#q', ''); pg.keyboard.press('Escape')
    # Standort im Ausland (Madrid): Freigabe klappt, kein Sprung, Hinweis
    vorher = zustand(pg)
    pg.click('#btn-locate', force=True); pg.wait_for_timeout(1500)
    nach = zustand(pg)
    check(abs(nach['lat'] - vorher['lat']) < 0.01 and 'außerhalb des Kartengebiets' in pg.inner_text('body') and pg.evaluate('!!window.__watermap.state.user'),
          f'{tag}: Standort in Spanien: kein Sprung, Hinweis, Standort trotzdem bekannt')
    # Test 8: Slipanlage öffnen wie bisher
    pid = pg.evaluate("window.__watermap.state.places.find(p => p.type === 'slip').id")
    pg.evaluate(f"window.__watermap.selectPlace({pid!r}, {{full: true}})"); pg.wait_for_selector('#detail:not([hidden])'); ruhe(pg, 900)
    c = zustand(pg); p = pg.evaluate(f"(() => {{ const p = window.__watermap.state.byId.get({pid!r}); return [p.lat, p.lon]; }})()")
    check(c['s'] < p[0] < c['n'] and c['w'] < p[1] < c['e'] and c['z'] >= 14, f'{tag}: Slipanlage geöffnet und auf der Karte sichtbar (Zoom {c["z"]})')
    check(pg.locator('.leaflet-marker-icon').count() > 0, f'{tag}: Marker sichtbar')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(390, 844), (1024, 768), (1440, 900), (2560, 1100)]:
                run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
