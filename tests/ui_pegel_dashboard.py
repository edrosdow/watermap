"""UI-Test Bereich „Pegel“ als Kartenanwendung (Karte, Suche, Filter, Panel/Bottom Sheet, Cockpit, Favoriten) mit nachgebildetem PEGELONLINE und den Daten aus ui_full.py.
Start: python3 tests/ui_pegel_dashboard.py [screenshots-ordner]"""
import datetime as dt, importlib.util, json, math, pathlib, re, sys, tempfile
from urllib.parse import urlparse, parse_qs
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
    station(U(13), 'VEGESACK', 'WESER', 17.8, 53.17, 8.62, 588, state='unknown'),                   # Unterweser: eigene km ab Bremen
    station(U(14), 'JADE-WESER-PORT', 'JADE', 11.6, 53.59, 8.15, 650, state='unknown'),            # Name enthält „Weser“
    station(U(15), 'CELLE', 'ALLER', 1.74, 52.62, 10.08, 123, refs={'MNW': 117, 'MW': 192, 'HSW': 310, 'MHW': 412}),   # HSW liegt unter MHW
]
BY_ID = {s['uuid']: s for s in STATIONS}
api = {'fail': False, 'calls': [], 'tage': []}

def measurements(uuid, tage=7):
    cur = BY_ID[uuid]['timeseries'][0]['currentMeasurement']['value']
    start = NOW - dt.timedelta(days=tage); n = tage * 96
    pts = [{'timestamp': iso(start + dt.timedelta(minutes=15 * i)), 'value': round(cur + 23 * (1 - i / n) + 4 * math.sin(i / 30), 1)} for i in range(n + 1)]
    if uuid == U(8):   # Köln: Lücke von 6 Stunden vor 2 Tagen
        pts = [p for i, p in enumerate(pts) if not (n - 192 <= i < n - 168)]
    return pts

def handler(route):
    u = urlparse(route.request.url); rest = u.path.split('/api/pegel/', 1)[1]
    api['calls'].append(rest)
    if api['fail']: return route.fulfill(status=502, body='Bad Gateway')
    if rest == 'stations.json': return route.fulfill(status=200, content_type='application/json', body=json.dumps(STATIONS))
    m = re.fullmatch(r'stations/([^/]+)/W/measurements\.json', rest)
    if m and m.group(1) in BY_ID:
        tage = int(re.search(r'start=P(\d+)D', u.query).group(1)) if 'start=P' in u.query else 1
        api['tage'].append(tage)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(measurements(m.group(1), tage)))
    # Zusatzwerte (Stufe 2): nur Kaub liefert Wassertemperatur, Abfluss und Vorhersage
    m = re.fullmatch(r'stations/([^/]+)\.json', rest)
    if m and m.group(1) in BY_ID:
        st = dict(BY_ID[m.group(1)]); ts = list(st['timeseries'])
        if m.group(1) == U(15):   # Celle: Wassertemperatur 0,0 °C, aber 4 Tage alt → darf nicht erscheinen
            ts += [{'shortname': 'WT', 'unit': '°C', 'currentMeasurement': {'timestamp': iso(NOW - dt.timedelta(days=4)), 'value': 0.0}}]
            ts[0] = dict(ts[0], characteristicValues=ts[0]['characteristicValues'] + [{'shortname': 'NNW', 'longname': 'Niedrigster Niedrigwasserstand', 'unit': 'cm', 'value': 50, 'occurrences': ['1953-09-09']}])
        if m.group(1) == U(7):
            ts += [{'shortname': 'WT', 'unit': '°C', 'currentMeasurement': {'timestamp': iso(NOW), 'value': 12.5}},
                   {'shortname': 'Q', 'unit': 'm³/s', 'currentMeasurement': {'timestamp': iso(NOW), 'value': 624.0}},
                   {'shortname': 'WV', 'unit': 'cm'}]
        st['timeseries'] = ts
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(st))
    if rest == f'stations/{U(7)}/WT/measurements.json':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'timestamp': iso(NOW - dt.timedelta(hours=h)), 'value': 12.5 - h / 24} for h in range(48, -1, -1)]))
    if rest == f'stations/{U(7)}/WV/measurements.json':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'initialized': iso(NOW), 'timestamp': iso(NOW + dt.timedelta(hours=6 * i)), 'value': 70 - i * 4 / 12, 'type': 'forecast' if i < 8 else 'estimate'} for i in range(1, 13)]))
    return route.fulfill(status=404, body='[]')


