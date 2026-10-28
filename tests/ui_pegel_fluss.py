"""UI-Test Fluss-Kacheln und Flussseite (#pegel/fluss/<name>) mit nachgebildetem PEGELONLINE und den Daten aus ui_full.py.
Start: python3 tests/ui_pegel_fluss.py [screenshots-ordner]"""
import datetime as dt, importlib.util, json, math, pathlib, re, sys
from urllib.parse import urlparse, parse_qs
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
# Lage entlang einer Linie Schöna → Cuxhaven (passend zu den km, damit die Reihenfolge nach km gilt)
ELAT = lambda km: 50.9 + km / 727 * 2.97
ELON = lambda km: 14.2 - km / 727 * 5.5
STATIONS = [station(U(i + 1), n, 'ELBE', km, ELAT(km), ELON(km), v, state=s, refs=R, trend=-1 if n == 'DRESDEN' else None) for i, (n, km, v, s) in enumerate(ELBE)]
STATIONS += [
    station(U(20), 'HAMBURG ST.PAULI', 'ELBE', 623.1, ELAT(623.1), ELON(623.1), 520, state='unknown', refs=TIDE),
    station(U(21), 'CUXHAVEN', 'ELBE', 727.0, ELAT(727), ELON(727), 610, state='unknown', refs=TIDE),
    station(U(22), 'ELBE OHNE KM', 'ELBE', None, 52.0, 11.0, 100, refs=R),
    station(U(30), 'TRIER', 'MAIN', 195.8, 49.76, 6.63, 640, state='high', hsw='high', refs=R, trend=1),
    station(U(31), 'COCHEM', 'MAIN', 51.6, 50.15, 7.17, 500, state='high', refs=R),
    *[station(U(40 + i), f'NECKAR {i}', 'DONAU', 10.0 + i * 30, 49.0 + i * 0.1, 9.0, 200, refs=R) for i in range(5)],
    station(U(50), 'MITTELLAND A', 'MITTELLANDKANAL', 100.0, 52.3, 9.0, 300, state='unknown'),
    station(U(51), 'MITTELLAND B', 'MITTELLANDKANAL', 200.0, 52.3, 10.0, 300, state='unknown'),
    station(U(60), 'HELGOLAND', 'NORDSEE', None, 54.18, 7.89, 500, state='unknown'),
    station(U(61), 'KIEL', 'OSTSEE', None, 54.32, 10.14, 500, state='unknown'),
    station(U(62), 'WILHELMSHAVEN', 'AUSSENJADE', 10.0, 53.5, 8.15, 450, state='unknown', refs=TIDE),
    station(U(70), 'HALLE', 'RHEIN', 90.0, 51.48, 11.97, 200, refs=R, age_h=30),
    station(U(80), 'TESTSEE NORD', 'TEST-SEE', 1.0, 51.4, 7.6, 200, refs=R),
    station(U(81), 'TESTSEE SÜD', 'TEST-SEE', 5.0, 51.3, 7.6, 200, refs=R),
]
BY_ID = {s['uuid']: s for s in STATIONS}

