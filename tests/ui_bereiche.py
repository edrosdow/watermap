"""UI-Test der Hauptnavigation (Karte · Pegel · Melden · Meldungen · Mehr), der Übersicht „Aktuelle Meldungen“ (#meldungen),
des Bereichs „Mehr“ (#mehr) und der Merkliste (#mehr/merkliste) – mit nachgebildeter API und den Daten aus ui_full.py.
Start: python3 tests/ui_bereiche.py [screenshots-ordner]"""
import datetime as dt, importlib.util, json, pathlib, re, tempfile, time, urllib.parse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = int(time.time() * 1000)
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

# Pegel (für „Meine Pegel“ in der Merkliste)
G = '00000001-0000-4000-8000-000000000000'
STATION = {'uuid': G, 'number': '1', 'shortname': 'VLOTHO', 'longname': 'VLOTHO', 'km': 201.4, 'agency': 'X', 'longitude': 8.86, 'latitude': 52.17,
           'water': {'shortname': 'WESER', 'longname': 'WESER'},
           'timeseries': [{'shortname': 'W', 'unit': 'cm', 'currentMeasurement': {'timestamp': dt.datetime.now(dt.timezone.utc).isoformat(), 'value': 96, 'stateMnwMhw': 'low', 'stateNswHsw': 'normal'},
                           'characteristicValues': [{'shortname': 'MNW', 'unit': 'cm', 'value': 100}, {'shortname': 'MHW', 'unit': 'cm', 'value': 400}]}]}

def api(st):
    def handler(route):
        r = route.request; u = r.url
        if st['down']: return route.abort()
        if r.method == 'GET' and u.endswith('/api/meldungen/liste'):
            st['liste'] += 1
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'meldungen': sorted(st['M'], key=lambda m: -m['erstelltAm']), 'zeit': NOW}))
        if r.method == 'GET' and u.endswith('/api/meldungen/aktiv'):
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'aktiv': [], 'zeit': NOW}))
        if r.method == 'GET':
            sid = u.split('standort=')[1].replace('%2F', '/')
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'meldungen': [m for m in st['M'] if m['standortId'] == sid], 'zeit': NOW}))
        if '/bestaetigen' in u:
            mid = u.split('/api/meldungen/')[1].split('/')[0]; body = json.loads(r.post_data or '{}')
            st['votes'].append((mid, body.get('stimmt')))
            m = next(m for m in st['M'] if m['id'] == mid); m['bestaetigt' if body['stimmt'] else 'widersprochen'] += 1
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'standortId': m['standortId'], 'meldungen': [x for x in st['M'] if x['standortId'] == m['standortId']]}))
        return route.fulfill(status=404, body='{}')
    return handler