alarm_api = {'mail': [], 'push': []}
def alarm_mail_handler(route):
    alarm_api['mail'].append(json.loads(route.request.post_data or '{}'))
    return route.fulfill(status=200, content_type='application/json', body='{"ok": true}')
def alarm_push_handler(route):
    alarm_api['push'].append(route.request.method)
    return route.fulfill(status=503, content_type='application/json', body=json.dumps({'fehler': 'Push ist noch nicht eingerichtet.'}))

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile, init=''):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    ctx.route('**/api/pegel/**', handler)
    ctx.route('**/.netlify/functions/pegel-alarm', alarm_mail_handler)
    ctx.route('**/.netlify/functions/pegel-push', alarm_push_handler)
    ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"aktiv": [], "meldungen": []}'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); " + init + " } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.errs = errs
    return ctx, pg


def touch_wisch(pg, sel, dy):
    """Echtes Wischen (CDP-Touch) auf einem Element: von seiner Mitte um dy Pixel."""
    bb = pg.locator(sel).bounding_box(); x = bb['x'] + bb['width'] / 2; y = bb['y'] + min(bb['height'] / 2, 12)
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 6): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + dy * i / 5}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    pg.wait_for_timeout(250)

def warte(pg, js, timeout=5000):
    """Wartet, bis der Ausdruck wahr ist (die CSP der App verbietet wait_for_function mit Text)."""
    for _ in range(timeout // 50):
        if pg.evaluate(f'() => !!({js})'): return True
        pg.wait_for_timeout(50)
    raise AssertionError('Zeitüberschreitung: ' + js)

def suche_waehlen(pg, text, option_text):
    pg.fill('#pa-suche', text); pg.wait_for_selector('#pa-treffer:not([hidden])')
    pg.locator('#pa-treffer [role=option]', has_text=option_text).first.click(); pg.wait_for_timeout(200)

def run(b, w, hh, mobile):
    tag = f'{w}px'
    print(f'--- {tag}')
    nav = '#bottomnav' if mobile else '#topnav'
    shot = lambda pg, name: pg.screenshot(path=str(SHOTS / f'pegel_{w}_{name}.png'))
    # Pegel der Pegel-Ampel wird einmalig als Favorit übernommen (Vlotho)
    ctx, pg = page(b, w, hh, mobile, init="if (!localStorage.getItem('watermap.ampel')) localStorage.setItem('watermap.ampel', JSON.stringify({ pegel: '%s', min: 150 }));" % U(1))
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip')
    pg.click(f'{nav} [data-nav=pegel]'); pg.wait_for_selector('.pa .pk-pille'); pg.wait_for_timeout(300)
    check(pg.url.endswith('#pegel') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Adresse #pegel, „Pegel“ aktiv')
    check(pg.locator('.shell').is_hidden() and pg.locator('.toolbar').is_hidden(), f'{tag}: Hauptkarte und Kategorien ausgeblendet')
    check(pg.inner_text('.pa-h1') == 'Pegelstände' and re.search(r'^Stand \d\d:\d\d · Daten WSV/PEGELONLINE$', pg.inner_text('.pa-stand')) is not None, f'{tag}: Kopf „Pegelstände“ mit Stand ({pg.text_content(".pa-stand")!r})')
    chips = pg.locator('.pa-filter .pa-chip')
    texte = [pg.evaluate('(e) => e.textContent.trim()', chips.nth(i).element_handle()) for i in range(chips.count())]
    check(texte == ['Favoriten1', 'In der Nähe'] and all(chips.nth(i).get_attribute('aria-pressed') == 'false' for i in range(2)), f'{tag}: Chips Favoriten (1) | In der Nähe, nichts offen ({texte})')
    check(pg.locator('.pa-panel').is_hidden(), f'{tag}: Start: kein Panel bzw. Sheet – nur die Karte')
    check(pg.locator('#pa-suche').get_attribute('placeholder') == 'Pegel, Gewässer oder Ort suchen' and pg.locator('#pa-suche').is_visible(), f'{tag}: Suchfeld sichtbar')
    if mobile:
        check(pg.locator('.app-header').is_hidden() and pg.locator('.pa-titelblock').bounding_box()['width'] <= 1, f'{tag}: Handy: kein globaler Kopf, Titel nur für Screenreader')
        kb = pg.locator('.pk-ansicht').bounding_box()
        check(kb['width'] >= w - 1 and kb['height'] >= hh * 0.8, f'{tag}: Handy: Karte voll')
    else:
        kb = pg.locator('.pk-ansicht').bounding_box(); hb = pg.locator('.pa-haupt').bounding_box()
        check(kb['width'] >= hb['width'] - 1, f'{tag}: Desktop ohne Auswahl: Karte volle Breite')
        check(pg.locator('.pk-legende').is_visible() and 'zwischen MNW und MHW' in pg.inner_text('.pk-legende') and 'ohne Kennwerte' in pg.inner_text('.pk-legende'), f'{tag}: Legende mit Kennwert-Begriffen')
    check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{tag}: kein horizontales Scrollen')
    check(pg.locator('.pa .pk-pille.is-gemerkt .pk-stern').count() >= 1, f'{tag}: Favorit am ★ in der Pille erkennbar')
    shot(pg, '1_start')
    # Favoriten nur auf Wunsch
    pg.click('.pa-chip[data-liste=fav]'); pg.wait_for_selector('.pa-liste')
    zeile = pg.locator('.pa-liste .pa-z').first
    check(pg.text_content('#pa-liste-t') == 'Favoriten' and 'Vlotho' in zeile.inner_text() and '182 cm' in zeile.inner_text() and pg.get_attribute('.pa-chip[data-liste=fav]', 'aria-pressed') == 'true',
          f'{tag}: „Favoriten“ öffnet eine kurze Liste ({zeile.inner_text()!r})')
    shot(pg, '1b_favoriten')
    pg.click('.pa-liste-zu'); pg.wait_for_timeout(150)
    check(pg.locator('.pa-panel').is_hidden() and pg.get_attribute('.pa-chip[data-liste=fav]', 'aria-pressed') == 'false', f'{tag}: ✕ schließt die Liste wieder')

    # Marker antippen → Panel zeigt den Pegel
    pg.locator('.pa .leaflet-marker-icon[title^="Pegel Minden,"]').dispatch_event('click'); pg.wait_for_selector('.pa-kurz'); warte(pg, "/\\d/.test(document.querySelector('.pa-zahlen')?.textContent || '')")
    k = pg.inner_text('.pa-kurz').replace('\xa0', ' ')
    trend = pg.inner_text('.pa-trend')
    check(pg.text_content('#pa-name') == 'Minden · Weser' and ' '.join(pg.text_content('.pa-wert').split()) == '96 cm', f'{tag}: Marker → Panel: „Minden · Weser“, 96 cm')
    check(re.fullmatch(r'Niedrig\s*·\s*2 Std\. [+−±]\d+ cm\s*·\s*24 Std\. [+−±]\d+ cm', trend) is not None, f'{tag}: eine Zeile: Zustand · 2 Std. · 24 Std. ({trend!r})')
    check('pa-blau' in pg.get_attribute('.pa-kurz', 'class') and 'linear-gradient' in pg.evaluate("getComputedStyle(document.querySelector('.pa-panel')).backgroundImage"), f'{tag}: Kompakt im Wasserblau')
    check(pg.locator('.pa-kurz .pa-kurve').count() == 1 and pg.inner_text('.pa-verlauf') == 'Details' and pg.locator('.pa-kurz .pa-alarm').is_visible() and len(k) < 80, f'{tag}: Kurve, Glocke, „Details“ – wenig Text ({len(k)} Zeichen)')
    wb, kb2 = pg.locator('.pa-wert').bounding_box(), pg.locator('.pa-kurz .pa-kurve').bounding_box()
    check(kb2['x'] > wb['x'] + wb['width'] - 1 and abs((kb2['y'] + kb2['height'] / 2) - (wb['y'] + wb['height'] / 2)) < 30, f'{tag}: Wert und 24-h-Kurve nebeneinander')
    check(pg.url.endswith(f'#pegel/{U(2)}') and pg.locator('.pk-pille.is-gewaehlt').count() == 1 and 'Minden' not in pg.locator('.pk-pille.is-gewaehlt').inner_text() and ' '.join(pg.locator('.pk-pille.is-gewaehlt .pk-zahl').text_content().split()) == '96 cm',
          f'{tag}: Adresse #pegel/<id>, Marker hervorgehoben')
    if mobile:
        check(pg.locator('.pa-verlauf').is_visible(), f'{tag}: Handy: „Details“ sichtbar')
        mb = pg.locator('.pk-pille.is-gewaehlt').bounding_box(); pb = pg.locator('.pa-panel').bounding_box()
        check(mb and mb['y'] + mb['height'] < pb['y'] and mb['y'] > 100, f'{tag}: gewählter Marker frei über dem Sheet')
    else:
        kb = pg.locator('.pk-ansicht').bounding_box(); hb = pg.locator('.pa-haupt').bounding_box(); pb = pg.locator('.pa-panel').bounding_box()
        anteil = kb['width'] / hb['width']
        check(0.58 <= anteil <= 0.70 and abs(pb['x'] - (kb['x'] + kb['width'])) <= 2, f'{tag}: mit Auswahl: Karte {anteil:.0%}, Panel rechts')
    shot(pg, '2_auswahl')

    # Stern: Minden merken und wieder entfernen
    pg.click('.pa-kurz .pm-stern'); pg.wait_for_timeout(150)
    check(pg.locator('.pa-kurz .pm-stern.is-on').count() == 1 and pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(1), U(2)]
          and pg.evaluate("document.activeElement?.classList.contains('pm-stern')") and pg.locator('.pk-pille.is-gewaehlt .pk-stern').count() == 1, f'{tag}: Stern merkt Minden (Fokus bleibt, Marker mit Stern)')

    # Cockpit
    pg.click('.pa-verlauf'); pg.wait_for_selector('.pa-panel .pd .gc-svg')
    um = pg.locator('.pd-umschalter button')
    check(um.all_inner_texts() == ['24 Std.', '7 Tage', '30 Tage'] and um.nth(1).get_attribute('aria-pressed') == 'true', f'{tag}: Cockpit: Zeitraum 24 h | 7 Tage | 30 Tage')
    check(pg.locator('.pa-panel').get_attribute('class').count('is-gross') == 1 and pg.inner_text('#pd-name') == 'Minden', f'{tag}: Cockpit im Panel (groß)')
    zeilen = [pg.evaluate("(e) => e.querySelector(':scope > summary')?.textContent.trim() ?? e.textContent.trim()", e) for e in pg.locator('.pd-liste > *').element_handles()]
    check(zeilen == ['Passt mein Boot?', 'Als Bild teilen', 'Slipanlagen in der Nähe', 'Station und Quelle'] and pg.locator('.pd-liste details[open]').count() == 0, f'{tag}: Liste unten: {zeilen}')
    kw = pg.inner_text('.pd-kennwerte')
    check('mittl. Niedrigwasser' in kw and '98 cm' in kw and 'Schifffahrtsw.' in kw, f'{tag}: Kennwerte knapp: Kürzel, kurze Bezeichnung, Wert')
    warte(pg, "/\\d/.test(document.querySelector('.pd-tz')?.textContent || '')")
    check(re.fullmatch(r'·\s*2 Std\. [+−±]\d+ cm\s*·\s*24 Std\. [+−±]\d+ cm', pg.inner_text('.pd-tz').strip()) is not None and 'Niedrig' in pg.inner_text('.pd-zeile-kopf'), f'{tag}: Details: Zustand · 2 Std. · 24 Std. ({pg.inner_text(".pd-zeile-kopf")!r})')
    reihe = pg.evaluate("[...document.querySelectorAll('.pd-body > *')].map(e => e.className)")
    check(reihe[0].startswith('pd-karte pd-verlauf') and 'pd-einordnung' in reihe[1] and 'pd-kennwerte' in ' '.join(reihe) and 'pd-liste' in reihe[-1], f'{tag}: Verlauf, Einordnung, Kennwerte, Liste ({reihe})')
    kn = [t.strip() for t in pg.locator('.pd-knoepfe .pd-kb').all_inner_texts()]
    check(kn in (['Alarm', 'Merken', 'Teilen'], ['Alarm', 'Gemerkt', 'Teilen']) and 'linear-gradient' in pg.evaluate("getComputedStyle(document.querySelector('.pa-panel')).backgroundImage"), f'{tag}: drei gleiche Knöpfe, Wasserblau ({kn})')
    check(pg.inner_text('.pd-einordnung .pd-zst') == 'Niedrig' and pg.locator('.pd-zmark').count() == 1 and pg.inner_text('.pd-znamen .is-an') == 'Niedrig', f'{tag}: Einordnung: Zustand groß, Punkt im Bereich Niedrig')
    pg.click('.pd-stamm summary'); pg.wait_for_timeout(100)
    check('nicht die Wassertiefe' in pg.inner_text('.pd-stamm'), f'{tag}: Station und Quelle mit Hinweis Wassertiefe')
    pg.wait_for_timeout(300)
    check(pg.locator('.pd-vorh-info').is_hidden() and pg.locator('.gc-vorh').count() == 0, f'{tag}: ohne Vorhersage kein Vorhersage-Text')
    achse = pg.locator('.pd .gc-axis').all_text_contents()
    check(any(re.fullmatch(r'(Mo|Di|Mi|Do|Fr|Sa|So)', t) for t in achse), f'{tag}: 7 Tage: Wochentage an der Achse')
    um.nth(0).click(); pg.wait_for_timeout(150)
    achse = pg.locator('.pd .gc-axis').all_text_contents()
    check(any(re.fullmatch(r'\d\d:00', t) for t in achse), f'{tag}: 24 h: Uhrzeiten an der Achse')
    vor = len([t for t in api['tage'] if t == 30])
    um.nth(2).click(); warte(pg, "[...document.querySelectorAll('.pd .gc-axis')].some(t => /^\\d\\d\\.\\d\\d\\.$/.test(t.textContent))")
    check(len([t for t in api['tage'] if t == 30]) == vor + 1, f'{tag}: 30 Tage erst auf Wunsch geladen (start=P30D), Datum an der Achse')
    um.nth(1).click(); um.nth(2).click(); pg.wait_for_timeout(150)
    check(len([t for t in api['tage'] if t == 30]) == vor + 1, f'{tag}: 30 Tage zwischengespeichert (keine zweite Anfrage)')
    # Tooltip
    pg.locator('.pd .gc-svg').scroll_into_view_if_needed()
    bb = pg.locator('.pd .gc-svg').bounding_box(); pg.mouse.move(bb['x'] + bb['width'] * 0.4, bb['y'] + bb['height'] * 0.5); pg.mouse.move(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.5, steps=3); pg.wait_for_timeout(100)
    tip = pg.locator('.pd .gc-tip')
    check(tip.is_visible() and re.search(r'\d\d:\d\d · \d+ cm', tip.inner_text()) is not None, f'{tag}: Tooltip mit Zeit und Wert ({tip.inner_text() if tip.is_visible() else ""!r})')
    shot(pg, '3_cockpit')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(pg.locator('.pa-panel .pd').count() == 0 and pg.locator('.pa-kurz').count() == 1, f'{tag}: Esc schließt das Cockpit → kurze Ansicht')

    # Suche: Pegel per Tastatur
    pg.fill('#pa-suche', 'kau'); pg.wait_for_selector('#pa-treffer:not([hidden])')
    check(pg.get_attribute('#pa-suche', 'aria-expanded') == 'true' and 'Kaub' in pg.inner_text('#pa-treffer') and '72 cm' in pg.inner_text('#pa-treffer'), f'{tag}: Suche findet Kaub mit Wert')
    pg.keyboard.press('ArrowDown'); check(pg.get_attribute('#pa-suche', 'aria-activedescendant') == 'pa-t-0', f'{tag}: Pfeiltaste markiert Treffer')
    pg.keyboard.press('Enter'); pg.wait_for_selector('#pa-name:text("Kaub")')
    check(pg.locator('#pa-treffer').is_hidden() and pg.input_value('#pa-suche') == '' and pg.url.endswith(f'#pegel/{U(7)}'), f'{tag}: Enter wählt Kaub, Suche zu')
    pg.click('.pa-verlauf'); pg.wait_for_selector('.pd .gc-vorh')
    check('Vorhersage der WSV bis' in pg.inner_text('.pd-vorh-info') and 'Abschätzung' in pg.inner_text('.pd-vorh-info'), f'{tag}: Vorhersage gestrichelt, Zeitraum genannt')
    pg.wait_for_selector('.pd-zusatz:not([hidden])')
    check('624' in pg.text_content('.pd-zusatz') and 'Abfluss' in pg.text_content('.pd-zusatz'), f'{tag}: Abfluss in m³/s, wenn geliefert')
    pg.click('.pd-kopf .pd-icon >> nth=0'); pg.wait_for_selector('.pa-kurz')
    # Gewässer suchen
    pg.fill('#pa-suche', 'weser'); pg.wait_for_selector('#pa-treffer:not([hidden])')
    check(pg.locator('.pa-t-gewaesser', has_text='Weser').count() == 1 and 'Gewässer · ' in pg.inner_text('.pa-t-gewaesser'), f'{tag}: Suche findet das Gewässer Weser')
    pg.keyboard.press('Escape'); check(pg.locator('#pa-treffer').is_hidden(), f'{tag}: Esc schließt die Trefferliste')
    pg.fill('#pa-suche', 'xyzq'); pg.wait_for_selector('#pa-treffer:not([hidden])')
    check('Nichts gefunden' in pg.inner_text('#pa-treffer'), f'{tag}: Suche ohne Treffer mit Hinweis')
    pg.fill('#pa-suche', '')
    # Köln: Messlücke
    suche_waehlen(pg, 'köln', 'Köln'); pg.click('.pa-verlauf'); pg.wait_for_selector('.pd .gc-svg')
    check(pg.locator('.pd .gc-luecke').count() == 1 and 'Lücke in den Messwerten' in pg.inner_text('.pd-verlauf'), f'{tag}: Messlücke schraffiert und benannt')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    # veralteter Pegel
    suche_waehlen(pg, 'altpegel', 'Altpegel'); pg.wait_for_timeout(300)
    check('Veraltet' in pg.inner_text('.pa-zeit.is-alt') and pg.locator('.pa-zustand').count() == 0 and pg.inner_text('.pa-trend') == '', f'{tag}: veralteter Messwert gekennzeichnet, ohne Einordnung und Trend')
    # ohne Kennwerte: neutral
    suche_waehlen(pg, 'testpegel', 'Testpegel'); pg.wait_for_timeout(300)
    farbe = pg.evaluate("getComputedStyle(document.querySelector('.pk-pille.is-gewaehlt')).getPropertyValue('--pk').trim()")
    check(pg.inner_text('.pa-zustand') == 'ohne Kennwerte' and farbe.lower() == '#8e9eaa', f'{tag}: Pegel ohne Kennwerte: neutraler Marker, Zustand „ohne Kennwerte“ ({farbe})')
    pg.click('.pa-verlauf'); pg.wait_for_selector('.pd .gc-svg')
    check(pg.locator('.pd-kennwerte').count() == 0 and pg.locator('.pd-zonen').count() == 0, f'{tag}: ohne Kennwerte keine Kennwerte-Karte und kein Balken')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(pg.locator('.pa-kurz').count() == 0 and pg.url.endswith('#pegel') and pg.locator('.pk-pille.is-gewaehlt').count() == 0, f'{tag}: Esc schließt die Auswahl (#pegel)')

    # Celle: Skala nach Zahlenwerten (HSW unter MHW), veraltete Wassertemperatur 0 °C wird nicht gezeigt
    suche_waehlen(pg, 'celle', 'Celle'); pg.click('.pa-verlauf'); pg.wait_for_selector('.pd .pd-zonen'); pg.wait_for_timeout(400)
    check(pg.inner_text('.pd-zst') == 'Normal' and pg.inner_text('.pd-znamen .is-an') == 'Normal' and 'MNW 117' in pg.inner_text('.pd-zgrenzen') and 'MHW 412' in pg.inner_text('.pd-zgrenzen')
          and 'cm unter' not in pg.inner_text('.pd-einordnung') and 'Kennwerten dieses Pegels' not in pg.inner_text('.pd-einordnung'), f'{tag}: Einordnung ohne Abstands- und Zusatztext')
    check(pg.locator('.pd-zusatz').is_hidden() and '°C' not in pg.inner_text('.pa-panel .pd'), f'{tag}: veraltete Wassertemperatur (0,0 °C vom Vortag) wird nicht gezeigt')
    pg.locator('.pd-einordnung').scroll_into_view_if_needed(); shot(pg, '5_celle_einordnung')
    pg.wait_for_timeout(200)
    kwz = pg.inner_text('.pd-kwl')
    check('NNW' in kwz and 'niedrigster' in kwz and kwz.index('NNW') < kwz.index('MNW') < kwz.index('HSW') < kwz.index('MHW'), f'{tag}: Kennwerte nach Wert (HSW unter MHW), kurze Namen')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)

    # Listen auf Wunsch
    pg.click('.pa-chip[data-liste=fav]'); pg.wait_for_timeout(200)
    check(pg.locator('.pa-liste .pa-z').count() == 2 and pg.locator('.pa .leaflet-marker-icon').count() >= 2, f'{tag}: Favoriten: zwei Pegel in der Liste, Karte zeigt weiter alle')
    pg.click('.pa-chip[data-liste=naehe]'); pg.wait_for_timeout(200)
    n = pg.locator('.pa-liste .pa-z').count()
    check(pg.text_content('#pa-liste-t') == 'In der Nähe' and n >= 2 and pg.get_attribute('.pa-chip[data-liste=fav]', 'aria-pressed') == 'false', f'{tag}: In der Nähe: Pegel im Ausschnitt ({n})')
    pg.locator('.pa-liste .pa-z-knopf').first.click(); pg.wait_for_selector('.pa-kurz')
    check(pg.locator('.pk-pille.is-gewaehlt').count() == 1 and pg.locator('.pa-liste').count() == 0, f'{tag}: Tippen in der Liste wählt den Pegel, Liste zu')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(pg.locator('.pa-panel').is_hidden(), f'{tag}: Esc: Panel wieder weg')
    # Favorit wieder entfernen (Stern beim Pegel)
    suche_waehlen(pg, 'minden', 'Minden'); pg.click('.pa-kurz .pm-stern'); pg.wait_for_timeout(150)
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(1)], f'{tag}: Stern entfernt den Favoriten')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)

    if mobile:
        suche_waehlen(pg, 'trier', 'Trier')
        pg.click('.pa-griff'); pg.wait_for_timeout(200)
        check('is-gross' in pg.get_attribute('.pa-panel', 'class') and pg.locator('.pa-panel .pd').count() == 1 and pg.get_attribute('.pa-griff', 'aria-expanded') == 'true', f'{tag}: Griff antippen vergrößert das Sheet (Cockpit)')
        touch_wisch(pg, '.pa-griff', 140)
        check('is-gross' not in pg.get_attribute('.pa-panel', 'class') and pg.locator('.pa-kurz').count() == 1, f'{tag}: nach unten wischen verkleinert')
        touch_wisch(pg, '.pa-k-kopf', -120)
        pb = pg.locator('.pa-panel').bounding_box()
        check('is-gross' in pg.get_attribute('.pa-panel', 'class') and 'is-voll' not in pg.get_attribute('.pa-panel', 'class') and 0.12 * hh < pb['y'] < 0.25 * hh,
              f'{tag}: nach oben wischen: Stufe 2 (ca. 80 %, oben bei {pb["y"]:.0f} px)')
        check(abs(pb['y'] + pb['height'] - hh) <= 1, f'{tag}: Stufe 2 reicht bis unten')
        anfragen = len(api['calls'])
        touch_wisch(pg, '.pa-griff', -120)
        pb = pg.locator('.pa-panel').bounding_box()
        check('is-voll' in pg.get_attribute('.pa-panel', 'class') and pb['y'] < 60 and pg.evaluate("document.querySelector('.pa-inhalt').scrollHeight > document.querySelector('.pa-inhalt').clientHeight"), f'{tag}: weiter hochwischen: Stufe 3 (ganz, scrollbar)')
        check(len(api['calls']) == anfragen, f'{tag}: Stufenwechsel ohne neue Anfragen')
        pb = pg.locator('.pa-panel').bounding_box()
        check(abs(pb['y'] + pb['height'] - hh) <= 1, f'{tag}: Stufe 3 reicht bis unten ({pb["y"] + pb["height"]:.0f} von {hh})')
        pg.evaluate("document.querySelector('.pa-inhalt').scrollTop = 1e6"); pg.wait_for_timeout(500)
        letzte = pg.evaluate("(() => { const i = document.querySelector('.pa-inhalt'); i.scrollTop = i.scrollHeight; return Math.max(...[...i.querySelectorAll('*')].filter(e => !e.closest('details:not([open])') || e.closest('summary')).map(e => e.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom)); })()")   # Inhalt eingeklappter Bereiche zählt nicht
        nav_y = pg.locator('#bottomnav').bounding_box()['y']
        check(letzte <= nav_y + 1, f'{tag}: Stufe 3: letzter Inhalt über der Navigation ({letzte:.0f} ≤ {nav_y:.0f})')
        pg.evaluate("document.querySelector('.pa-inhalt').scrollTop = 0"); pg.wait_for_timeout(100)
        touch_wisch(pg, '.pa-griff', 140)
        check('is-voll' not in pg.get_attribute('.pa-panel', 'class') and 'is-gross' in pg.get_attribute('.pa-panel', 'class'), f'{tag}: runterwischen: zurück auf Stufe 2')
        pg.evaluate("document.querySelector('.pa-inhalt').scrollTop = 200"); pg.wait_for_timeout(150)
        check('is-voll' in pg.get_attribute('.pa-panel', 'class'), f'{tag}: Scrollen in Stufe 2 öffnet Stufe 3')
        pg.evaluate("document.querySelector('.pa-inhalt').scrollTop = 0"); pg.wait_for_timeout(100)
        touch_wisch(pg, '.pa-griff', 140); touch_wisch(pg, '.pa-griff', 140); touch_wisch(pg, '.pa-griff', 140)
        check(pg.locator('.pa-kurz').count() == 0 and pg.url.endswith('#pegel') and pg.locator('.pa-panel').is_hidden(), f'{tag}: weiter nach unten wischen schließt die Auswahl')
        pg.click('.pa-chip[data-liste=fav]'); pg.wait_for_selector('.pa-liste')
        touch_wisch(pg, '.pa-griff', 140)
        check(pg.locator('.pa-panel').is_hidden(), f'{tag}: Liste: nach unten wischen schließt')

    # Wechsel zu anderen Bereichen und zurück
    pg.click(f'{nav} [data-nav=karte]'); pg.wait_for_timeout(300)
    check(pg.locator('#pegelseite').is_hidden() and pg.locator('.shell').is_visible(), f'{tag}: Wechsel zur Karte: Pegelseite aus, Hauptkarte da')
    pg.click(f'{nav} [data-nav=pegel]'); pg.wait_for_selector('.pa .pk-pille')
    check(pg.locator('.pa').count() == 1 and pg.locator('.pk-karte').count() == 1, f'{tag}: zurück: dieselbe Pegelkarte (keine zweite)')
    # Direktlink
    pg.goto(uf.BASE + f'#pegel/{U(5)}'); pg.wait_for_selector('#pa-name:text("Trier")')
    check('Über HSW' in pg.inner_text('.pa-zustand') and pg.locator('.pk-pille.is-gewaehlt').count() == 1, f'{tag}: Direktlink #pegel/<id> wählt Trier')
    # Offline: letzter Stand
    api['fail'] = True
    pg.evaluate("document.querySelector('.pa-neu').click()"); warte(pg, "document.querySelector('.pa-stand').textContent.includes('Offline')")
    check('Offline · Stand von' in pg.text_content('.pa-stand') and pg.locator('.pk-pille').count() > 0, f'{tag}: offline: letzter Stand mit Hinweis, Karte bleibt')
    api['fail'] = False
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Keine Favoriten: freundlicher Hinweis
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel.ampel', '1');")
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pa .pk-pille')
    pg.click('.pa-chip[data-liste=fav]'); pg.wait_for_selector('.pa-leer-text')
    check('Noch keine Favoriten' in pg.inner_text('.pa-leer-text'), f'{tag}: ohne Favoriten: kurzer Hinweis')
    shot(pg, '4_leer')
    check(not pg.errs, f'{tag}: keine JS-Fehler (leer) {pg.errs[:3]}')
    ctx.close()

    # API nicht erreichbar, kein gespeicherter Stand
    api['fail'] = True
    ctx, pg = page(b, w, hh, mobile)
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pa-fehler')
    check('nicht erreichbar' in pg.inner_text('.pa-fehler') and pg.locator('.pa-nochmal').is_visible(), f'{tag}: API-Fehler: Hinweis und „Erneut versuchen“')
    api['fail'] = False
    pg.click('.pa-nochmal'); pg.wait_for_selector('.pa .pk-pille')
    check(pg.locator('.pa-fehler').count() == 0, f'{tag}: „Erneut versuchen“ lädt die Pegel')
    errs = [e for e in pg.errs if '502' not in e]
    check(not errs, f'{tag}: keine JS-Fehler (Fehlerfall) {errs[:3]}')
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
