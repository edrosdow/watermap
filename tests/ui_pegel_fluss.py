"""UI-Test Fluss-Kacheln und Flussseite (#pegel/fluss/<name>) mit nachgebildetem PEGELONLINE und den Daten aus ui_full.py.
Start: python3 tests/ui_pegel_fluss.py [screenshots-ordner]"""
import datetime as dt, importlib.util, json, math, pathlib, re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = dt.datetime.now(dt.timezone.utc)

def station(uuid, name, water, km, lat, lon, value, state='normal', hsw='normal', trend=None, refs=None, age_h=0):
    cm = {'timestamp': (NOW - dt.timedelta(hours=age_h)).isoformat(), 'value': value, 'stateMnwMhw': state, 'stateNswHsw': hsw}
    if trend is not None: cm['trend'] = trend
    return {'uuid': uuid, 'number': uuid[:6], 'shortname': name, 'longname': name, 'km': km, 'agency': 'WSA TEST', 'longitude': lon, 'latitude': lat,
            'water': {'shortname': water, 'longname': water},
            'timeseries': [{'shortname': 'W', 'longname': 'W', 'unit': 'cm', 'equidistance': 15, 'currentMeasurement': cm,
                            'characteristicValues': [{'shortname': k, 'unit': 'cm', 'value': v} for k, v in (refs or {}).items()]}]}

R = {'MNW': 98, 'MW': 210, 'MHW': 480, 'HSW': 590}
TIDE = {'MThw': 700, 'MTnw': 300}
U = lambda n: f'{n:08d}-0000-4000-8000-000000000000'
ELBE = [('SCHÖNA', 2, 80, 'low'), ('DRESDEN', 55, 62, 'low'), ('MEISSEN', 82, 85, 'low'), ('TORGAU', 154, 90, 'low'), ('WITTENBERG', 214, 92, 'low'),
        ('AKEN', 275, 95, 'low'), ('MAGDEBURG-STROMBRÜCKE', 326, 96, 'low'), ('TANGERMÜNDE', 388, 120, 'normal'), ('WITTENBERGE', 454, 150, 'normal'),
        ('NEU DARCHAU', 536, 200, 'normal')]
STATIONS = [station(U(i + 1), n, 'ELBE', km, 51 + i * 0.2, 12 + i * 0.1, v, state=s, refs=R, trend=-1 if n == 'DRESDEN' else None) for i, (n, km, v, s) in enumerate(ELBE)]
STATIONS += [
    station(U(20), 'HAMBURG ST. PAULI', 'ELBE', 623.1, 53.54, 9.97, 520, state='unknown', refs=TIDE),
    station(U(21), 'CUXHAVEN', 'ELBE', 727.0, 53.87, 8.71, 610, state='unknown', refs=TIDE),
    station(U(22), 'ELBE OHNE KM', 'ELBE', None, 52.0, 11.0, 100, refs=R),
    station(U(30), 'TRIER', 'MOSEL', 195.8, 49.76, 6.63, 640, state='high', hsw='high', refs=R, trend=1),
    station(U(31), 'COCHEM', 'MOSEL', 51.6, 50.15, 7.17, 500, state='high', refs=R),
    *[station(U(40 + i), f'NECKAR {i}', 'NECKAR', 10.0 + i * 30, 49.0 + i * 0.1, 9.0, 200, refs=R) for i in range(5)],
    station(U(50), 'MITTELLAND A', 'MITTELLANDKANAL', 100.0, 52.3, 9.0, 300, state='unknown'),
    station(U(51), 'MITTELLAND B', 'MITTELLANDKANAL', 200.0, 52.3, 10.0, 300, state='unknown'),
    station(U(60), 'HELGOLAND', 'NORDSEE', None, 54.18, 7.89, 500, state='unknown'),
    station(U(61), 'KIEL', 'OSTSEE', None, 54.32, 10.14, 500, state='unknown'),
    station(U(62), 'WILHELMSHAVEN', 'AUSSENJADE', 10.0, 53.5, 8.15, 450, state='unknown', refs=TIDE),
    station(U(70), 'HALLE', 'SAALE', 90.0, 51.48, 11.97, 200, refs=R, age_h=30),
    station(U(80), 'TESTSEE NORD', 'TEST-SEE', 1.0, 51.4, 7.6, 200, refs=R),
    station(U(81), 'TESTSEE SÜD', 'TEST-SEE', 5.0, 51.3, 7.6, 200, refs=R),
]
BY_ID = {s['uuid']: s for s in STATIONS}
calls = []