def page(b, w, hh, mobile):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    st = {'down': False, 'liste': 0, 'votes': [], 'M': [], 'forms': [], 'formfail': False}
    ctx.route('**/api/meldungen**', api(st))
    def formular(route):   # Netlify Forms (POST /)
        r = route.request
        if r.method != 'POST': return route.continue_()
        if st['formfail']: return route.fulfill(status=500, body='')
        st['forms'].append(dict(urllib.parse.parse_qsl(r.post_data or '')))
        return route.fulfill(status=200, body='ok')
    ctx.route(lambda u: u.rstrip('/') == uf.BASE.rstrip('/'), formular)
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps([STATION]) if 'stations.json' in r.request.url else '[]'))
    ctx.route('**/api/gezeiten**', lambda r: r.fulfill(status=404, content_type='application/json', body='{"keinOrt": true}'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.errs = errs; pg.st = st
    return ctx, pg

def run(b, w, hh):
    mobile = w < 768; tag = f'{w}px'; nav = '#bottomnav' if mobile else '#topnav'
    print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(800)
    ids = pg.evaluate("window.__watermap.state.places.filter(p => p.type === 'slip').slice(0, 4).map(p => p.id)")
    pg.st['M'] = [
        {'id': 'aa01', 'standortId': ids[0], 'typ': 'gesperrt', 'notiz': 'Rampe überflutet', 'erstelltAm': NOW - 12 * 60000, 'bestaetigt': 3, 'widersprochen': 0},
        {'id': 'aa02', 'standortId': ids[1], 'typ': 'parkplatz_voll', 'notiz': None, 'erstelltAm': NOW - 3 * 60000, 'bestaetigt': 0, 'widersprochen': 0},
        {'id': 'aa03', 'standortId': ids[2], 'typ': 'alles_frei', 'notiz': None, 'erstelltAm': NOW - 40 * 60000, 'bestaetigt': 1, 'widersprochen': 0},
        {'id': 'aa04', 'standortId': ids[3], 'typ': 'warteschlange', 'notiz': 'ca. 20 min', 'erstelltAm': NOW - 70 * 60000, 'bestaetigt': 0, 'widersprochen': 0},
    ]
    pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(800)   # die „neu“-Zahl lädt die Meldungen schon beim Start
    # Navigation (Handy: nur Symbole, Beschriftung als aria-label; „Meldungen“ trägt die Zahl der neuen Meldungen)
    texte = [t.strip() for t in pg.locator(f'{nav} [data-nav]').all_inner_texts()] if not mobile else [re.sub(r', \d+ neu$', '', a) for a in pg.locator(f'{nav} [data-nav]').evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")]
    check(texte == (['Karte', 'Pegel', 'Melden', 'Meldungen', 'Mehr'] if mobile else ['Karte', 'Pegel', 'Meldungen', 'Mehr']), f'{tag}: Navigation {texte}')
    if mobile:
        bn = pg.locator('#bottomnav').bounding_box()
        check(abs(bn['y'] + bn['height'] - (hh - 28)) <= 1 and abs(bn['x'] - 16) <= 1 and abs(bn['x'] + bn['width'] - (w - 16)) <= 1 and abs(bn['height'] - 68) <= 1, f'{tag}: Leiste schwebt (16 px seitlich, 28 px unten, 68 px hoch) ({bn})')
        check(all(pg.locator(f'#bottomnav .bn-item >> nth={i}').bounding_box()['width'] >= 44 and pg.locator(f'#bottomnav .bn-item >> nth={i}').bounding_box()['height'] >= 56 for i in range(5)), f'{tag}: Ziele ≥ 44 × 56 px')
        nb = pg.locator('#btn-naehe-m').bounding_box()
        check(nb['y'] + nb['height'] <= bn['y'] and nb['x'] >= 0, f'{tag}: „In der Nähe“ auf der Karte über der Leiste')
    else:
        check(pg.locator('#btn-naehe-d').is_visible() and pg.locator('#btn-naehe-m').is_hidden(), f'{tag}: „In der Nähe“ in der Werkzeugleiste')
    check(pg.evaluate('document.documentElement.scrollWidth') <= w, f'{tag}: kein waagerechtes Scrollen')

    # Meldungen
    pg.click(f'{nav} [data-nav=meldungen]'); pg.wait_for_selector('.mu-karte')
    check(pg.url.endswith('#meldungen') and pg.locator(f'{nav} [data-nav=meldungen]').get_attribute('aria-current') == 'page', f'{tag}: #meldungen, „Meldungen“ aktiv')
    kopf = pg.inner_text('.mu-kopf')
    check('Aktuelle Meldungen' in kopf and 'Das berichten Sportbootfahrer aus deinem Revier.' in kopf and '4 aktuelle Meldungen' in kopf, f'{tag}: Kopf mit Anzahl')
    typen = [t.strip() for t in pg.locator('.mu-typ').all_inner_texts()]
    check(typen == ['Parkplatz voll', 'Gesperrt', 'Alles frei', 'Warteschlange am Slip'], f'{tag}: neueste zuerst ({typen})')
    karte0 = pg.locator('.mu-karte', has_text='Gesperrt').text_content()
    check(re.search(r'Gemeldet vor 1\d Min\.', karte0) and '3× bestätigt' in karte0 and '„Rampe überflutet“' in karte0, f'{tag}: Karte mit Zeit, Bestätigungen, Notiz')
    check(pg.locator('.mu-karte.vo-stop').count() == 1 and pg.locator('.mu-karte.vo-gut').count() == 1, f'{tag}: Farbton nach Art (gesperrt rot, alles frei grün)')
    pg.select_option('.mu-sort', 'wichtig'); pg.wait_for_timeout(100)
    check(pg.locator('.mu-typ').first.inner_text() == 'Gesperrt', f'{tag}: „Wichtigste zuerst“')
    check(pg.locator('.mu-sort option[value=nah]').count() == 0, f'{tag}: ohne bekannte Position keine Sortierung nach Entfernung')
    pg.click('.mu-chip:has-text("Parkplätze")'); pg.wait_for_timeout(100)
    check(pg.locator('.mu-karte').count() == 1 and pg.locator('.mu-chip.is-an').inner_text().strip() == 'Parkplätze', f'{tag}: Filter Parkplätze')
    pg.click('.mu-chip:has-text("Hindernisse")'); pg.wait_for_timeout(100)
    check(pg.locator('.mu-karte').count() == 0 and 'Für diesen Filter' in pg.inner_text('.mu-leer'), f'{tag}: leerer Filter mit Hinweis')
    pg.click('.mu-leer .bs-link'); pg.wait_for_timeout(100)
    check(pg.locator('.mu-karte').count() == 4, f'{tag}: „Alle Meldungen zeigen“')
    pg.click('.mu-seg button:has-text("Kartenausschnitt")'); pg.wait_for_timeout(100)
    n_aus = pg.locator('.mu-karte').count()
    check(0 <= n_aus <= 4 and pg.locator('.mu-seg button.is-an').inner_text() == 'Kartenausschnitt', f'{tag}: Kartenausschnitt ({n_aus} von 4)')
    pg.click('.mu-seg button:has-text("Überall")'); pg.wait_for_timeout(100)
    pg.screenshot(path=str(SHOTS / f'bereiche_{w}_1meldungen.png'))
    # Bewerten
    k = pg.locator('.mu-karte', has_text='Gesperrt')
    k.locator('button:has-text("Stimmt noch")').click(); pg.wait_for_timeout(400)
    k = pg.locator('.mu-karte', has_text='Gesperrt')
    check(('aa01', True) in pg.st['votes'] and '4× bestätigt' in k.inner_text() and k.locator('button:has-text("Stimmt noch")').is_disabled(), f'{tag}: „Stimmt noch“ zählt und sperrt erneutes Bewerten')
    # Unpassend melden: nur bei Notiz; Fehler bleibt im Fenster; danach Hinweis an Netlify Forms und Meldung ausgeblendet
    check(pg.locator('.mu-karte', has_text='Parkplatz voll').locator('.vo-unpassend').count() == 0 and pg.locator('.mu-karte .vo-unpassend').count() == 2, f'{tag}: „Unpassend melden“ nur bei Meldungen mit Notiz')
    pg.locator('.mu-karte', has_text='Warteschlange').locator('.vo-unpassend').click(); pg.wait_for_selector('.um-dlg[open]')
    dlg = pg.locator('.um-dlg')
    check('ca. 20 min' in dlg.inner_text() and 'Warteschlange' in dlg.inner_text() and dlg.locator('.um-senden').is_disabled(), f'{tag}: Fenster zeigt die Meldung, Senden erst nach Grund')
    bx = dlg.bounding_box()
    check(bx['x'] >= 0 and bx['x'] + bx['width'] <= w + 1 and bx['y'] + bx['height'] <= hh + 1 and (not mobile or bx['y'] + bx['height'] >= hh - 2), f'{tag}: Fenster passt ({"unten" if mobile else "Mitte"})')
    dlg.locator('.um-grund', has_text='Beleidigend').click()
    pg.st['formfail'] = True; dlg.locator('.um-senden').click(); pg.wait_for_selector('.um-fehler:not([hidden])')
    check(pg.locator('.um-dlg[open]').count() == 1 and pg.locator('.mu-karte').count() == 4, f'{tag}: Senden fehlgeschlagen → Hinweis im Fenster, Meldung bleibt')
    pg.screenshot(path=str(SHOTS / f'bereiche_{w}_4unpassend.png'))
    pg.st['formfail'] = False
    dlg.locator('.um-senden').click(); pg.wait_for_selector('.um-dlg', state='detached'); pg.wait_for_timeout(300)
    f = pg.st['forms'][-1] if pg.st['forms'] else {}
    check(f.get('form-name') == 'fehler-melden' and f.get('art') == 'meldung' and 'Meldung-ID: aa04' in f.get('details', '') and 'Grund: Beleidigend' in f.get('details', '') and f.get('standort_id') == ids[3],
          f'{tag}: Hinweis über „fehler-melden“ mit Meldung-ID und Grund ({f})')
    check(pg.locator('.mu-karte').count() == 3 and pg.locator('.mu-karte', has_text='Warteschlange').count() == 0 and '3 aktuelle Meldungen' in pg.inner_text('.mu-kopf'),
          f'{tag}: Meldung für mich ausgeblendet')
    # Heute vor Ort: Unpassend melden bei Notiz, Weg zur Übersicht
    pg.evaluate(f"window.__watermap.setView('karte'); window.__watermap.selectPlace({ids[0]!r}, {{full: true}})"); pg.wait_for_selector('#detail .vo-alle-link'); pg.wait_for_timeout(300)
    vo = pg.locator('#detail .vo-karte')
    check(vo.locator('.vo-unpassend').count() == 1 and '3 Meldungen im Revier' in vo.inner_text(), f'{tag}: „Heute vor Ort“ mit „Unpassend melden“ und Anzahl im Revier')
    vo.locator('.vo-alle-link').click(); pg.wait_for_selector('#meldungsseite:not([hidden]) .mu-karte')
    check(pg.url.endswith('#meldungen'), f'{tag}: „Alle Meldungen“ öffnet die Übersicht')
    # Standort ansehen
    pg.locator('.mu-karte', has_text='Parkplatz voll').locator('.mu-ort-link').click(); pg.wait_for_selector('#detail:not([hidden])')
    check(f'p={ids[1].replace("/", "%2F")}' in pg.url and pg.locator(f'{nav} [data-nav=karte]').get_attribute('aria-current') == 'page', f'{tag}: „Standort“ öffnet die Slipanlage')
    pg.go_back(); pg.wait_for_selector('#meldungsseite:not([hidden]) .mu-karte')
    check(pg.url.endswith('#meldungen'), f'{tag}: Zurück führt wieder zu den Meldungen')
    # Offline: letzter Stand mit Hinweis, Bewerten gesperrt
    pg.st['down'] = True
    pg.reload(); pg.wait_for_selector('.mu-karte', timeout=10000)
    off = pg.inner_text('#meldungsseite')
    check('Offline – letzter gespeicherter Stand' in off and pg.locator('.mu-karte').count() == 3 and pg.locator('.mu-knopf:not([disabled])').count() == 0, f'{tag}: offline letzter Stand, Bewerten gesperrt')
    pg.st['down'] = False

    # Mehr
    pg.click(f'{nav} [data-nav=mehr]'); pg.wait_for_selector('#mehrseite:not([hidden]) .bs-zeile')
    mehr = pg.locator('#mehrseite').text_content()
    check(pg.url.endswith('#mehr') and all(t in mehr for t in ['Unterwegs', 'In der Nähe', 'Merkliste', 'Hilfe und Feedback', 'Über WaterMap', 'Datenschutz', 'Impressum']),
          f'{tag}: „Mehr“ mit allen Einträgen')
    check(pg.get_attribute('#mehrseite a.bs-zeile:has-text("Über WaterMap")', 'href') == './ueber.html' and (pg.get_attribute('#mehrseite a.bs-zeile:has-text("Hilfe")', 'href') or '').startswith('mailto:'),
          f'{tag}: Links zu Über und Feedback')
    check(all(b['height'] >= 44 for b in [pg.locator('#mehrseite .bs-zeile').nth(i).bounding_box() for i in range(pg.locator('#mehrseite .bs-zeile').count())]), f'{tag}: Zeilen ≥ 44 px')
    pg.screenshot(path=str(SHOTS / f'bereiche_{w}_2mehr.png'))
    pg.click('#mehrseite .bs-zeile:has-text("In der Nähe")'); pg.wait_for_selector('.place.nk, .nh-leer')
    check(pg.url.endswith('#naehe') and pg.locator(f'{nav} [data-nav=mehr]').get_attribute('aria-current') == 'page', f'{tag}: Mehr → In der Nähe (#naehe)')

    # Merkliste: ein Ort, ein Pegel; öffnen und entfernen
    pg.evaluate("([id, g]) => { localStorage.setItem('watermap.favorites.v1', JSON.stringify([id])); localStorage.setItem('watermap.meinePegel', JSON.stringify([g])); localStorage.setItem('watermap.meinePegel.ampel', '1'); }", [ids[0], G])
    pg.goto(uf.BASE + '#mehr/merkliste'); pg.wait_for_selector('#mehrseite .bs-wert', timeout=10000)
    mk = pg.locator('#mehrseite').text_content()
    check('Gespeicherte Orte (1)' in mk and 'Meine Pegel (1)' in mk and 'Vlotho' in mk and '96 cm' in mk and 'niedrig' in mk.lower(), f'{tag}: Merkliste mit Ort und Pegel')
    pg.screenshot(path=str(SHOTS / f'bereiche_{w}_3merkliste.png'))
    pg.click('#mehrseite .bs-zeile:has-text("Vlotho")'); pg.wait_for_selector('.pegelseite .pd-name')
    check(pg.url.endswith('#pegel/' + G), f'{tag}: Pegel aus der Merkliste öffnet die Pegel-Detailseite')
    pg.locator('.pegelseite .pd-icon').first.click(); pg.wait_for_selector('#mehrseite:not([hidden]) .bs-wert')
    check(pg.url.endswith('#mehr/merkliste'), f'{tag}: Zurück führt zur Merkliste')
    pg.click('#mehrseite .bs-link >> nth=0'); pg.wait_for_timeout(100)
    pg.click('#mehrseite .bs-entfernen >> nth=0'); pg.wait_for_timeout(200)
    check('Noch keine Orte gespeichert' in pg.inner_text('#mehrseite') and pg.evaluate("JSON.parse(localStorage.getItem('watermap.favorites.v1'))") == [], f'{tag}: Ort entfernt (Speicher der Favoriten)')
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [G], f'{tag}: „Meine Pegel“ unverändert')
    pg.click(f'{nav} [data-nav=mehr]'); pg.wait_for_timeout(200)
    check(pg.url.endswith('#mehr') and 'Unterwegs' in pg.locator('#mehrseite').text_content(), f'{tag}: „Mehr“ in der Merkliste führt zur Übersicht')

    # Slipanlage: „Weißt du mehr? Ergänzen“ öffnet „Angaben ergänzen“ (kein „Fehler melden“)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(500)
    pg.evaluate(f"window.__watermap.selectPlace({ids[2]!r}, {{full: true}})"); pg.wait_for_selector('#detail .wb-link')
    pg.locator('#detail .wb-link').click(); pg.wait_for_selector('.ae-dlg[open]')
    dlg = pg.locator('.ae-dlg'); sb = dlg.locator('.ae-senden')
    check('Angaben ergänzen' in dlg.inner_text() and 'Informationen korrigieren' not in pg.inner_text('body') and sb.is_disabled() and sb.inner_text() == 'Nichts ausgewählt',
          f'{tag}: Formular „Angaben ergänzen“, ohne Auswahl gesperrt')
    bx = dlg.bounding_box()
    check(bx['x'] >= 0 and bx['x'] + bx['width'] <= w + 1 and bx['y'] + bx['height'] <= hh + 1, f'{tag}: Formular passt ins Fenster')
    if dlg.locator('fieldset[data-key=fee]').count() == 0: dlg.locator('.ae-aendern').click()
    fee = dlg.locator('fieldset[data-key=fee]')
    fee.locator('.ae-opt', has_text='Kostenlos').click()
    check(sb.inner_text() == '1 Angabe senden' and not sb.is_disabled(), f'{tag}: eine Angabe gewählt')
    fee.locator('.ae-opt', has_text='Kostenlos').click()
    check(sb.is_disabled() and fee.locator('.ae-opt[aria-pressed=true]').count() == 0, f'{tag}: nochmal antippen hebt die Auswahl auf')
    fee.locator('.ae-opt', has_text='Kostenpflichtig').click(); fee.locator('input[name=fee_note]').fill('5 € pro Tag')
    if dlg.locator('select[name=surface]').count() == 0: dlg.locator('.ae-aendern').click()
    dlg.locator('select[name=surface]').select_option('Beton')
    dlg.locator('fieldset[data-key=trailer] .ae-opt', has_text='In der Nähe').click()
    check(sb.inner_text() == '3 Angaben senden', f'{tag}: Zähler „3 Angaben senden“ ({sb.inner_text()})')
    pg.screenshot(path=str(SHOTS / f'bereiche_{w}_5ergaenzen.png'))
    pg.evaluate("localStorage.removeItem('watermap.lastSubmit')")   # Sendebremse nach „Unpassend melden“ oben
    n0 = len(pg.st['forms']); sb.click(); pg.wait_for_selector('.ae-dlg', state='detached')
    f = pg.st['forms'][-1] if len(pg.st['forms']) > n0 else {}
    check(f.get('form-name') == 'slip-ergaenzen' and f.get('standort_id') == ids[2] and json.loads(f.get('angaben', '{}')) == {'fee': 'kostenpflichtig', 'fee_note': '5 € pro Tag', 'surface': 'Beton', 'trailer': 'naehe'},
          f'{tag}: nur gewählte Angaben gesendet ({f.get("angaben")})')
    check('Deine Angaben werden geprüft' in pg.inner_text('body'), f'{tag}: Danke-Hinweis')

    # Alte Adressen
    for adresse, sel in [('#pegel', '.pegelseite .fk, .pegelseite .pg-titel'), ('#favoriten', '#list-title'), ('#naehe', '.place.nk, .nh-leer'), ('#melden', '#report-menu[open]')]:
        pg.goto(uf.BASE + adresse); pg.wait_for_selector(sel, timeout=10000)
        check(True, f'{tag}: alte Adresse {adresse} funktioniert')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(360, 740), (375, 812), (390, 844), (768, 1024), (1024, 768), (1440, 900)]:
                run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
