"""UI-Test Bereich „Pegel“ (Dashboard, Detailseite, Pegel auf der Karte) mit nachgebildetem PEGELONLINE und den Daten aus ui_full.py.
Start: python3 tests/ui_pegel_dashboard.py [screenshots-ordner]"""
import datetime as dt, importlib.util, json, math, pathlib, re, sys, tempfile
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = dt.datetime.now(dt.timezone.utc)
iso = lambda t: t.isoformat()

def station(uuid, name, water, km, lat, lon, value, state='normal', hsw='normal', trend=0, refs=None, age_h=0):
    return {'uuid': uuid, 'number': uuid[:6], 'shortname': name, 'longname': name, 'km': km, 'agency': 'WSA TEST',
            'longitude': lon, 'latitude': lat, 'water': {'shortname': water, 'longname': water},
            'timeseries': [{'shortname': 'W', 'longname': 'WASSERSTAND ROHDATEN', 'unit': 'cm', 'equidistance': 15,
                            'currentMeasurement': {'timestamp': iso(NOW - dt.timedelta(hours=age_h)), 'value': value, 'trend': trend,
                                                   'stateMnwMhw': state, 'stateNswHsw': hsw},
                            'characteristicValues': [{'shortname': k, 'unit': 'cm', 'value': v} for k, v in (refs or {}).items()]}]}

R = {'MNW': 98, 'MW': 210, 'MHW': 480, 'HSW': 590}
U = lambda n: f'{n:08d}-0000-4000-8000-000000000000'
STATIONS = [
    station(U(1), 'VLOTHO', 'WESER', 201.4, 52.17, 8.86, 182, trend=-1, refs=R),
    station(U(2), 'MINDEN', 'WESER', 204.5, 52.29, 8.92, 96, state='low', refs=R),
    station(U(3), 'PORTA', 'WESER', 198.2, 52.24, 8.92, 205, refs=R),
    station(U(4), 'HANN. MÜNDEN', 'WESER', 0.1, 51.42, 9.65, 150, refs=R),
    station(U(5), 'TRIER', 'MOSEL', 195.8, 49.76, 6.63, 640, state='high', hsw='high', trend=1, refs=R),
    station(U(6), 'COCHEM', 'MOSEL', 51.6, 50.15, 7.17, 500, state='high', trend=1, refs=R),
    station(U(7), 'KAUB', 'RHEIN', 546.3, 50.09, 7.76, 72, state='low', trend=-1, refs=R),
    station(U(8), 'KÖLN', 'RHEIN', 688.0, 50.94, 6.96, 312, refs=R),
    station(U(9), 'TESTPEGEL', 'TEST-SEE', 1.0, 51.0, 6.5, 120, state='unknown'),                      # ohne Kennwerte
    station(U(10), 'ALTPEGEL', 'RHEIN', 700.0, 51.0, 6.8, 300, refs=R, age_h=30),                    # veraltet
    station(U(11), 'HAMELN', 'WESER', 135.0, 52.10, 9.36, 300, state='unknown', refs=R),            # selbst eingeordnet: normal
    station(U(12), 'NIENBURG', 'WESER', 268.0, 52.64, 9.21, 250, state='unknown'),                  # ohne Kennwerte, nicht im Band
]
BY_ID = {s['uuid']: s for s in STATIONS}
api = {'fail': False, 'calls': []}

def measurements(uuid):
    cur = BY_ID[uuid]['timeseries'][0]['currentMeasurement']['value']
    start = NOW - dt.timedelta(days=7)
    return [{'timestamp': iso(start + dt.timedelta(minutes=15 * i)), 'value': round(cur + 23 * (1 - i / 672) + 4 * math.sin(i / 30), 1)} for i in range(673)]

