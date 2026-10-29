"""UI-Test Bereich „Pegel“ (Dashboard, Detailseite, Pegel auf der Karte) mit nachgebildetem PEGELONLINE und den Daten aus ui_full.py.
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
    # Zusatzwerte (Stufe 2): nur Kaub liefert Wassertemperatur, Abfluss und Vorhersage
    m = re.fullmatch(r'stations/([^/]+)\.json', rest)
    if m and m.group(1) in BY_ID:
        st = dict(BY_ID[m.group(1)]); ts = list(st['timeseries'])
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


# Wetter für den Wochenend-Ausblick (Bright-Sky-Format, wie ui_wetter.py)
weather = {'gust': 26.0}
def wetter_handler(route):
    u = urlparse(route.request.url); q = parse_qs(u.query); path = u.path
    j = lambda body: route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    if path.endswith('/weather'):
        start = dt.datetime.fromisoformat(q['date'][0].replace('Z', '+00:00')).replace(minute=0, second=0, microsecond=0)
        end = dt.datetime.fromisoformat(q['last_date'][0].replace('Z', '+00:00'))
        out, tt = [], start
        while tt <= end:
            out.append({'timestamp': iso(tt.astimezone()), 'source_id': 2, 'temperature': 14.0, 'icon': 'partly-cloudy-day', 'wind_speed': 12.0, 'wind_direction': 225,
                        'wind_gust_speed': weather['gust'], 'precipitation': 0.0, 'precipitation_probability': 5})
            tt += dt.timedelta(hours=1)
        return j({'weather': out, 'sources': [{'id': 2, 'observation_type': 'forecast', 'station_name': 'TEST'}]})
    if path.endswith('/alerts'): return j({'alerts': [], 'location': {'name': 'Test', 'warn_cell_id': 1}})
    if path.endswith('/current_weather'): return j({'weather': {'timestamp': iso(NOW), 'temperature': 12.0, 'icon': 'cloudy', 'wind_speed_10': 10.0, 'wind_direction_10': 200, 'wind_gust_speed_10': 20.0}, 'sources': []})
    return route.fulfill(status=404, body='{}')

def wochenende_namen(heute=None):
    heute = heute or dt.date.today(); w = (heute.weekday() + 1) % 7   # 0 = Sonntag wie in JS
    if w == 6: return ['Samstag', 'Sonntag']
    if w == 0: return ['Sonntag', 'Montag']
    return ['Samstag', 'Sonntag']

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile, init=''):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    ctx.route('**/api/pegel/**', handler)
    ctx.route('**/api/wetter/**', wetter_handler)
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
    pegel_text = pg.get_attribute(f'{nav} [data-nav=pegel]', 'aria-label') if mobile else pg.inner_text(f'{nav} [data-nav=pegel]')   # Handy: nur Symbole, Beschriftung als aria-label
    check(pg.get_attribute(f'{nav} [data-nav=pegel]', 'href') == './#pegel' and pegel_text.strip().startswith('Pegel')
          and 'Ampel' not in pegel_text, f'{tag}: Tab „Pegel“ führt ins Dashboard')
    pg.click(f'{nav} [data-nav=pegel]'); pg.wait_for_selector('.pg-titel')
    check(pg.url.endswith('#pegel') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Adresse #pegel, „Pegel“ aktiv')
    check(pg.locator('.shell').is_hidden() and pg.locator('.toolbar').is_hidden(), f'{tag}: Karte und Kategorien ausgeblendet')
    pg.wait_for_selector('.pm-karte')
    check(re.search(r'^Stand \d\d:\d\d · WSV/PEGELONLINE$', pg.inner_text('.pg-stand')) is not None, f'{tag}: „Stand <Uhrzeit> · WSV/PEGELONLINE“ ({pg.inner_text(".pg-stand")!r})')
    tabs = pg.locator('.pg-tabs[role=tablist] [role=tab]')
    check(tabs.count() == 2 and tabs.all_inner_texts() == ['Liste', 'Karte'] and tabs.nth(0).get_attribute('aria-selected') == 'true', f'{tag}: Umschalter Liste | Karte (tablist)')
    if mobile: check(pg.locator('.app-header').is_hidden(), f'{tag}: Handy: Pegel-Start mit eigenem Kopf, ohne globales Suchfeld')
    check(pg.locator('.pg-suche').count() == 1 and pg.get_attribute('#pg-suche', 'placeholder') == 'Pegel oder Gewässer suchen und merken', f'{tag}: EIN Suchfeld „Pegel oder Gewässer suchen und merken“')
    check(pg.locator('#pa-pop').count() == 0 and pg.locator('.pg-fluesse, .fk').count() == 0, f'{tag}: kein Dialog „Pegel hinzufügen“, keine Fluss-Kacheln auf der Startansicht')
    # Reihenfolge
    ys = [pg.locator(s).bounding_box()['y'] for s in ['#pg-meine-t', '#pg-lage-t', '#pg-wz-t' if False else '.pg-werkzeuge']]
    check(ys == sorted(ys), f'{tag}: Reihenfolge Meine Pegel → Lage in Deutschland → Werkzeuge')
    karten = pg.locator('.pg-meine .pm-karte')
    check(karten.count() == 1 and 'Vlotho' in karten.first.inner_text() and 'Meine Pegel' in pg.inner_text('#pg-meine-t'), f'{tag}: Pegel der Pegel-Ampel übernommen')
    check(pg.inner_text('.pg-lage-satz').strip() == 'Dein Pegel Vlotho: normal.', f'{tag}: Lage-Satz bei einem Pegel ({pg.inner_text(".pg-lage-satz")!r})')
    k = karten.first
    pg.wait_for_selector('.pm-karte .pm-spark')
    kt = k.inner_text()
    check('182' in kt and 'Normal' in kt and 'Weser · km 201,4' in kt and '↘ fallend' in kt, f'{tag}: Karte mit Wert, Zustand, Gewässer + km, Trend')
    check(re.search(r'−\d+ cm in 24 h', kt) is not None, f'{tag}: Änderung in 24 h aus dem Verlauf ({kt!r})')
    check(k.locator('.ps-labels > span').count() == 4, f'{tag}: Skala mit MNW, MW, MHW, HSW')
    check('Verlauf 7 Tage' in (k.locator('.pm-spark').get_attribute('aria-label') or ''), f'{tag}: Mini-Verlauf mit aria-label')
    hist = [c for c in api['calls'] if 'measurements' in c]
    check(len(hist) == 1, f'{tag}: Verlauf nur für sichtbare Karten geladen ({len(hist)})')
    # Lage in Deutschland: drei Zähler
    z = {kk: pg.inner_text(f'.pg-zaehler.is-{kk} strong') for kk in ['hsw', 'high', 'low']}
    check(z == {'hsw': '1', 'high': '1', 'low': '2'} and pg.locator('.pg-zaehler').count() == 3, f'{tag}: Lage in Deutschland: über HSW · hoch · niedrig ({z})')
    zb = [pg.locator('.pg-zaehler').nth(i).bounding_box() for i in range(3)]
    check(abs(zb[0]['y'] - zb[2]['y']) < 2 and zb[2]['x'] > zb[1]['x'] > zb[0]['x'], f'{tag}: die drei Zähler stehen in EINER Zeile')
    check(pg.locator('.pg-zaehler.is-low i').evaluate("e => getComputedStyle(e).backgroundColor") == 'rgb(250, 178, 25)' and 'Deutschland heute' in pg.inner_text('#pg-lage-t'), f'{tag}: „Deutschland heute“ als kleine Chips mit Farbpunkt')
    # Flüsse im Überblick: Zeile, Kacheln im Fenster
    zeile = pg.locator('.pg-fl-zeile')
    check('Flüsse im Überblick' in zeile.inner_text() and 'Rhein niedrig' in zeile.inner_text(), f'{tag}: Zeile „Flüsse im Überblick – Kurzfassung ›“ ({zeile.inner_text()!r})')
    zeile.click(); pg.wait_for_selector('dialog.wxd-fluesse[open] .fk')
    namen = [tt.strip() for tt in pg.locator('dialog.wxd-fluesse .fk .fk-name').all_inner_texts()]
    check(namen == ['Rhein', 'Weser', 'Küste'] and 'Tippe auf einen Fluss für alle Pegel' in pg.inner_text('dialog.wxd-fluesse'), f'{tag}: Fluss-Kacheln im Fenster ({namen})')
    rhein = pg.locator('dialog.wxd-fluesse .fk', has_text='Rhein')
    check(rhein.get_attribute('href') == '#pegel/fluss/rhein' and 'Kaub 72 cm' in rhein.inner_text(), f'{tag}: Kachel ist Link, tiefster Pegel')
    weser = pg.locator('dialog.wxd-fluesse .fk', has_text='Weser')
    check('teils niedrig' in weser.inner_text() and '1 von 5 niedrig' in weser.inner_text() and 'Minden 96 cm' in weser.inner_text() and weser.locator('.fk-punkte i').count() == 5,
          f'{tag}: Kachel Weser „teils niedrig“, tiefster Pegel, Punkte nur mit Kennwerten')
    check('Tide' in pg.locator('dialog.wxd-fluesse .fk', has_text='Küste').inner_text(), f'{tag}: Kachel Küste mit „Tide“')
    pg.click('dialog.wxd-fluesse .pg-fl-alle'); pg.wait_for_timeout(200)
    mo = pg.locator('dialog.wxd-fluesse .fk-wz', has_text='Mosel')
    check(mo.count() == 1 and 'über HSW' in mo.inner_text() and '2 Pegel' in mo.inner_text() and mo.get_attribute('href') == '#pegel/fluss/mosel', f'{tag}: Mosel in der kompakten Liste (über HSW)')
    check(pg.locator('dialog.wxd-fluesse .fk-ohne').first.is_visible() and 'Test-See' in pg.inner_text('dialog.wxd-fluesse .fk-weitere'), f'{tag}: „Alle Gewässer“ mit Abschnitt ohne Bewertung')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_1fluesse_fenster.png'))
    pg.locator('dialog.wxd-fluesse .fk', has_text='Rhein').click(); pg.wait_for_selector('dialog.wxd-fluss[open] .pf-titel')
    check(pg.locator('dialog.wxd-fluesse[open]').count() == 1 and 'Rhein' in pg.inner_text('dialog.wxd-fluss .pf-kopf') and pg.url.endswith('#pegel'), f'{tag}: Fluss öffnet als Fenster über dem Überblick, Adresse bleibt')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(pg.locator('dialog.wxd-fluss[open]').count() == 0 and pg.locator('dialog.wxd-fluesse[open]').count() == 1, f'{tag}: Esc schließt nur das obere Fenster')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(pg.locator('dialog.wxd-fluesse[open]').count() == 0, f'{tag}: zweites Esc schließt den Überblick')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_1dashboard.png'), full_page=True)
    ausserhalb = pg.evaluate("""() => [...document.querySelectorAll('.pm-karte')].flatMap(k => { const r = k.getBoundingClientRect();
        return [...k.querySelectorAll('.ps-labels > span')].filter(s => { const b = s.getBoundingClientRect(); return b.left < r.left + 4 || b.right > r.right - 4; }).map(s => s.textContent); })""")
    check(not ausserhalb, f'{tag}: Beschriftungen der Skala (MNW …) liegen innerhalb der Kachel {ausserhalb}')
    # Kennwerte eng am linken und rechten Rand (MNW/MW dicht beisammen, MHW/HSW dicht beisammen): MNW darf nicht aus der Kachel ragen
    raus = pg.evaluate("""async () => {
      const { skala } = await import('./js/pegel-ansicht.js');
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:40px;top:40px;width:260px;background:#fff;z-index:99999;padding:0';
      document.body.append(box);
      const out = [];
      for (const refs of [{ MNW: 100, MW: 104, MHW: 450, HSW: 470 }, { MNW: 100, MW: 106, MHW: 300, HSW: 310 }, { MNW: 100, MW: 200, MHW: 480, HSW: 590 }]) {
        box.replaceChildren(skala({ value: 120, unit: 'cm', refs }));
        const r = box.getBoundingClientRect();
        for (const s of box.querySelectorAll('.ps-labels > span')) { const b = s.getBoundingClientRect(); if (b.left < r.left - 0.5 || b.right > r.right + 0.5) out.push(s.textContent + JSON.stringify(refs)); }
      }
      box.remove(); return out;
    }""")
    check(not raus, f'{tag}: Skala-Beschriftungen bleiben bei engen Kennwerten innerhalb {raus}')
    # Zähler → „Alle Pegel“ (Liste am Handy, Tabelle am Desktop)
    check(pg.locator('#pg-alle').is_hidden(), f'{tag}: „Alle Pegel“ ohne Filter nicht sichtbar')
    pg.click('.pg-zaehler.is-low'); pg.wait_for_timeout(300)
    sel = '.pg-alle-liste .pa-text strong' if mobile else '.pg-tabelle tbody .pg-zeile-btn'
    names = [n.strip() for n in pg.locator(sel).all_inner_texts()]
    check(sorted(names) == ['Kaub', 'Minden'] and pg.locator('.pg-alle .ftag').get_attribute('aria-label') == 'Filter niedrig entfernen', f'{tag}: Zähler filtert „Alle Pegel“ ({names})')
    check(pg.locator('.pg-tabelle').count() == (0 if mobile else 1), f'{tag}: {"Handy: Liste statt Tabelle" if mobile else "Desktop: Tabelle"}')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_2alle.png'))
    pg.click('.pg-alle .ftag'); pg.wait_for_timeout(200)
    check(pg.locator('#pg-alle').is_hidden(), f'{tag}: Filter entfernen blendet „Alle Pegel“ aus')
    # Suche: Treffer mit Name, Gewässer, Wert, Zustand und Stern
    pg.fill('#pg-suche', 'mosel'); pg.wait_for_timeout(200)
    tr = pg.locator('.pg-treffer .pa-zeile')
    check(tr.count() == 2 and sorted(n.strip() for n in pg.locator('.pg-treffer .pa-text strong').all_inner_texts()) == ['Cochem', 'Trier'], f'{tag}: Suche nach Gewässer ({tr.count()} Treffer)')
    tt = tr.filter(has_text='Trier')
    check('Mosel' in tt.inner_text() and '640 cm' in tt.inner_text() and 'über HSW' in tt.inner_text() and tt.locator('.pm-stern').count() == 1, f'{tag}: Treffer mit Name, Gewässer, Wert, Zustand, Stern')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_5suche.png'))
    tt.locator('.pm-stern').click(); pg.wait_for_timeout(300)
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(1), U(5)] and pg.input_value('#pg-suche') == 'mosel'
          and pg.locator('.pg-treffer .pa-zeile', has_text='Trier').locator('.pm-stern').get_attribute('aria-pressed') == 'true', f'{tag}: Stern merkt den Pegel direkt, Suche bleibt')
    check(sorted(n.strip() for n in pg.locator('.pg-meine .pm-name').all_inner_texts()) == ['Trier', 'Vlotho'], f'{tag}: „Meine Pegel“ aktualisiert sich')
    pg.locator('.pg-treffer .pa-zeile', has_text='Trier').locator('.pm-stern').click(); pg.wait_for_timeout(300)
    check(pg.evaluate("JSON.parse(localStorage.getItem('watermap.meinePegel'))") == [U(1)], f'{tag}: Stern entfernt wieder')
    pg.fill('#pg-suche', 'xyz'); pg.wait_for_timeout(150)
    check('Kein Pegel gefunden.' in pg.inner_text('.pg-treffer'), f'{tag}: kein Treffer')
    pg.fill('#pg-suche', 'weser'); pg.wait_for_timeout(150)
    check('8 Treffer' in pg.inner_text('.pg-treffer'), f'{tag}: Suche „Weser“ ({pg.inner_text(".pg-treffer .pa-kopf")})')
    check(pg.locator('.pg-suchzeile .such-x').is_visible() and pg.locator('.pg-treffer .pm-stern.is-klein').count() == 8, f'{tag}: „X“ im Suchfeld, Stern sichtbar (klein)')
    pg.click('.pg-suchzeile .such-x'); pg.wait_for_timeout(150)
    check(pg.input_value('#pg-suche') == '' and pg.locator('.pg-treffer').is_hidden() and pg.locator('.pg-suchzeile .such-x').is_hidden() and pg.evaluate("document.activeElement.id") == 'pg-suche', f'{tag}: „X“ leert die Suche, Treffer weg, Fokus bleibt')
    pg.click('.pg-hinzu'); pg.wait_for_timeout(200)
    check(pg.evaluate("document.activeElement.id") == 'pg-suche', f'{tag}: „+ Pegel hinzufügen“ fokussiert die Suche')
    tw = pg.locator('.pg-wz.is-ampel'); al = pg.locator('.pg-wz.is-alarm')
    check(tw.get_attribute('href') == f'./pegel-ampel?pegel={U(1)}' and al.get_attribute('href') == f'./pegel-ampel?pegel={U(1)}#am-alarm' and 'Passt mein Boot?' in tw.inner_text() and 'Pegel-Alarm' in al.inner_text(),
          f'{tag}: Werkzeuge Pegel-Ampel und Pegel-Alarm mit gewähltem Pegel')
    check('Angaben ohne Gewähr' in pg.inner_text('.pg-fuss'), f'{tag}: Fußnote')
    # Ansicht „Karte“
    pg.click('#pg-tab-karte'); pg.wait_for_selector('.pk-pille')
    check(pg.url.endswith('#pegel/karte') and pg.evaluate("localStorage.getItem('watermap.pegel.ansicht')") == 'karte' and pg.get_attribute('#pg-tab-karte', 'aria-selected') == 'true', f'{tag}: Karte: Adresse #pegel/karte, Auswahl gemerkt')
    check(pg.locator('.pk-pille').count() >= 3 and pg.locator('.pk-leg').count() == 4 and 'niedrig' in pg.inner_text('.pk-legende'), f'{tag}: Karte: Pegel als Pillen im Ausschnitt, Legende ({pg.locator(".pk-pille").count()})')
    pg.wait_for_timeout(300)
    zahlen = pg.locator('.pk-pille .pk-zahl').all_inner_texts()
    check('182' in zahlen and all(z.isdigit() for z in zahlen), f'{tag}: Karte: Wert in cm in der Pille ({zahlen})')
    check(pg.locator('.pk-pille.is-gemerkt').count() >= 1 and pg.locator('.pk-pille.is-low, .pk-pille.is-normal').count() >= 1 and pg.locator('.pk-pille').first.evaluate("e => e.style.getPropertyValue('--pk')") != '', f'{tag}: Karte: Zustandsfarbe, gemerkte Pegel größer')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_6karte.png'))
    # Pille antippen → Vorschau-Karte
    pg.evaluate("document.querySelectorAll('.pk-pille')[1].closest('.pk-marker').dispatchEvent(new MouseEvent('click', { bubbles: true }))"); pg.wait_for_timeout(300)
    if pg.locator('.pk-vorschau').is_hidden(): pg.locator('.pk-marker').nth(1).click(force=True); pg.wait_for_timeout(300)
    check(pg.locator('.pk-vorschau').is_visible() and pg.locator('.pk-vorschau .pk-details').count() == 1 and pg.locator('.pk-vorschau .pk-merken').count() == 1, f'{tag}: Karte: Vorschau mit „Details“ und „Merken“')
    check(pg.locator('.pk-pille.is-gewaehlt').count() == 1, f'{tag}: Karte: gewählter Pegel als dunkle Pille')
    vname = pg.inner_text('.pk-v-name')
    vorher = pg.get_attribute('.pk-vorschau .pk-merken', 'aria-pressed')
    pg.click('.pk-vorschau .pk-merken'); pg.wait_for_timeout(200)
    check(pg.get_attribute('.pk-vorschau .pk-merken', 'aria-pressed') != vorher, f'{tag}: Karte: Merken schaltet um ({vorher} → {pg.get_attribute(".pk-vorschau .pk-merken", "aria-pressed")})')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_6karte_vorschau.png'))
    pg.click('.pk-vorschau .pk-details'); pg.wait_for_selector('dialog.wxd-pegel[open] .pd-name')
    check(pg.inner_text('dialog.wxd-pegel .pd-name') == vname and pg.url.endswith('#pegel/karte'), f'{tag}: Karte: „Details“ öffnet das Pegel-Fenster (Adresse bleibt)')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.reload(); pg.wait_for_selector('.pk-pille')
    check(pg.url.endswith('#pegel/karte'), f'{tag}: Karte bleibt nach dem Neuladen (Direktlink)')
    pg.click('#pg-tab-liste'); pg.wait_for_selector('.pg-lage-satz')
    check(pg.url.endswith('#pegel') and pg.evaluate("localStorage.getItem('watermap.pegel.ansicht')") == 'liste', f'{tag}: Liste: Adresse #pegel, Auswahl gemerkt')
    pg.evaluate("localStorage.setItem('watermap.pegel.ansicht', 'karte')"); pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip')
    pg.click(f'{nav} [data-nav=pegel]'); pg.wait_for_selector('.pk-pille')
    check(pg.url.endswith('#pegel/karte'), f'{tag}: gemerkte Ansicht „Karte“ beim Öffnen des Tabs')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Mehrere gemerkte Pegel: Lage-Satz, höchstens 3 Karten, Wochenende
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel', JSON.stringify(['%s','%s','%s','%s']));" % (U(1), U(2), U(5), U(8)))
    weather['gust'] = 26.0
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-lage-satz'); pg.wait_for_selector('.pm-karte .pm-spark')
    check(pg.inner_text('.pg-lage-satz').strip() == 'Deine 4 Pegel: 2 normal, Minden niedrig, Trier über HSW und steigend.', f'{tag}: Lage-Satz ({pg.inner_text(".pg-lage-satz")!r})')
    check(pg.locator('.pg-lage-satz .ls-gelb').inner_text() == 'Minden niedrig' and pg.locator('.pg-lage-satz .ls-rot').inner_text() == 'Trier über HSW und steigend', f'{tag}: auffällige Pegel farbig, mit Text')
    check(pg.locator('.pg-meine .pm-karte').count() == 3 and pg.inner_text('.pg-weitere') == '+ 1 weitere Pegel (Köln) ›', f'{tag}: höchstens 3 Karten, „+ 1 weitere Pegel (Köln) ›“')
    pg.click('.pg-weitere'); pg.wait_for_timeout(200)
    check(pg.locator('.pg-meine .pm-karte').count() == 4, f'{tag}: „+ weitere“ zeigt alle')
    pg.wait_for_selector('.pg-wo-tabelle', timeout=8000)
    tage = [x.strip() for x in pg.locator('.pg-wo-tabelle thead th:not(:first-child) .pg-sr').all_inner_texts()]
    check(pg.locator('.pg-wochenende').is_visible() and tage == wochenende_namen() and pg.locator('.pg-wo-tabelle tbody tr').count() == 4, f'{tag}: Wochenend-Check: je Pegel eine Zeile, zwei Tage ({tage})')
    zeile = lambda n: pg.locator('.pg-wo-tabelle tbody tr', has_text=n)
    check('Hochwasser' in zeile('Trier').inner_text() and 'Pegel knapp' in zeile('Minden').inner_text() and 'Wind 3 Bft' in zeile('Vlotho').inner_text() and '14°' in zeile('Vlotho').inner_text(),
          f'{tag}: Zellen je Pegel: Hochwasser, Pegel knapp, Wind ({pg.inner_text(".pg-wo-tabelle tbody")!r})')
    check(zeile('Trier').locator('.pg-wo-dot.is-rot').count() == 2 and zeile('Minden').locator('.pg-wo-dot.is-gelb').count() == 2 and zeile('Vlotho').locator('.pg-wo-dot.is-gruen').count() == 2, f'{tag}: Ampelpunkte mit Text')
    check('Pegel: Stand heute' in pg.inner_text('.pg-wochenende') and 'Wetter je Ort' in pg.inner_text('.pg-wochenende'), f'{tag}: Hinweis „Wetter je Ort, Pegel: Stand heute“')
    wcalls = pg.evaluate("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/wetter/weather')).map(e => new URL(e.name).searchParams.get('lat'))")
    check(len(set(wcalls)) == 4, f'{tag}: Wetter für jeden Pegel am eigenen Ort ({sorted(set(wcalls))})')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_3wochenende.png'), full_page=True)
    ctx.close()
    # nur normale Pegel + starke Böen / ruhig
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel', JSON.stringify(['%s','%s']));" % (U(1), U(8)))
    weather['gust'] = 45.0
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-wo-tabelle', timeout=10000)
    check('Böen 6 Bft' in pg.inner_text('.pg-wochenende') and pg.locator('.pg-wo-dot.is-gelb').count() >= 4 and pg.locator('.pg-wo-tabelle .pg-wo-dot.is-gruen').count() == 0, f'{tag}: starke Böen → gelb „Böen 6 Bft“')
    ctx.close()
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel', JSON.stringify(['%s','%s']));" % (U(1), U(8)))
    weather['gust'] = 20.0
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-wo-tabelle', timeout=10000)
    check(pg.locator('.pg-wo-tabelle .pg-wo-dot.is-gruen').count() == 4 and 'Wind 3 Bft' in pg.inner_text('.pg-wochenende'), f'{tag}: normale Pegel und ruhig → grün „Wind 3 Bft“')
    ctx.close()
    # ohne Wetterdaten: kein Ausblick
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel', JSON.stringify(['%s']));" % U(1))
    pg.route('**/api/wetter/**', lambda r: r.fulfill(status=502, body='x'))
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-lage-satz'); pg.wait_for_timeout(800)
    check(pg.locator('.pg-wochenende').is_hidden(), f'{tag}: ohne Wetterdaten kein Wochenend-Ausblick (nichts erfunden)')
    ctx.close()
    # ohne gemerkte Pegel: kein Ausblick, kein Lage-Satz
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel.ampel', '1');")
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-meine'); pg.wait_for_timeout(500)
    check(pg.locator('.pg-wochenende').is_hidden() and pg.locator('.pg-lage-satz').is_hidden(), f'{tag}: ohne gemerkte Pegel weder Lage-Satz noch Wochenend-Ausblick')
    ctx.close()
    # erneut mit der Pegel-Ampel-Übernahme für den Rest
    ctx, pg = page(b, w, hh, mobile, init="if (!localStorage.getItem('watermap.ampel')) localStorage.setItem('watermap.ampel', JSON.stringify({ pegel: '%s', min: 150 }));" % U(1))
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pm-karte')

    # Detailseite
    pg.fill('#pg-suche', 'vlotho'); pg.wait_for_timeout(150)
    pg.locator('.pg-treffer .pg-treffer-btn', has_text='Vlotho').click(); pg.wait_for_selector('dialog.wxd-pegel[open] .pd-name')
    check(pg.url.endswith('#pegel') and pg.locator(f'{nav} [data-nav=pegel]').get_attribute('aria-current') == 'page', f'{tag}: Details im Fenster, Adresse #pegel, Tab bleibt „Pegel“')
    t = pg.inner_text('.pd')
    check('PEGEL · WESER · KM 201,4' in ' '.join(pg.inner_text('.pd-kicker').split()).upper() and pg.inner_text('.pd-name') == 'Vlotho' and '182' in pg.inner_text('.pd-wert'), f'{tag}: Kopf mit Kicker, Name, Wert')
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
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(pg.locator('dialog.wxd-pegel[open]').count() == 0 and pg.url.endswith('#pegel') and pg.locator('.pg-titel').is_visible() and pg.input_value('#pg-suche') == 'vlotho', f'{tag}: Esc schließt das Fenster → Dashboard, Suche bleibt')
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

    # Stufe 2: Wassertemperatur, Abfluss, Vorhersage (nur wo geliefert), Alarm-Zeile, Bild teilen
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel', JSON.stringify(['%s','%s']));" % (U(7), U(1)))
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pm-karte .pm-et', timeout=10000)
    kk = pg.locator('.pm-karte', has_text='Kaub')
    check([e.strip() for e in kk.locator('.pm-et').all_inner_texts()] == ['Wasser 12,5 °C', 'Abfluss 624 m³/s'], f'{tag}: Karte Kaub mit „Wasser 12,5 °C“ und „Abfluss 624 m³/s“')
    pg.wait_for_selector('.pm-karte .pm-spark-vorh', timeout=8000)
    check(kk.locator('.pm-spark-vorh').count() == 1 and pg.locator('.pm-karte', has_text='Vlotho').locator('.pm-et, .pm-spark-vorh').count() == 0, f'{tag}: Vorhersage als gestrichelte Verlängerung, Vlotho ohne Zusatz (nichts erfunden)')
    kk.locator('.pm-flaeche').click(); pg.wait_for_selector('dialog.wxd-pegel[open] .pd-z.is-q')
    d = pg.locator('dialog.wxd-pegel')
    pg.wait_for_function("document.querySelector('dialog.wxd-pegel .pd-z.is-wt .pd-z-sub')?.textContent.includes('seit gestern')", timeout=5000) if False else pg.wait_for_timeout(600)
    check('12,5' in d.locator('.pd-z.is-wt').inner_text() and '+1 °C seit gestern' in d.locator('.pd-z.is-wt').inner_text() and '624' in d.locator('.pd-z.is-q').inner_text() and 'm³/s' in d.locator('.pd-z.is-q').inner_text(),
          f'{tag}: Kacheln Wassertemperatur (+ Änderung seit gestern) und Abfluss ({d.locator(".pd-zusatz").inner_text()!r})')
    pg.wait_for_selector('dialog.wxd-pegel .gc-vorh', timeout=8000)
    check('Verlauf und Vorhersage' in d.inner_text() and d.locator('.gc-jetzt').count() == 1 and d.locator('.gc-vorh-bg').count() == 1 and d.locator('.gc-tief').count() == 1, f'{tag}: Diagramm mit Vorhersage (gestrichelt, grau), Linie „jetzt“, Fläche unter MNW')
    vs = d.locator('.pd-vorh-satz').inner_text()
    check(re.fullmatch(r'Vorhersage: bleibt bis \w+ unter MNW \(66–70 cm\)\.', vs) is not None, f'{tag}: Satz zur Vorhersage ({vs!r})')
    check(d.locator('.pd-alarm').get_attribute('href') == f'./pegel-ampel?pegel={U(7)}#am-alarm' and 'Pegel-Alarm' in d.locator('.pd-alarm').inner_text(), f'{tag}: Zeile „Pegel-Alarm“')
    pg.screenshot(path=str(SHOTS / f'pegel_{w}_7detail_zusatz.png'))
    with pg.expect_download(timeout=10000) as dl:
        d.locator('.pd-bild').click()
    check(dl.value.suggested_filename == 'Pegel-Kaub.png', f'{tag}: „Als Bild teilen“ erzeugt ein Bild (ohne Teilen-Funktion: Download {dl.value.suggested_filename})')
    if w == 390:
        pfad = SHOTS / 'pegel_bild_kaub.png'; dl.value.save_as(str(pfad))
        from PIL import Image
        check(Image.open(pfad).size == (1080, 1350), f'{tag}: Bild 1080 × 1350')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.locator('.pm-karte', has_text='Vlotho').locator('.pm-flaeche').click(); pg.wait_for_selector('dialog.wxd-pegel[open] .pd-name'); pg.wait_for_timeout(800)
    check(pg.locator('dialog.wxd-pegel .pd-zusatz').is_hidden() and pg.locator('dialog.wxd-pegel .gc-vorh').count() == 0 and 'Verlauf und Vorhersage' not in pg.inner_text('dialog.wxd-pegel'), f'{tag}: Vlotho ohne Zusatzwerte und ohne Vorhersage')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Leere Liste: ohne Position Hinweis, mit Position die 3 nächsten
    ctx, pg = page(b, w, hh, mobile, init="localStorage.setItem('watermap.meinePegel.ampel', '1');")
    pg.goto(uf.BASE + '#pegel'); pg.wait_for_selector('.pg-meine')
    check(pg.locator('.pg-meine .pm-karte').count() == 0 and 'Noch keine Pegel gemerkt' in pg.inner_text('.pg-meine'), f'{tag}: leer ohne Position: Hinweis')
    pg.evaluate("window.__watermap.state.user = { lat: 52.2, lon: 8.9 }")
    pg.click('.pg-neu'); pg.wait_for_selector('.pg-meine .pm-karte')
    names = [n.strip() for n in pg.locator('.pg-meine .pm-name').all_inner_texts()]
    check(pg.inner_text('#pg-meine-t') == 'Pegel in deiner Nähe' and names == ['Vlotho', 'Porta', 'Minden'] and 'Tippe auf ☆' in pg.inner_text('.pg-meine'), f'{tag}: mit Position die 3 nächsten ({names})')
    # Offline: letzter Stand
    api['fail'] = True
    pg.click('.pg-neu'); pg.wait_for_timeout(500)
    check('Stand von' in pg.inner_text('.pg-stand') and pg.locator('.pg-meine .pm-karte').count() == 3, f'{tag}: offline mit „Stand von …“ und letzten Werten')
    api['fail'] = False
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
