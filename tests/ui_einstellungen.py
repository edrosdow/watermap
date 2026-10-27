"""UI-Test „Mein WaterMap“ (#mehr/einstellungen): Einstieg in „Mehr“, Bootstyp und Bootsmaße, Kategorien, Startausschnitt,
Bezugspunkt „In der Nähe“, Standortfreigabe, ausgeblendete Meldungen, Offline-Daten, Alles zurücksetzen – bei 375/390/1024/1440 px.
Start: python3 tests/ui_einstellungen.py [screenshots-ordner]"""
import importlib.util, json, pathlib, tempfile, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = int(time.time() * 1000)
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def page(b, w, hh, mobile, geo=None):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block',
                        geolocation=geo, permissions=['geolocation'] if geo else [])
    uf.lib_routes(ctx)
    ctx.route('**/api/meldungen**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'aktiv': [], 'meldungen': [], 'zeit': NOW})))
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.errs = errs
    return ctx, pg

ls = lambda pg, k: pg.evaluate(f"localStorage.getItem({json.dumps(k)})")

def run(b, w, hh):
    mobile = w < 768; tag = f'{w}px'
    print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile)
    pg.goto(uf.BASE + '#mehr'); pg.wait_for_selector('#mehrseite .ei-profil')
    karte = pg.inner_text('#mehrseite .ei-profil')
    check('Mein WaterMap' in karte and 'Motorboot' in karte and 'ohne Konto' in karte, f'{tag}: „Mehr“ zeigt „Mein WaterMap“ ({karte!r})')
    bb = pg.locator('#mehrseite .ei-profil').bounding_box()
    check(bb['x'] >= 15 and bb['x'] + bb['width'] <= w - 15 and bb['height'] >= 44, f'{tag}: Profil-Karte mit Rand und ≥ 44 px ({bb})')
    pg.click('#mehrseite .ei-profil'); pg.wait_for_selector('#mehrseite .ei-seite')
    check(pg.evaluate('location.hash') == '#mehr/einstellungen' and 'Mein WaterMap' in pg.inner_text('#bs-titel'), f'{tag}: Einstellungen unter #mehr/einstellungen')
    abschnitte = [t.strip().lower() for t in pg.locator('#mehrseite .bs-abschnitt h2').all_inner_texts()]
    check(abschnitte == ['mein boot', 'karte beim start', 'in der nähe', 'benachrichtigungen', 'daten auf diesem gerät'], f'{tag}: Abschnitte ({abschnitte})')
    check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{tag}: kein horizontales Scrollen')
    klein = pg.evaluate("""[...document.querySelectorAll('#mehrseite button, #mehrseite a, #mehrseite input')].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.height < 44).length""")
    check(klein == 0, f'{tag}: alle Bedienelemente ≥ 44 px ({klein} kleiner)')
    if w >= 1024:
        sp = pg.evaluate("[...document.querySelectorAll('.ei-spalten > div')].map(d => Math.round(d.getBoundingClientRect().left))")
        check(len(sp) == 2 and sp[1] > sp[0] + 200, f'{tag}: zwei Spalten ({sp})')
    pg.screenshot(path=str(SHOTS / f'einst_{w}.png'), full_page=True)

    # Bootstyp gehört der Pegel-Ampel
    pg.click('#mehrseite .ei-seg[aria-label=Bootstyp] button[data-wert=segel]')
    check(json.loads(ls(pg, 'watermap.ampel') or '{}').get('boot') == 'segel', f'{tag}: Bootstyp in der Pegel-Ampel gespeichert')
    # Maße: Komma, Grenzen, leer
    pg.fill('#ei-laenge', '6,5'); pg.press('#ei-laenge', 'Enter')
    pg.fill('#ei-tiefgang', '9'); pg.press('#ei-tiefgang', 'Tab'); pg.wait_for_timeout(50)
    boot = json.loads(ls(pg, 'watermap.boot') or '{}')
    check(boot.get('laenge') == 6.5 and 'tiefgang' not in boot, f'{tag}: Länge 6,5 gespeichert, Tiefgang 9 m abgelehnt ({boot})')
    check(pg.locator('#ei-tiefgang-f').is_visible() and 'zwischen' in pg.inner_text('#ei-tiefgang-f'), f'{tag}: Hinweis bei ungültigem Tiefgang')
    pg.fill('#ei-tiefgang', '0,8'); pg.press('#ei-tiefgang', 'Tab'); pg.wait_for_timeout(50)
    check(json.loads(ls(pg, 'watermap.boot')).get('tiefgang') == 0.8 and pg.locator('#ei-tiefgang-f').is_hidden(), f'{tag}: Tiefgang 0,8 gespeichert')
    pg.fill('#ei-laenge', ''); pg.press('#ei-laenge', 'Tab'); pg.wait_for_timeout(50)
    check(json.loads(ls(pg, 'watermap.boot')).get('laenge') is None, f'{tag}: leere Länge = keine Angabe')

    # Kategorien wirken auf die Karte; die letzte bleibt an
    pg.click('#mehrseite .ei-sw[data-typ=fuel]')
    check(pg.evaluate("window.__watermap.state.cats.has('fuel')") and pg.get_attribute('.ei-sw[data-typ=fuel]', 'aria-checked') == 'true', f'{tag}: Tankstellen eingeschaltet')
    pg.click('#mehrseite .ei-sw[data-typ=fuel]'); pg.click('#mehrseite .ei-sw[data-typ=slip]')
    check(pg.evaluate("[...window.__watermap.state.cats]") == ['slip'] and pg.get_attribute('.ei-sw[data-typ=slip]', 'aria-checked') == 'true' and 'Mindestens eine' in pg.inner_text('#toast'),
          f'{tag}: letzte Kategorie bleibt an')

    # Bezugspunkt „In der Nähe“
    seg = '#mehrseite .ei-seg[aria-label="Entfernungen messen ab"]'
    check(pg.get_attribute(f'{seg} button[data-wert=kartenmitte]', 'aria-pressed') == 'true', f'{tag}: Standard „Kartenmitte“')
    pg.click(f'{seg} button[data-wert=position]')
    check(json.loads(ls(pg, 'watermap.naehe.bezug') or '{}').get('art') == 'position' and pg.evaluate("window.__watermap.state.view") == 'mehr', f'{tag}: Bezugspunkt gespeichert')
    frei = pg.inner_text('#mehrseite .ei-reihe:has-text("Standortfreigabe")')
    check(('Blockiert' in frei) or pg.locator('#mehrseite .ei-knopf:has-text("Erlauben")').is_visible(), f'{tag}: Standortfreigabe ohne Erlaubnis ({frei!r})')

    # Startausschnitt „Letzte Ansicht“: wird gemerkt und beim Start genutzt
    pg.click('#mehrseite .ei-seg[aria-label="Ausschnitt beim Start"] button[data-wert=letzte]')
    check(json.loads(ls(pg, 'watermap.start')) == 'letzte' and ls(pg, 'watermap.ansicht'), f'{tag}: „Letzte Ansicht“ speichert die Ansicht')
    pg.evaluate("localStorage.setItem('watermap.ansicht', JSON.stringify({ lat: 53.55, lon: 9.99, zoom: 12 }))")
    pg.goto(uf.BASE + '#karte'); pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(600)
    c = pg.evaluate("[window.__watermap.state.map.getCenter(), window.__watermap.state.map.getZoom()]")
    check(abs(c[0]['lat'] - 53.55) < 0.01 and abs(c[0]['lon'] - 9.99) < 0.01 and c[1] == 12, f'{tag}: Start mit der letzten Ansicht ({c})')
    pg.evaluate("localStorage.setItem('watermap.ansicht', JSON.stringify({ lat: 51.5, lon: -0.12, zoom: 10 }))")   # London: außerhalb
    pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(600)
    c = pg.evaluate("window.__watermap.state.map.getCenter()")
    check(c['lon'] > 5, f'{tag}: Ansicht außerhalb des Gebiets wird nicht genutzt ({c})')

    # Ausgeblendete Meldungen wieder zeigen
    pg.evaluate("localStorage.setItem('watermap.meldungen.ausgeblendet', JSON.stringify(['m1', 'm2']))")
    pg.goto(uf.BASE + '#mehr/einstellungen'); pg.wait_for_selector('#mehrseite .ei-seite')
    check('2 Meldungen, die du als unpassend markiert hast' in pg.inner_text('#mehrseite'), f'{tag}: Anzahl ausgeblendeter Meldungen')
    pg.click('#mehrseite .ei-knopf:has-text("Wieder zeigen")'); pg.wait_for_timeout(100)
    check(ls(pg, 'watermap.meldungen.ausgeblendet') is None and 'Keine' in pg.inner_text('#mehrseite') and pg.locator('#mehrseite .ei-knopf:has-text("Wieder zeigen")').count() == 0,
          f'{tag}: ausgeblendete Meldungen zurückgesetzt')

    # Offline-Daten aktualisieren
    pg.click('#mehrseite .ei-knopf:has-text("Aktualisieren")'); pg.wait_for_selector('#mehrseite .ei-knopf:has-text("Aktualisieren"):not([disabled])')
    check('Daten aktualisiert' in pg.inner_text('#toast') and 'Standorte vom' in pg.inner_text('#mehrseite .ei-stand'), f'{tag}: Daten aktualisiert ({pg.inner_text("#mehrseite .ei-stand")})')

    # Alles zurücksetzen: Rückfrage, Abbrechen, dann löschen (Geräte-ID bleibt)
    pg.evaluate("localStorage.setItem('watermap.favorites.v1', '[\"node/1\"]'); localStorage.setItem('watermap.geraet', 'abc')")
    pg.click('#mehrseite .ei-rot'); pg.wait_for_selector('#dlg[open]')
    check('Alles zurücksetzen?' in pg.inner_text('#dlg') and 'Pegel-Alarme per Mail bleiben' in pg.inner_text('#dlg'), f'{tag}: Rückfrage vor dem Zurücksetzen')
    pg.click('#dlg .btn-outline:has-text("Abbrechen")'); pg.wait_for_timeout(100)
    check(ls(pg, 'watermap.boot') is not None, f'{tag}: Abbrechen löscht nichts')
    pg.click('#mehrseite .ei-rot'); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlg .btn-gefahr'); pg.wait_for_load_state('load'); pg.wait_for_selector('#mehrseite .ei-profil')
    rest = pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('watermap.') && !['watermap.cats', 'watermap.pegel.stand', 'watermap.meldungen.aktiv'].includes(k))")
    check(rest == ['watermap.geraet'] and ls(pg, 'watermap.geraet') == 'abc', f'{tag}: alles gelöscht außer Geräte-ID ({rest})')
    check(pg.evaluate('location.hash') == '#mehr' and 'Motorboot' in pg.inner_text('#mehrseite .ei-profil'), f'{tag}: nach dem Zurücksetzen „Mehr“ mit Standardwerten')

    # Zurück-Pfeil
    pg.goto(uf.BASE + '#mehr/einstellungen'); pg.wait_for_selector('#mehrseite .ei-seite')
    pg.click('#mehrseite .bs-zurueck'); pg.wait_for_selector('#mehrseite .ei-profil')
    check(pg.evaluate('location.hash') == '#mehr', f'{tag}: Zurück führt zu „Mehr“')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Mit Freigabe: Status „Erlaubt“, Start „Meine Position“ ortet ohne Dialog
    ctx, pg = page(b, w, hh, mobile, geo={'latitude': 50.94, 'longitude': 6.96})
    pg.add_init_script("try { localStorage.setItem('watermap.start', JSON.stringify('position')); } catch {}")
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(1200)
    check(pg.evaluate("!!window.__watermap.state.user"), f'{tag}: Start „Meine Position“ ortet bei bestehender Freigabe')
    pg.goto(uf.BASE + '#mehr/einstellungen'); pg.wait_for_selector('#mehrseite .ei-status.is-ok')
    check('Erlaubt' in pg.inner_text('#mehrseite .ei-status'), f'{tag}: Standortfreigabe „Erlaubt“')
    check(not pg.errs, f'{tag}: keine JS-Fehler mit Freigabe {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(375, 667), (390, 844), (1024, 768), (1440, 900)]:
                run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