# BSH-Gezeitenvorhersage (über /api/gezeiten) – nur für Cuxhaven (und den Cuxhaven-Pegel der Küsten-Kachel)
CUX_ECHT = 'aad49293-242a-43ad-a8b1-e91d7792c4b2'
def bsh_daten():
    jetzt = dt.datetime.now(dt.timezone.utc)
    ms = lambda d: int(d.timestamp() * 1000)
    ereig = [{'t': ms(jetzt + dt.timedelta(minutes=70)), 'typ': 'HW', 'astro': 679, 'vh': 718, 'abw': '+0,5 bis +0,75 m', 'unsicher': 12.5}]
    for i, typ in enumerate(['NW', 'HW', 'NW', 'HW']):
        ereig.append({'t': ms(jetzt + dt.timedelta(minutes=70 + 372 * (i + 1))), 'typ': typ, 'astro': 368 if typ == 'NW' else 680})
    kurve = [{'t': ms(jetzt + dt.timedelta(minutes=10 * i)), 'astro': round(520 + 150 * math.sin(2 * math.pi * (i * 10 + 116) / 745), 1),
              **({'vh': round(560 + 150 * math.sin(2 * math.pi * (i * 10 + 116) / 745), 1)} if i > 0 else {})} for i in range(-6, 180)]
    return {'ort': 'cuxhaven_steubenhoeft', 'name': 'Cuxhaven, Steubenhöft, Elbe', 'stand': ms(jetzt - dt.timedelta(hours=3)), 'ereignisse': ereig, 'kurve': kurve,
            'text': 'Das Hochwasser wird 1/2 bis 3/4 m höher als das mittlere Hochwasser eintreten.', 'zusatz': None, 'link': 'https://wasserstand.bsh.de/cuxhaven_steubenhoeft', 'lizenz': 'CC BY 4.0', 'quelle': 'BSH'}
bsh = {'aus': False}
def bsh_handler(route):
    q = parse_qs(urlparse(route.request.url).query)
    calls.append(route.request.url)
    if bsh['aus']: return route.fulfill(status=502, content_type='application/json', body='{"fehler": "nicht erreichbar"}')
    if 'orte' in q: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'orte': [{'id': 'cuxhaven_steubenhoeft', 'name': 'Cuxhaven', 'nr': None, 'uuid': U(21)}, {'id': 'helgoland', 'name': 'Helgoland', 'nr': '9510070', 'uuid': None}]}))
    if q.get('pegel', [''])[0] in (U(21), CUX_ECHT): return route.fulfill(status=200, content_type='application/json', body=json.dumps(bsh_daten()))
    return route.fulfill(status=404, content_type='application/json', body='{"keinOrt": true}')
calls = []

