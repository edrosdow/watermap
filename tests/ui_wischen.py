"""UI-Test „Wischen nach unten schließt Fenster“ (Handy): Filter, Melden-Menü, Standort-Blatt, Wetter-Fenster, Pegel-Fenster –
mit echten Touch-Ereignissen (CDP). Kurz/langsam wischen federt zurück, Wischen im gescrollten Inhalt scrollt, Seitwärts/Diagramm nicht.
Start: python3 tests/ui_wischen.py [screenshots-ordner]"""
import importlib.util, json, pathlib, tempfile, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_nav', HERE / 'ui_nav.py')
src = (HERE / 'ui_nav.py').read_text(encoding='utf-8').split("with tempfile.TemporaryDirectory()")[0]
ns = {'__file__': str(HERE / 'ui_nav.py'), '__name__': 'ui_nav_lib'}; exec(compile(src, 'ui_nav.py', 'exec'), ns)
uf, page, warte, rect = ns['uf'], ns['page'], ns['warte'], ns['rect']
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def wisch(pg, x, y0, dy, schritte=8, pause=12, dx=0, loslassen=True):
    c = pg.context.new_cdp_session(pg)
    pt = lambda i: [{'x': x + dx * i / schritte, 'y': y0 + dy * i / schritte}]
    c.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt(0)})
    for i in range(1, schritte + 1):
        c.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pt(i)}); pg.wait_for_timeout(pause)
    if loslassen: c.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    pg.wait_for_timeout(500)