def handler(route):
    rest = urlparse(route.request.url).path.split('/api/pegel/', 1)[1]
    calls.append(rest)
    if rest == 'stations.json': return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and m.group(1) in BY_ID:
        cur = BY_ID[m.group(1)]['timeseries'][0]['currentMeasurement']['value']; start = NOW - dt.timedelta(days=7)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'timestamp': (start + dt.timedelta(minutes=15 * i)).isoformat(), 'value': cur + 5 * math.sin(i / 30)} for i in range(673)]))
    return route.fulfill(status=404, body='[]')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    ctx.route('**/api/pegel/**', handler)
    ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": []}'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); localStorage.setItem('watermap.meinePegel.ampel', '1'); localStorage.setItem('watermap.cats', 'marina'); } catch {}")
    pg = ctx.new_page(); errs = []; infos = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: (errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else infos.append(m.text) if m.type == 'info' else None))
    pg.errs = errs; pg.infos = infos
    return ctx, pg

def run(b, w, hh, mobile):
    tag = f'{w}px'
    print(f'--- {tag}')
    nav = '#bottomnav' if mobile else '#topnav'
    ctx, pg = page(b, w, hh, mobile)
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.fk')
    namen = [t.strip() for t in pg.locator('.fk .fk-name').all_inner_texts()]
    check(namen == ['Mosel', 'Elbe', 'Neckar', 'Test-See', 'Saale', 'Küste'], f'{tag}: 6 Kacheln, Schwere vor Anzahl, Küste zuletzt ({namen})')
    elbe = pg.locator('.fk', has_text='Elbe')
    t = elbe.inner_text()
    check('niedrig' in t and 'tiefster Pegel' in t and 'Dresden 62 cm' in t and '7 von 11 niedrig' in t and elbe.locator('.fk-punkte i').count() == 11, f'{tag}: Kachel Elbe ({t!r})')
    check(elbe.locator('.pf-trend').get_attribute('aria-label') == 'fallend', f'{tag}: Trendpfeil mit Text')
    check(pg.locator('.fk', has_text='Mosel').locator('.fk-punkte i').count() == 2 and 'über HSW' in pg.locator('.fk', has_text='Mosel').inner_text(), f'{tag}: Kachel Mosel über HSW')
    nk = pg.locator('.fk', has_text='Neckar').inner_text()
    check('alle 5 Pegel' in nk and 'im Normalbereich' in nk and 'keine Auffälligkeiten' in nk, f'{tag}: Kachel Neckar normal')
    sa = pg.locator('.fk', has_text='Saale')
    check('keine Daten' in sa.inner_text() and 'keine aktuellen Daten' in sa.inner_text() and sa.locator('.fk-punkte').count() == 0, f'{tag}: Fluss nur mit veralteten Werten grau „keine aktuellen Daten“')
    ku = pg.locator('.fk', has_text='Küste').inner_text()
    check('Tide' in ku and '3 Pegel' in ku, f'{tag}: Küste mit Nordsee, Ostsee und Außenjade ({ku!r})')
    check(any('Mittellandkanal (2)' in m for m in pg.infos), f'{tag}: Vorschau: Gewässer ohne Zuordnung in der Konsole ({pg.infos[:1]})')
    pg.click('.pg-fl-alle'); pg.wait_for_timeout(200)
    check(pg.locator('.fk-ohne-zeile').count() == 1 and 'Mittellandkanal' in pg.inner_text('.fk-ohne'), f'{tag}: „Alle 7 Gewässer“: Kanal im eigenen Abschnitt')
    pg.screenshot(path=str(SHOTS / f'fluss_{w}_1kacheln.png'), full_page=True)
    n_mess = len([c for c in calls if 'measurements' in c])

    # Flussseite Elbe
    pg.click('.fk:has-text("Elbe")'); pg.wait_for_selector('.pf-titel'); pg.wait_for_timeout(300)
    check(pg.url.endswith('#pegel/fluss/elbe') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Adresse #pegel/fluss/elbe, Tab „Pegel“ aktiv')
    kopf = pg.inner_text('.pf-kopf')
    check('GEWÄSSER' in kopf.upper() and 'Elbe' in kopf and 'niedrig' in kopf and '7 von 11 Pegeln unter MNW' in kopf and re.search(r'Stand \d\d:\d\d', kopf), f'{tag}: Kopf ({kopf!r})')
    check('Wasserstand entlang der Elbe' in pg.inner_text('.pf-profilkarte'), f'{tag}: Überschrift Profil')
    check(pg.locator('.pf-punkt').count() == 10, f'{tag}: 10 Punkte (ohne Tide, ohne km)')
    hl = pg.locator('.pf-hervor-text').text_content()
    check(hl == 'Dresden 62 cm', f'{tag}: hervorgehobener Pegel mit Etikett ({hl!r})')
    check(pg.locator('.pf-ax.is-tide').text_content() == 'Tidebereich', f'{tag}: Tidebereich abgetrennt und beschriftet')
    en = pg.inner_text('.pf-enden')
    check('← Schöna (km 2)' in en and 'Cuxhaven (km 727) →' in en, f'{tag}: Enden mit Name und km ({en!r})')
    check(all(x in pg.inner_text('.pf-legende') for x in ['unter MNW', 'normal', 'über MHW', 'über HSW']), f'{tag}: Legende')
    lab = pg.get_attribute('.pf-svg', 'aria-label') or ''
    check('Tiefster Pegel: Dresden 62 cm' in lab and '7 unter MNW' in lab, f'{tag}: aria-label mit Textzusammenfassung')
    svg = pg.locator('.pf-svg').bounding_box()
    check(abs(svg['height'] - 190) < 2 and svg['width'] > (w * 0.45 if not mobile else w - 80), f'{tag}: Profil volle Breite, 190 px hoch ({svg})')
    # Lage der Punkte: MNW-Linie bei rel 0, Dresden darunter
    y_mnw = float(pg.locator('.pf-svg line').nth(1).get_attribute('y1'))
    cy = [float(c.get_attribute('cy')) for c in pg.locator('.pf-punkt').all()]
    check(cy[1] > y_mnw and cy[-1] < y_mnw, f'{tag}: unter MNW unterhalb, normal oberhalb der MNW-Linie')
    # Liste
    zeilen = pg.locator('.pf-zeile')
    check(zeilen.count() == 6 and 'Alle 13 Pegel' in pg.inner_text('.pf-listenkarte') and 'nach Flusskilometer' in pg.inner_text('.pf-listenkarte'), f'{tag}: erst 6 Zeilen')
    check('is-hervor' in zeilen.nth(1).get_attribute('class') and 'km 55 · tiefster' in zeilen.nth(1).inner_text(), f'{tag}: hervorgehobene Zeile „tiefster“')
    pg.click('.pf-mehr'); pg.wait_for_timeout(150)
    texte = [t for t in pg.locator('.pf-zeile').all_inner_texts()]
    check(len(texte) == 13 and 'Tide' in texte[10] and 'km 623,1 · Tide' in texte[10] and texte[12].startswith('Elbe Ohne Km'), f'{tag}: alle Pegel, Tide markiert, ohne km am Ende')
    check(len([c for c in calls if 'measurements' in c]) == n_mess, f'{tag}: keine Abfragen pro Pegel für Kacheln und Profil')
    if not mobile and w >= 1024:
        pk = pg.locator('.pf-profilkarte').bounding_box(); lk = pg.locator('.pf-listenkarte').bounding_box()
        check(lk['x'] > pk['x'] + pk['width'] - 1 and abs(lk['y'] - pk['y']) < 2, f'{tag}: Desktop zweispaltig (Profil links, Liste rechts)')
    check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth') and pg.evaluate("document.querySelector('#pegelseite').scrollWidth <= window.innerWidth"), f'{tag}: kein horizontales Scrollen')
    klein = pg.evaluate("""[...document.querySelectorAll('.pf-seite button, .fk')].filter(e => e.offsetParent !== null)
        .map(e => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.height)]; }).filter(x => x[1] < 44)""")
    check(not klein, f'{tag}: Touch-Ziele ≥ 44 px {klein[:3]}')
    pg.screenshot(path=str(SHOTS / f'fluss_{w}_2elbe.png'), full_page=True)

    # Punkt: Hover/Tipp → Blase, Detailseite, Zurück
    ziel = pg.locator('.pf-ziel').nth(1)
    if mobile:
        ziel.tap(force=True); pg.wait_for_timeout(150)   # dicht liegende Punkte: der nächstgelegene zur Tippstelle gewinnt
        check(pg.locator('.pf-blase').is_visible() and 'Dresden' in pg.inner_text('.pf-blase') and 'Details ›' in pg.inner_text('.pf-blase') and pg.url.endswith('#pegel/fluss/elbe'),
              f'{tag}: erster Tipp zeigt die Blase')
        pg.locator('.pf-legende').tap(); pg.wait_for_timeout(100)
        check(pg.locator('.pf-blase').is_hidden(), f'{tag}: Tipp daneben schließt die Blase')
        ziel.tap(force=True); pg.wait_for_timeout(100); pg.locator('.pf-blase-btn').tap()
    else:
        ziel.hover(); pg.wait_for_timeout(150)
        check(pg.locator('.pf-blase').is_visible() and '62 cm' in pg.inner_text('.pf-blase') and 'niedrig' in pg.inner_text('.pf-blase'), f'{tag}: Hover zeigt Name, Wert, Zustand')
        ziel.click()
    pg.wait_for_selector('.pd-name')
    check(pg.url.endswith(f'#pegel/{U(2)}') and 'Dresden' in pg.inner_text('.pd-name'), f'{tag}: Punkt öffnet die Pegel-Detailseite')
    pg.go_back(); pg.wait_for_selector('.pf-titel')
    check(pg.url.endswith('#pegel/fluss/elbe'), f'{tag}: Zurück von der Detailseite → Flussseite')
    pg.locator('.pf-zeile').nth(0).click(); pg.wait_for_selector('.pd-name')
    check('Schöna' in pg.inner_text('.pd-name'), f'{tag}: Zeile öffnet die Pegel-Detailseite')
    pg.go_back(); pg.wait_for_selector('.pf-titel')
    pg.click('.pf-zurueck'); pg.wait_for_selector('.fk')
    check(pg.url.endswith('#pegel'), f'{tag}: Zurück-Pfeil → Dashboard')

    # Küste und Kanal: ohne Profil, nur Liste
    pg.click('.fk:has-text("Küste")'); pg.wait_for_selector('.pf-titel')
    check(pg.url.endswith('#pegel/fluss/kueste') and pg.locator('.pf-svg').count() == 0 and pg.locator('.pf-zeile').count() == 3 and 'Tide' in pg.inner_text('.pf-kopf'), f'{tag}: Küste ohne Profil, Liste der Küstenpegel')
    pg.go_back(); pg.wait_for_selector('.fk')
    if pg.locator('.fk-ohne').count() == 0: pg.click('.pg-fl-alle'); pg.wait_for_timeout(150)
    pg.click('.fk-ohne-zeile'); pg.wait_for_selector('.pf-titel')
    check(pg.url.endswith('#pegel/fluss/mittellandkanal') and pg.locator('.pf-svg').count() == 0 and 'ohne Kennwerte' in pg.inner_text('.pf-kopf')
          and pg.locator('.pf-zeile .pz-tag').first.inner_text() == 'ohne Kennw.', f'{tag}: Kanal ohne Profil, Pegel „ohne Kennw.“')
    pg.screenshot(path=str(SHOTS / f'fluss_{w}_3kanal.png'))

    # Direkter Link, Slipanlagen an diesem Gewässer
    pg.goto(uf.BASE + '#pegel/fluss/test-see'); pg.wait_for_selector('.pf-titel')
    slips = pg.locator('.pf-slips')
    n = int(re.search(r'(\d+) Slipanlage', slips.inner_text()).group(1))
    check(n > 0 and 'am Test-See' in slips.inner_text() and 'Auf der Karte zeigen' in slips.inner_text(), f'{tag}: Karte „{n} Slipanlagen an der …“')
    ids = pg.evaluate("window.__watermap.state.places.filter(p => p.type === 'slip' && (p.water?.name || '').toLowerCase().replace(/[^a-zäöüß]/g, '') === 'testsee').map(p => p.id)")
    slips.click(); pg.wait_for_timeout(500)
    st = pg.evaluate("({ view: window.__watermap.state.view, cats: [...window.__watermap.state.cats].sort() })")
    check(st['view'] == 'karte' and st['cats'] == ['marina', 'slip'], f'{tag}: Slipanlagen zusätzlich eingeschaltet, Häfen bleiben ({st})')
    drin = pg.evaluate("""(ids) => { const b = window.__watermap.state.map.getBounds();
        return ids.map(id => window.__watermap.state.byId.get(id)).every(p => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east); }""", ids)
    check(drin and len(ids) == n, f'{tag}: Karte zeigt alle {len(ids)} Slipanlagen des Gewässers')
    pg.goto(uf.BASE + '#pegel/fluss/gibtsnicht'); pg.wait_for_selector('.pg-fehler')
    check('nicht gefunden' in pg.inner_text('.pg-fehler'), f'{tag}: unbekanntes Gewässer → Hinweis')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

import tempfile
with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run(b, 1440, 900, False); run(b, 1024, 768, False); run(b, 390, 844, True); run(b, 375, 667, True)
            b.close()
    finally:
        srv.shutdown()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