def handler(route):
    rest = urlparse(route.request.url).path.split('/api/pegel/', 1)[1]
    calls.append(rest)
    if rest == 'stations.json': return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and m.group(1) in BY_ID:
        st_ = BY_ID[m.group(1)]; cur = st_['timeseries'][0]['currentMeasurement']['value']; start = NOW - dt.timedelta(days=7)
        tide = any(c['shortname'] == 'MThw' for c in st_['timeseries'][0]['characteristicValues'])
        # Tidepegel: Gezeitenkurve (12,42 h, ±150 cm), jetzt auflaufend; sonst leichte Schwankung
        wert = (lambda i: cur + 150 * math.sin(2 * math.pi * (i - 672) * 0.25 / 12.42)) if tide else (lambda i: cur + 5 * math.sin(i / 30))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'timestamp': (start + dt.timedelta(minutes=15 * i)).isoformat(), 'value': round(wert(i), 1)} for i in range(673)]))
    return route.fulfill(status=404, body='[]')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    ctx.route('**/api/pegel/**', handler)
    ctx.route('**/api/gezeiten**', bsh_handler)
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
    check(namen == ['Rhein', 'Elbe', 'Donau', 'Main', 'Küste'], f'{tag}: feste Übersicht Rhein, Elbe, (Weser), Donau, Main, Küste ({namen})')
    elbe = pg.locator('.fk', has_text='Elbe')
    t = elbe.inner_text()
    check('niedrig' in t and 'tiefster Pegel' in t and 'Dresden 62 cm' in t and '7 von 11 niedrig' in t and elbe.locator('.fk-punkte i').count() == 11, f'{tag}: Kachel Elbe ({t!r})')
    check(elbe.locator('.pf-trend').get_attribute('aria-label') == 'fallend', f'{tag}: Trendpfeil mit Text')
    check(pg.locator('.fk', has_text='Main').locator('.fk-punkte i').count() == 2 and 'über HSW' in pg.locator('.fk', has_text='Main').inner_text(), f'{tag}: Kachel Main über HSW')
    nk = pg.locator('.fk', has_text='Donau').inner_text()
    check('alle 5 Pegel' in nk and 'im Normalbereich' in nk and 'keine Auffälligkeiten' in nk, f'{tag}: Kachel Donau normal')
    sa = pg.locator('.fk', has_text='Rhein')
    check('keine Daten' in sa.inner_text() and 'keine aktuellen Daten' in sa.inner_text() and sa.locator('.fk-punkte').count() == 0, f'{tag}: Fluss nur mit veralteten Werten grau „keine aktuellen Daten“')
    pg.wait_for_function("document.querySelector('.fk-kueste, .fk:last-child')?.textContent.includes('Cuxhaven: Hochwasser')", timeout=5000)
    ku = pg.locator('.fk', has_text='Küste').inner_text()
    check('Tide' in ku and '3 Pegel' in ku and re.search(r'Cuxhaven: Hochwasser \d\d:\d\d', ku), f'{tag}: Küste mit Nordsee, Ostsee und Außenjade, nächstes HW Cuxhaven ({ku!r})')
    check(any('Mittellandkanal (2)' in m for m in pg.infos), f'{tag}: Vorschau: Gewässer ohne Zuordnung in der Konsole ({pg.infos[:1]})')
    check(pg.locator('.fk-weitere').count() == 0 and 'Alle 7 Gewässer anzeigen' in pg.inner_text('.pg-fl-alle'), f'{tag}: Liste zu, „Alle 7 Gewässer anzeigen“')
    pg.locator('.pg-fl-alle').scroll_into_view_if_needed(); pg.wait_for_timeout(100)
    y0 = pg.locator('.pg-fl-alle').bounding_box()['y']
    pg.click('.pg-fl-alle'); pg.wait_for_timeout(200)
    check(abs(pg.locator('.pg-fl-alle').bounding_box()['y'] - y0) < 2 and pg.locator('.fk').count() == 5, f'{tag}: Aufklappen ohne Sprung, Kacheln bleiben')
    wl = pg.locator('.fk-weitere-liste').inner_text()
    check('Weitere Flüsse (1)' in wl and 'Test-See' in wl and 'normal' in wl and '2 Pegel' in wl, f'{tag}: kompakte Liste mit Zustand und Pegelzahl ({wl!r})')
    check(pg.locator('.fk-ohne-zeile:not(.fk-wz)').count() == 1 and 'Mittellandkanal' in pg.inner_text('.fk-ohne:not(.fk-weitere-liste)'), f'{tag}: Kanal im eigenen Abschnitt')
    pg.fill('.fk-suche', 'mittel'); pg.wait_for_timeout(100)
    check(pg.locator('.fk-weitere-liste').is_hidden() and pg.locator('.fk-ohne-zeile:visible').count() == 1, f'{tag}: Gewässer-Suche filtert die Liste')
    pg.fill('.fk-suche', 'xyz'); pg.wait_for_timeout(100)
    check('Kein Gewässer zu „xyz“' in pg.inner_text('.fk-weitere'), f'{tag}: Suche ohne Treffer mit Hinweis')
    pg.fill('.fk-suche', ''); pg.wait_for_timeout(100)
    check(pg.evaluate('document.documentElement.scrollWidth') <= w, f'{tag}: Liste ohne waagerechtes Scrollen')
    pg.screenshot(path=str(SHOTS / f'fluss_{w}_1kacheln.png'), full_page=True)
    n_mess = len([c for c in calls if 'measurements' in c])

    # Flussseite Elbe
    pg.click('.fk:has-text("Elbe")'); pg.wait_for_selector('.pf-titel'); pg.wait_for_timeout(300)
    check(pg.url.endswith('#pegel/fluss/elbe') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Adresse #pegel/fluss/elbe, Tab „Pegel“ aktiv')
    kopf = pg.inner_text('.pf-kopf')
    check('GEWÄSSER' not in kopf.upper() and 'Elbe' in kopf and 'niedrig' in kopf and re.search(r'7 von 11 bewerteten Pegeln unter MNW · Stand \d\d:\d\d', kopf), f'{tag}: kompakter Kopf ({kopf!r})')
    if mobile:
        check(pg.locator('.app-header').is_hidden() and pg.locator('.pf-kopf').bounding_box()['y'] < 5, f'{tag}: Flussseite ohne globales Suchfeld')
    check('Wasserstand entlang der Elbe' in pg.inner_text('.pf-profilkarte'), f'{tag}: Überschrift Profil')
    check(pg.locator('.pf-punkt').count() == 10, f'{tag}: 10 Punkte (ohne Tide, ohne km)')
    hv = pg.inner_text('.pf-hervor')
    check('tiefster Pegel' in hv and 'Dresden · 62 cm' in hv and '36 cm unter MNW' in hv, f'{tag}: Zeile mit tiefstem Pegel über dem Diagramm ({hv!r})')
    check('Dresden' not in (pg.locator('.pf-svg').text_content() or '') and pg.locator('.pf-punkt.is-hervor').get_attribute('r') == '6.5', f'{tag}: im Diagramm kein Etikett, Punkt nur größer')
    check(pg.locator('.pf-svg line[stroke="#9AAAB5"]').count() == 0, f'{tag}: keine Tide-Trennlinie im Diagramm')
    en = pg.inner_text('.pf-enden')
    check('← Schöna' in en and 'Neu Darchau →' in en and 'km' not in en, f'{tag}: Enden einzeilig ohne km ({en!r})')
    check(pg.locator('.pf-enden span').first.bounding_box()['height'] < 26, f'{tag}: Enden einzeilig')
    check(all(x in pg.inner_text('.pf-legende') for x in ['unter MNW', 'normal', 'über MHW', 'über HSW']) and pg.locator('.pf-tipp').is_visible(), f'{tag}: Legende und „Tippe auf einen Punkt …“')
    lab = pg.get_attribute('.pf-svg', 'aria-label') or ''
    check('Tiefster Pegel: Dresden 62 cm' in lab and '7 unter MNW' in lab and 'Ab Neu Darchau folgen 2 Tidepegel' in lab, f'{tag}: aria-label mit Textzusammenfassung und Tidepegeln')
    svg = pg.locator('.pf-svg').bounding_box()
    check(abs(svg['height'] - 170) < 2 and svg['width'] > (w * 0.45 if not mobile else w - 80), f'{tag}: Profil volle Breite, 170 px hoch ({svg})')
    cx = [float(c.get_attribute('cx')) for c in pg.locator('.pf-punkt').all()]
    abst = [round(b - a, 1) for a, b in zip(cx, cx[1:])]
    check(max(abst) - min(abst) < 0.5, f'{tag}: gleiche Abstände in Fließrichtung ({abst[:3]})')
    # Höhe: MNW-Linie im Bild, MHW (alle Werte weit darunter) nicht – stattdessen Hinweis
    mnw = pg.locator('.pf-svg line[stroke="#C98A00"]')
    y_mnw = float(mnw.get_attribute('y1'))
    cy = [float(c.get_attribute('cy')) for c in pg.locator('.pf-punkt').all()]
    check(cy[1] > y_mnw and cy[-1] < y_mnw, f'{tag}: unter MNW unterhalb, normal oberhalb der MNW-Linie')
    check(pg.locator('.pf-svg line[stroke="#EC835A"]').count() == 0 and 'MHW liegt weiter oben ↑' in pg.locator('.pf-svg').text_content(), f'{tag}: MHW außerhalb → Hinweis „MHW liegt weiter oben ↑“')
    check(pg.locator('.pf-svg rect[fill="#FFF8E6"]').count() == 1 and pg.locator('.pf-svg rect[fill="#E4F4E8"]').count() == 1, f'{tag}: Flächen niedrig (gelb) und normal (grün)')
    tz = pg.locator('.pf-tidezeile')
    check(tz.is_visible() and 'Ab Neu Darchau 2 Tidepegel' in tz.inner_text() and tz.bounding_box()['height'] >= 44, f'{tag}: Tide-Zeile unter dem Diagramm')
    # Liste
    zeilen = pg.locator('.pf-zeile')
    check(zeilen.count() == 6 and 'Alle 13 Pegel' in pg.inner_text('.pf-listenkarte') and 'flussabwärts' in pg.inner_text('.pf-listenkarte'), f'{tag}: erst 6 Zeilen, „flussabwärts“')
    check('is-hervor' in zeilen.nth(1).get_attribute('class') and 'km 55 · tiefster' in zeilen.nth(1).inner_text(), f'{tag}: hervorgehobene Zeile „tiefster“')
    pg.wait_for_function("document.querySelector('.pf-tide-live')?.textContent.includes('gerade')", timeout=5000)
    check('Ab Neu Darchau 2 Tidepegel · gerade auflaufend' in pg.inner_text('.pf-tidezeile'), f'{tag}: Tide-Zeile mit Live-Info ({pg.inner_text(".pf-tidezeile")!r})')
    pg.click('.pf-tidezeile'); pg.wait_for_timeout(600)
    tb = pg.locator('#pf-tide-start').bounding_box()
    check(pg.locator('.pf-zeile').count() == 13 and tb['y'] >= -2 and tb['y'] < hh, f'{tag}: Tide-Zeile klappt die Liste auf und scrollt zu den Tidepegeln')
    check('Hamburg St. Pauli' in pg.inner_text('#pf-tide-start'), f'{tag}: Namen schön geschrieben („St. Pauli“)')
    texte = [t for t in pg.locator('.pf-zeile').all_inner_texts()]
    check(len(texte) == 13 and 'Tide' in texte[10] and 'km 623,1 · Tide' in texte[10] and texte[12].startswith('Elbe Ohne Km'), f'{tag}: alle Pegel, Tide markiert, ohne km am Ende')
    pg.wait_for_function("[...document.querySelectorAll('.pf-zeile')].some(z => / HW \\d\\d:\\d\\d/.test(z.textContent))", timeout=5000)
    texte = [t for t in pg.locator('.pf-zeile').all_inner_texts()]
    check(re.search(r'km 727 · HW \d\d:\d\d', texte[11]) and 'km 623,1 · Tide' in texte[10], f'{tag}: Tidepegel mit BSH-Ort „HW 14:32“ statt „Tide“ ({texte[11]!r})')
    check(len([c for c in calls if '/api/gezeiten' in c and 'pegel=' in c and U(20) in c]) == 0, f'{tag}: nur Pegel mit BSH-Ort werden abgefragt')
    pg.wait_for_function("document.querySelector('.pf-tide-hw')", timeout=5000)
    check(re.search(r'· HW Cuxhaven \d\d:\d\d', pg.inner_text('.pf-tidezeile')), f'{tag}: Tide-Zeile mit nächstem HW ({pg.inner_text(".pf-tidezeile")!r})')
    neu = [c for c in calls[len(calls) - 50:] if 'measurements' in c]
    check(len([c for c in calls if 'measurements' in c]) - n_mess <= 1, f'{tag}: höchstens eine Abfrage (Tide-Zeile) für die Flussseite')
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
    pg.wait_for_selector('dialog.wxd-pegel[open] .pd-name')
    check(pg.url.endswith('#pegel/fluss/elbe') and 'Dresden' in pg.inner_text('dialog.wxd-pegel .pd-name'), f'{tag}: Punkt öffnet die Pegel-Details im Fenster')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(pg.url.endswith('#pegel/fluss/elbe') and pg.locator('.pf-titel').is_visible(), f'{tag}: Esc schließt das Fenster → Flussseite')
    pg.locator('.pf-zeile').nth(0).click(); pg.wait_for_selector('dialog.wxd-pegel[open] .pd-name')
    check('Schöna' in pg.inner_text('dialog.wxd-pegel .pd-name'), f'{tag}: Zeile öffnet die Pegel-Details im Fenster')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.click('.pf-zurueck'); pg.wait_for_selector('.fk')
    check(pg.url.endswith('#pegel'), f'{tag}: Zurück-Pfeil → Dashboard')

    # Tidepegel-Detailseite (Cuxhaven)
    pg.goto(uf.BASE + f'#pegel/{U(21)}'); pg.wait_for_selector('.pt-svg', timeout=8000); pg.wait_for_timeout(300)
    kp = ' '.join(pg.inner_text('.pd-kopf').split())
    check('TIDEPEGEL · ELBE · KM 727' in kp.upper() and 'Cuxhaven' in kp and '610' in kp and pg.inner_text('.pd-kopf .pz-tag') == 'Tide' and '↗ auflaufend' in kp,
          f'{tag}: Tidepegel-Kopf mit „Tide“ und „auflaufend“ ({kp!r})')
    check(pg.locator('.pd .ps').count() == 0 and 'Wo steht der Pegel' not in pg.inner_text('.pd'), f'{tag}: keine MNW/MHW-Skala')
    tk = pg.locator('.pt-svg')
    check('jetzt' in (tk.text_content() or '') and 'MThw' in (tk.text_content() or '') and tk.locator('circle').count() >= 3, f'{tag}: Tidekurve mit „jetzt“, MThw und Hoch-/Niedrigwassern')
    eo = pg.inner_text('.pt-einordnung')
    check('letztes Hochwasser' in eo and 'letztes Niedrigwasser' in eo and re.search(r'Tidehub \d+ cm', eo) and 'mittleren Tide' in eo, f'{tag}: Einordnung ({eo!r})')
    check('Häfen in der Nähe' in pg.inner_text('.pd-kacheln') and 'alle Pegel' in pg.inner_text('.pd-kacheln'), f'{tag}: Kacheln Karte und Gewässer')
    check('nicht für die Navigation' in pg.inner_text('.pd-hinweis') and 'BSH' in pg.inner_text('.pd-hinweis'), f'{tag}: Hinweis ohne Gewähr, Quelle BSH')
    # Gezeiten (BSH): nächstes HW/NW, drei weitere als Pillen, Vorhersage gestrichelt in der Kurve
    pg.wait_for_selector('.pt-gezeiten', timeout=5000); pg.wait_for_timeout(200)
    gz = pg.inner_text('.pt-gezeiten')
    check('Nächstes Hochwasser' in gz and 'Nächstes Niedrigwasser' in gz and re.search(r'in 1 Std\. (9|10|11) Min\.', gz) and '718 cm · +0,5 bis +0,75 m zum Mittel' in gz
          and '368 cm (Gezeitenrechnung)' in gz, f'{tag}: Gezeiten-Karte ({gz[:160]!r})')
    check(pg.locator('.pt-gz-pillen li').count() == 3 and 'Vorhersage BSH · Stand' in gz and 'nicht für die Navigation' in gz
          and pg.locator('.pt-gz-quelle a', has_text='CC BY 4.0').count() == 1, f'{tag}: drei weitere Termine, Stand, Lizenz')
    check(pg.locator('.pt-svg .pt-vorhersage').count() == 1 and pg.locator('.pt-svg .pt-zukunft').count() == 1 and pg.locator('.pt-svg .pt-vh-punkt').count() >= 1
          and '12 h Vorhersage' in pg.inner_text('.pt-kurve + .pt-achse, .pd-karte-kopf >> nth=1') + pg.inner_text('.pd-body'), f'{tag}: Vorhersage gestrichelt in der Tidekurve')
    gb, kb = pg.locator('.pt-gezeiten').bounding_box(), pg.locator('.pt-kurve').bounding_box()
    check(gb['y'] < kb['y'] and gb['x'] + gb['width'] <= w + 1, f'{tag}: Gezeiten-Karte über der Tidekurve, passt in die Breite')
    if w <= 400:
        k = pg.locator('.pt-gz-kachel').all()
        check(len(k) == 2 and abs(k[0].bounding_box()['y'] - k[1].bounding_box()['y']) < 2, f'{tag}: HW und NW nebeneinander')
    pg.screenshot(path=str(SHOTS / f'fluss_{w}_4tide.png'), full_page=True)
    # offline: letzte Vorhersage mit „Stand von … (offline)“
    bsh['aus'] = True
    pg.reload(); pg.wait_for_selector('.pt-gezeiten', timeout=5000)
    check('(offline)' in pg.inner_text('.pt-gezeiten') and 'Stand von' in pg.inner_text('.pt-gezeiten'), f'{tag}: offline letzte Vorhersage mit „Stand von …“')
    pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('watermap.gezeiten.')).forEach(k => localStorage.removeItem(k))")
    pg.reload(); pg.wait_for_selector('.pt-svg', timeout=8000); pg.wait_for_timeout(500)
    check(pg.locator('.pt-gezeiten').count() == 0 and pg.locator('.pt-vorhersage').count() == 0 and '24 h gemessen' in pg.inner_text('.pd-body'), f'{tag}: BSH nicht erreichbar → nur Messwerte')
    bsh['aus'] = False
    pg.locator('.pd-kachel', has_text='alle Pegel').click(); pg.wait_for_selector('.pf-titel')
    check(pg.url.endswith('#pegel/fluss/elbe'), f'{tag}: Kachel „Elbe – alle Pegel“ öffnet die Flussseite')
    # Meine Pegel: Tidepegel-Karte mit auf-/ablaufend und letzten HW/NW statt Skala
    pg.evaluate(f"localStorage.setItem('watermap.meinePegel', JSON.stringify(['{U(21)}']))")
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pm-karte .pm-tide'); pg.wait_for_timeout(400)
    karte = pg.locator('.pm-karte').first
    pg.wait_for_function("document.querySelector('.pm-tide')?.textContent.includes('nächstes')", timeout=5000)
    check('auflaufend' in karte.inner_text() and re.search(r'nächstes HW (morgen )?\d\d:\d\d · NW (morgen )?\d\d:\d\d', karte.inner_text()) and karte.locator('.ps').count() == 0, f'{tag}: „Meine Pegel“-Karte eines Tidepegels mit nächstem HW/NW ({karte.inner_text()!r})')
    pg.evaluate("localStorage.removeItem('watermap.meinePegel')")

    # Küste und Kanal: ohne Profil, nur Liste
    pg.click('.fk:has-text("Küste")'); pg.wait_for_selector('.pf-titel')
    check(pg.url.endswith('#pegel/fluss/kueste') and pg.locator('.pf-svg').count() == 0 and pg.locator('.pf-zeile').count() == 3 and 'Tide' in pg.inner_text('.pf-kopf'), f'{tag}: Küste ohne Profil, Liste der Küstenpegel')
    pg.go_back(); pg.wait_for_selector('.fk')
    if pg.locator('.fk-ohne').count() == 0: pg.click('.pg-fl-alle'); pg.wait_for_timeout(150)
    pg.click('.fk-ohne-zeile:not(.fk-wz)'); pg.wait_for_selector('.pf-titel')
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
    # Prüfliste
    pg.goto(uf.BASE + 'pruefung.html'); pg.wait_for_selector('h2')
    pt = pg.inner_text('body')
    check('Tidepegel mit BSH-Vorhersage (1)' in pt and 'Elbe: Cuxhaven' in pt and 'BSH-Orte ohne PEGELONLINE-Pegel (1)' in pt and 'helgoland | Helgoland | Nr. 9510070' in pt, f'{tag}: Prüfliste mit BSH-Zuordnung')
    check('Reihenfolge Elbe' in pt and '1. Schöna (km 2)' in pt and 'Hamburg St. Pauli (km 623,1) · Tide' in pt and 'Erkannte Tidepegel (3)' in pt and 'Mittellandkanal (2)' in pt,
          f'{tag}: Prüfliste mit Reihenfolge, Tidepegeln und Gewässern ohne Bewertung')
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