def handler(route):
    u = urlparse(route.request.url); rest = u.path.split('/api/pegel/', 1)[1]
    api['calls'].append(rest)
    if api['fail']: return route.fulfill(status=502, body='Bad Gateway')
    if rest == 'stations.json': return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and m.group(1) in BY_ID: return route.fulfill(status=200, content_type='application/json', body=json.dumps(measurements(m.group(1))))
    return route.fulfill(status=404, body='[]')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile, init=''):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    ctx.route('**/api/pegel/**', handler)
    ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": []}'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); " + init + " } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.errs = errs
    return ctx, pg

def run(b, w, hh, mobile):
    tag = f'{w}px'
    print(f'--- {tag}')
    nav = '#bottomnav' if mobile else '#topnav'
    # Pegel der Pegel-Ampel wird einmalig übernommen
    ctx, pg = page(b, w, hh, mobile, init="if (!localStorage.getItem('watermap.ampel')) localStorage.setItem('watermap.ampel', JSON.stringify({ pegel: '%s', min: 150 }));" % U(1))
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip')
    check(pg.get_attribute(f'{nav} [data-nav=pegel]', 'href') == './#pegel' and pg.inner_text(f'{nav} [data-nav=pegel]').strip().startswith('Pegel')
          and 'Ampel' not in pg.inner_text(f'{nav} [data-nav=pegel]'), f'{tag}: Tab „Pegel“ führt ins Dashboard')
    pg.click(f'{nav} [data-nav=pegel]'); pg.wait_for_selector('.pg-titel')
    check(pg.url.endswith('#pegel') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Adresse #pegel, „Pegel“ aktiv')
    check(pg.locator('.shell').is_hidden() and pg.locator('.toolbar').is_hidden(), f'{tag}: Karte und Kategorien ausgeblendet')
    pg.wait_for_selector('.pm-karte')
    check(re.search(r'Stand \d\d:\d\d · alle 15 Min\. aktualisiert', pg.inner_text('.pg-stand')) is not None, f'{tag}: Stand mit Uhrzeit')
    z = {k: pg.inner_text(f'.pg-zaehler.is-{k} strong') for k in ['hsw', 'high', 'low', 'normal']}
    check(z == {'hsw': '1', 'high': '1', 'low': '2', 'normal': '5'}, f'{tag}: Lage heute ({z})')
    check(pg.locator('.pg-zaehler.is-normal').is_visible() != mobile, f'{tag}: „Normal“ nur am Desktop')
    karten = pg.locator('.pg-meine .pm-karte')
    check(karten.count() == 1 and 'Vlotho' in karten.first.inner_text() and 'Meine Pegel' in pg.inner_text('#pg-meine-t'), f'{tag}: Pegel der Pegel-Ampel übernommen')
    k = karten.first
    pg.wait_for_selector('.pm-karte .pm-spark')
    kt = k.inner_text()
    check('182' in kt and 'Normal' in kt and 'Weser · km 201,4' in kt and '↘ fallend' in kt, f'{tag}: Karte mit Wert, Zustand, Gewässer + km, Trend')
    check(re.search(r'−\d+ cm in 24 h', kt) is not None, f'{tag}: Änderung in 24 h aus dem Verlauf ({kt!r})')
    check(k.locator('.ps-labels > span').count() == 4, f'{tag}: Skala mit MNW, MW, MHW, HSW')
    check('Verlauf 7 Tage' in (k.locator('.pm-spark').get_attribute('aria-label') or ''), f'{tag}: Mini-Verlauf mit aria-label')
    hist = [c for c in api['calls'] if 'measurements' in c]
    check(len(hist) == 1, f'{tag}: Verlauf nur für sichtbare Karten geladen ({len(hist)})')
    # Flüsse
    baender = pg.locator('.pg-fluss')
    check(baender.count() == 3 and pg.locator('.pg-fluss', has_text='Test-See').count() == 0, f'{tag}: Flüsse im Überblick ohne Gewässer ohne Daten ({baender.count()})')
    weser = pg.locator('.pg-fluss', has_text='Weser')
    check('1 niedrig' in weser.inner_text() and weser.locator('.pg-band i').count() == 5 and 'Weser: 6 Pegel' in weser.get_attribute('aria-label'), f'{tag}: Band Weser mit Text und aria-label')
    farben = weser.locator('.pg-band i').evaluate_all("l => l.map(e => getComputedStyle(e).backgroundColor)")
    check(farben == ['rgb(108, 191, 132)'] * 4 + ['rgb(250, 178, 25)'], f'{tag}: sortiert nach Flusskilometer, nur eingeordnete Pegel, Farben ({farben})')
    check('keine Daten' not in pg.inner_text('.pg-legende'), f'{tag}: Legende ohne „keine Daten“')
    check('über HSW' in pg.locator('.pg-fluss', has_text='Mosel').inner_text(), f'{tag}: Mosel „1 über HSW“')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_1dashboard.png'), full_page=True)
    # Alle Pegel / Filter
    # Suche steht in der Karte „Alle Pegel“ (nicht im Kopf), am Handy auch bei zugeklappter Liste
    check(pg.locator('.pg-kopf .pg-suche').count() == 0 and pg.locator('.pg-alle .pg-alle-karte .pg-suche').is_visible(), f'{tag}: Suche in „Alle Pegel“ sichtbar')
    pg.fill('.pg-alle .pg-suche', 'mosel'); pg.wait_for_timeout(200)
    names = [n.strip() for n in pg.locator('.pg-tabelle tbody .pg-zeile-btn').all_inner_texts()]
    check(sorted(names) == ['Cochem', 'Trier'] and pg.locator('.pg-tabelle').is_visible(), f'{tag}: Suche öffnet und filtert die Liste ({names})')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_5suche.png'))
    pg.fill('.pg-alle .pg-suche', ''); pg.wait_for_timeout(200)
    if mobile:
        check(pg.locator('.pg-tabelle').is_hidden(), f'{tag}: Liste erst nach „Alle anzeigen“')
        pg.click('.pg-alle .pg-link')
    rows = pg.locator('.pg-tabelle tbody tr')
    check(rows.count() == 12, f'{tag}: alle Pegel in der Liste ({rows.count()})')
    names = [n.strip() for n in pg.locator('.pg-tabelle tbody .pg-zeile-btn').all_inner_texts()]
    check(names[:5] == ['Cochem', 'Trier', 'Kaub', 'Köln', 'Altpegel'] and pg.get_attribute('.pg-sort:has-text("Gewässer")', 'aria-pressed') == 'true',
          f'{tag}: Standard nach Gewässer und km ({names[:5]})')
    pg.click('.pg-zaehler.is-low'); pg.wait_for_timeout(300)
    names = [n.strip() for n in pg.locator('.pg-tabelle tbody .pg-zeile-btn').all_inner_texts()]
    check(sorted(names) == ['Kaub', 'Minden'] and pg.locator('.pg-filter .ftag').get_attribute('aria-label') == 'Filter Niedrigwasser entfernen', f'{tag}: Zähler filtert die Liste ({names})')
    pg.click('.pg-filter .ftag'); pg.wait_for_timeout(200)
    pg.click('.pg-fluss:has-text("Weser")'); pg.wait_for_timeout(300)
    names = [n.strip() for n in pg.locator('.pg-tabelle tbody .pg-zeile-btn').all_inner_texts()]
    check(names == ['Hann. Münden', 'Hameln', 'Porta', 'Vlotho', 'Minden', 'Nienburg'], f'{tag}: Band zeigt das Gewässer, nach km ({names})')
    pg.click('.pg-filter .ftag'); pg.wait_for_timeout(200)
    pg.click('.pg-sort:has-text("Zustand")'); pg.wait_for_timeout(150)
    first = pg.locator('.pg-tabelle tbody .pg-zeile-btn').first.inner_text()
    check(first == 'Trier', f'{tag}: sortiert nach Zustand (über HSW zuerst: {first})')
    check(pg.locator('.pg-tabelle tbody tr', has_text='Testpegel').locator('.pz-tag').inner_text() == 'ohne Kennwerte', f'{tag}: Pegel ohne Kennwerte grau')
    check(pg.locator('.pg-tabelle tbody tr', has_text='Altpegel').locator('.pz-tag').inner_text() == 'veraltet', f'{tag}: veraltete Messung gekennzeichnet')
    tw = pg.locator('.pg-wz.is-ampel'); al = pg.locator('.pg-wz.is-alarm')
    check(tw.get_attribute('href') == f'./pegel-ampel?pegel={U(1)}' and al.get_attribute('href') == f'./pegel-ampel?pegel={U(1)}#am-alarm' and 'per E-Mail' in al.inner_text(),
          f'{tag}: Werkzeuge Pegel-Ampel und Pegel-Alarm mit gewähltem Pegel')
    check('Angaben ohne Gewähr' in pg.inner_text('.pg-fuss'), f'{tag}: Fußnote')
    # Detailseite
    pg.locator('.pg-tabelle .pg-zeile-btn', has_text='Vlotho').click(); pg.wait_for_selector('.pd-name')
    check(pg.url.endswith('#pegel/' + U(1)) and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Detailseite #pegel/<id>, Tab bleibt „Pegel“')
    t = pg.inner_text('.pd')
    check('PEGEL · WESER · KM 201,4' in pg.inner_text('.pd-kicker').upper() and pg.inner_text('.pd-name') == 'Vlotho' and '182' in pg.inner_text('.pd-wert'), f'{tag}: Kopf mit Kicker, Name, Wert')
    check(re.search(r'Gemessen \d\d:\d\d Uhr', t) is not None, f'{tag}: „Gemessen …“')
    check(pg.inner_text('.pd-klartext') == 'Etwas unter Mittelwasser, im normalen Bereich. 84 cm über dem mittleren Niedrigwasser.', f'{tag}: Klartext aus den Kennwerten ({pg.inner_text(".pd-klartext")})')
    check(pg.locator('.pd .ps.is-gross .ps-labels b').all_inner_texts() == ['98', '210', '480', '590'], f'{tag}: große Skala mit Kennwerten')
    pg.wait_for_selector('.pd .gc-line')
    st = pg.locator('.pd-stat strong').all_inner_texts()
    check(len(st) == 3 and st[2].startswith('−'), f'{tag}: Höchster/Tiefster/Änderung ({st})')
    pg.click('.pd-umschalter button:has-text("24 h")'); pg.wait_for_timeout(150)
    check(pg.get_attribute('.pd-umschalter button:has-text("24 h")', 'aria-pressed') == 'true' and pg.locator('.pd .gc-line').count() == 1, f'{tag}: Umschalter 24 h')
    check(pg.get_attribute('.pd-kachel.is-dunkel', 'href') == f'./pegel-ampel?pegel={U(1)}', f'{tag}: „Passt mein Boot?“ mit Pegel')
    check('Kennwerte' in pg.inner_text('.pd-hinweis') and 'nicht auf dein Boot' in pg.inner_text('.pd-hinweis'), f'{tag}: Hinweis amtliche Kennwerte')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_2detail.png'), full_page=True)
    # Stern: Meine Pegel, nicht Favoriten
    pg.click('.pd-kopf .pm-stern'); pg.wait_for_timeout(100)
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [], f'{tag}: Stern entfernt aus „Meine Pegel“')
    pg.click('.pd-kopf .pm-stern'); pg.wait_for_timeout(100)
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(1)] and pg.evaluate("localStorage.getItem('watermap.favorites.v1')") in (None, '[]'), f'{tag}: eigene Liste, nicht bei den Favoriten')
    pg.go_back(); pg.wait_for_selector('.pg-titel')
    check(pg.url.endswith('#pegel'), f'{tag}: Zurück-Taste → Dashboard')
    # Ohne Kennwerte und veraltet
    pg.evaluate(f"location.hash = '#pegel/{U(9)}'"); pg.wait_for_selector('.pd-name:has-text("Testpegel")')
    check(pg.locator('.pd .ps').count() == 0 and 'keine amtlichen Kennwerte' in pg.inner_text('.pd-klartext'), f'{tag}: ohne Kennwerte: keine Skala, Klartext erklärt')
    pg.evaluate(f"location.hash = '#pegel/{U(10)}'"); pg.wait_for_selector('.pd-name:has-text("Altpegel")')
    check(pg.locator('.pd-zeit.is-alt').count() == 1 and 'Veraltet' in pg.inner_text('.pd-zeit'), f'{tag}: veraltete Messung deutlich gekennzeichnet')
    pg.evaluate(f"location.hash = '#pegel/{U(5)}'"); pg.wait_for_selector('.pd-name:has-text("Trier")')
    check(pg.inner_text('.pd .pz-tag') == 'über HSW' and 'über HSW' in pg.inner_text('.pd-klartext'), f'{tag}: über HSW')
    # „Auf der Karte“ → Karte mit Pegel
    pg.evaluate(f"location.hash = '#pegel/{U(1)}'"); pg.wait_for_selector('.pd-name:has-text("Vlotho")')
    pg.click('.pd-kachel:has-text("Auf der Karte")'); pg.wait_for_timeout(600)
    check(pg.url.endswith('#karte/pegel/' + U(1)) and pg.locator(f'{nav} [data-nav=karte]').get_attribute('aria-current') == 'page', f'{tag}: „Auf der Karte“ → #karte/pegel/<id>')
    if mobile:
        pg.wait_for_selector('#peek .gpeek')
        pt = pg.inner_text('#peek')
        check('Vlotho' in pt and '182' in pt and 'Normal' in pt and pg.locator('#peek .pm-stern').count() == 1, f'{tag}: Pegel-Vorschau auf der Karte')
        check(pg.locator('#peek a', has_text='Passt mein Boot?').get_attribute('href') == f'./pegel-ampel?pegel={U(1)}', f'{tag}: Vorschau „Passt mein Boot?“')
        pg.screenshot(path=str(SHOTS / f'pegel_{w}_3vorschau.png'))
        pg.click('#peek button:has-text("Details")'); pg.wait_for_selector('#detail:not([hidden]) .pd')
    else:
        pg.wait_for_selector('#detail:not([hidden]) .pd')
    check(pg.locator('.shell').is_visible() and pg.inner_text('#detail .pd-name') == 'Vlotho', f'{tag}: Details über der Karte (kein Wechsel ins Dashboard)')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_4panel.png'))
    pg.click('#detail .pd-leiste .pd-icon >> nth=0'); pg.wait_for_timeout(200)
    check(pg.locator('#detail').is_hidden() and pg.locator('.shell').is_visible() and not pg.url.endswith('pegel/' + U(1)), f'{tag}: Schließen → zurück zur Karte')
    # Marker-Klick auf der Karte bleibt auf der Karte
    pg.evaluate(f"window.__watermap.selectGauge('{U(2)}')"); pg.wait_for_timeout(300)
    check(pg.locator('.shell').is_visible() and pg.locator('#pegelseite').is_hidden() and pg.url.endswith('#karte/pegel/' + U(2)), f'{tag}: Pegel-Marker bleibt auf der Karte')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Leere Liste: ohne Position Hinweis, mit Position die 3 nächsten
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel.ampel', '1');")
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-meine')
    check(pg.locator('.pg-meine .pm-karte').count() == 0 and 'Pegel hinzufügen“' in pg.inner_text('.pg-meine'), f'{tag}: leer ohne Position: Hinweis')
    pg.evaluate("window.__watermap.state.user = { lat: 52.2, lon: 8.9 }")
    pg.click('.pg-neu'); pg.wait_for_selector('.pg-meine .pm-karte')
    names = [n.strip() for n in pg.locator('.pg-meine .pm-name').all_inner_texts()]
    check(pg.inner_text('#pg-meine-t') == 'Pegel in deiner Nähe' and names == ['Vlotho', 'Porta', 'Minden'] and 'Tippe auf ☆' in pg.inner_text('.pg-meine'), f'{tag}: mit Position die 3 nächsten ({names})')
    # Offline: letzter Stand
    api['fail'] = True
    pg.click('.pg-neu'); pg.wait_for_timeout(500)
    check('Stand von' in pg.inner_text('.pg-stand') and pg.locator('.pg-meine .pm-karte').count() == 3, f'{tag}: offline mit „Stand von …“ und letzten Werten')
    api['fail'] = False
    # „Pegel hinzufügen“: eigenes Fenster statt Sprung zur Suche
    y0 = pg.evaluate('scrollY')
    pg.click('.pg-hinzu'); pg.wait_for_selector('#pa-pop[open]'); pg.wait_for_timeout(200)
    dlg = pg.locator('#pa-pop')
    check(('is-sheet' if mobile else 'is-drop') in dlg.get_attribute('class') and pg.evaluate("document.activeElement.classList.contains('pa-suche')")
          and pg.evaluate('scrollY') == y0, f'{tag}: Fenster öffnet ({"Sheet" if mobile else "Dropdown"}), Fokus im Suchfeld, Seite springt nicht')
    box = dlg.bounding_box()
    check(box['y'] >= 0 and box['y'] + box['height'] <= hh + 1 and box['x'] >= 0 and box['x'] + box['width'] <= w + 1, f'{tag}: Fenster ganz sichtbar ({box})')
    namen = [n.strip() for n in dlg.locator('.pa-text strong').all_inner_texts()]
    check(pg.inner_text('.pa-kopf') == 'In deiner Nähe' and len(namen) == 8 and namen[0] == 'Vlotho', f'{tag}: ohne Suche die nächsten Pegel ({namen[:3]})')
    pg.fill('.pa-suche', 'mosel'); pg.wait_for_timeout(150)
    namen = [n.strip() for n in dlg.locator('.pa-text strong').all_inner_texts()]
    check(pg.inner_text('.pa-kopf') == '2 Treffer' and sorted(namen) == ['Cochem', 'Trier'], f'{tag}: Suche nach Gewässer ({namen})')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_4hinzufuegen.png'))
    knopf = dlg.locator('.pa-zeile', has_text='Trier').locator('.pa-knopf')
    check(knopf.get_attribute('aria-label') == 'Trier zu „Meine Pegel“ hinzufügen', f'{tag}: Knopf „+“ mit aria-label')
    knopf.click(); pg.wait_for_timeout(200)
    check(knopf.get_attribute('aria-pressed') == 'true' and pg.locator('#pa-pop[open]').count() == 1, f'{tag}: hinzugefügt, Fenster bleibt offen')
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(5)], f'{tag}: in „Meine Pegel“ gespeichert')
    pg.click('#pa-pop .pop-foot .btn'); pg.wait_for_timeout(200)
    check(pg.locator('#pa-pop[open]').count() == 0 and [n.strip() for n in pg.locator('.pg-meine .pm-name').all_inner_texts()] == ['Trier'], f'{tag}: „Fertig“ schließt, Karte Trier unter „Meine Pegel“')
    pg.click('.pg-hinzu'); pg.wait_for_selector('#pa-pop[open]'); pg.fill('.pa-suche', 'xyz'); pg.wait_for_timeout(100)
    check(pg.inner_text('.pa-kopf') == 'Kein Pegel gefunden.', f'{tag}: kein Treffer')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(pg.locator('#pa-pop[open]').count() == 0, f'{tag}: Escape schließt')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh, mobile in [(1440, 900, False), (1024, 768, False), (390, 844, True), (375, 667, True)]:
                api['calls'].clear(); run(b, w, hh, mobile)
            b.close()
    finally:
        srv.shutdown()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