def run(b, w, hh):
    tag = f'{w}px'; print(f'--- {tag}')
    ctx, pg = page(b, w, hh)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(700)
    # Filter-Blatt
    pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]'); pg.wait_for_timeout(300)
    r = rect(pg, '#filter-panel')
    wisch(pg, w / 2, r['y'] + 20, 40, schritte=4, pause=60)
    check(pg.evaluate("document.querySelector('#filter-panel').open") and pg.evaluate("document.querySelector('#filter-panel').style.transform") == '', f'{tag}: Filter: kurz und langsam gewischt → bleibt offen, federt zurück')
    wisch(pg, w / 2, r['y'] + 20, 200)
    check(not pg.evaluate("document.querySelector('#filter-panel').open") and pg.evaluate("document.querySelector('#filter-panel').style.transform") == '', f'{tag}: Filter: nach unten gewischt → geschlossen, Transform zurückgesetzt')
    pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]'); pg.wait_for_timeout(300)
    check(rect(pg, '#filter-panel')['y'] + rect(pg, '#filter-panel')['h'] >= hh - 2, f'{tag}: Filter öffnet danach wieder normal am unteren Rand')
    r = rect(pg, '#filter-panel')
    # Wischen im Inhalt (ganz oben) schließt auch
    wisch(pg, w / 2, r['y'] + r['h'] / 2, 220, dx=10)
    check(not pg.evaluate("document.querySelector('#filter-panel').open"), f'{tag}: Filter: Wischen mitten im Inhalt (oben angekommen) schließt')
    # Seitwärts wischen schließt nicht
    pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]'); pg.wait_for_timeout(300)
    r = rect(pg, '#filter-panel')
    wisch(pg, w / 2, r['y'] + 30, 20, dx=150)
    check(pg.evaluate("document.querySelector('#filter-panel').open"), f'{tag}: seitwärts gewischt → bleibt offen')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # Melden-Menü
    pg.click('#bottomnav [data-nav=melden]'); pg.wait_for_selector('#report-menu.is-offen'); pg.wait_for_timeout(300)
    pg.wait_for_timeout(300); r = rect(pg, '#report-menu'); wisch(pg, w / 2, r['y'] + 12, 560); pg.wait_for_timeout(500)
    check(pg.locator('#report-menu').count() == 0, f'{tag}: Melden-Sheet: nach unten gewischt → geschlossen')
    # Standort-Detail (Blatt)
    pg.evaluate("window.__watermap.selectPlace('node/7000', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(400)
    pg.wait_for_timeout(300); r = rect(pg, '#detail'); wisch(pg, w / 2, r['y'] + 12, 560); pg.wait_for_timeout(300)
    check(pg.locator('#detail').count() == 0 and pg.evaluate('window.__watermap.state.selectedId') is None, f'{tag}: Standort-Sheet: nach unten gewischt → geschlossen, Auswahl aufgehoben')
    # Wetter-Fenster aus dem Detail
    pg.evaluate("window.__watermap.selectPlace('node/7000', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(400)
    pg.evaluate("window.__watermap.selectPlace(window.__watermap.state.places.find(p => p.type === 'slip').id, { full: true })"); pg.wait_for_timeout(400)
    z = pg.locator('#detail .wxz')
    if z.count():
        z.first.click(); pg.wait_for_selector('.wm-sheet.wxd-wetter.is-offen'); pg.wait_for_timeout(500)
        r = rect(pg, '.wm-sheet.wxd-wetter'); wisch(pg, w / 2, r['y'] + 12, 560)
        pg.wait_for_timeout(300)
        check(pg.locator('.wm-sheet.wxd-wetter').count() == 0 and pg.locator('#detail').is_visible(), f'{tag}: Wetter-Sheet: nach unten gewischt → zu, Standort bleibt offen')
    else:
        check(False, f'{tag}: Wetter-Zeile nicht gefunden')
    # In der Nähe: Sheet über der Karte (Designumbau 3a) – Wischen am Griff nach unten oder die Zurück-Taste führt zur Karte
    NH = '.wm-sheet.nh-sheet'
    pg.goto(uf.BASE + '#karte'); pg.wait_for_timeout(300); pg.click('#btn-naehe-m'); pg.wait_for_selector(f'{NH} .place, {NH} .nh-leer'); pg.wait_for_timeout(600)
    r = rect(pg, NH)
    check(80 < r['y'] < 160 and abs(r['y'] + r['h'] - hh) <= 2, f'{tag}: In der Nähe: Sheet von unten, Karte und Suche darüber (oben bei {r["y"]:.0f} px)')
    pg.screenshot(path=str(uf.SHOTS / f'wischen_{w}_naehe.png'))
    wisch(pg, w / 2, r['y'] + 12, 400)
    pg.wait_for_timeout(300)
    check(pg.evaluate("location.hash") in ('', '#karte') and pg.locator(NH).count() == 0 and pg.get_attribute('#bottomnav [data-nav=karte]', 'aria-current') == 'page', f'{tag}: In der Nähe: nach unten gewischt → Karte')
    pg.click('#btn-naehe-m'); pg.wait_for_selector(f'{NH}.is-offen'); pg.wait_for_timeout(400)
    pg.go_back(); pg.wait_for_selector(NH, state='detached')
    check(pg.locator(NH).count() == 0, f'{tag}: In der Nähe: Zurück-Taste schließt das Sheet')
    # „X“ im globalen Suchfeld
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(300)
    check(pg.locator('.search .such-x').is_hidden(), f'{tag}: Suchfeld leer → kein „X“')
    pg.fill('#q', 'Rhein'); pg.wait_for_timeout(100)
    xb, qb = pg.locator('.search .such-x').bounding_box(), pg.locator('#q').bounding_box()
    check(pg.locator('.search .such-x').is_visible() and xb['x'] + xb['width'] <= qb['x'] + qb['width'] - 30, f'{tag}: „X“ im Suchfeld (links vom Lupen-Knopf)')
    pg.click('.search .such-x'); pg.wait_for_timeout(150)
    check(pg.input_value('#q') == '' and pg.locator('.search .such-x').is_hidden() and pg.evaluate("document.activeElement.id") == 'q', f'{tag}: „X“ leert das Suchfeld, Fokus bleibt')
    pg.errs and print(pg.errs[:3])
    check(not pg.errs, f'{tag}: keine Konsolenfehler')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(375, 667), (390, 844)]: run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
