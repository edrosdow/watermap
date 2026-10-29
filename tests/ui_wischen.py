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
    pg.click('#bottomnav [data-nav=melden]'); pg.wait_for_selector('#report-menu[open]'); pg.wait_for_timeout(300)
    r = rect(pg, '#report-menu'); wisch(pg, w / 2, r['y'] + 20, 220)
    check(not pg.evaluate("document.querySelector('#report-menu').open"), f'{tag}: Melden-Menü: nach unten gewischt → geschlossen')
    # Standort-Detail (Blatt)
    pg.evaluate("window.__watermap.selectPlace('node/7000', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(400)
    r = rect(pg, '#detail'); wisch(pg, w / 2, r['y'] + 25, 260)
    check(pg.locator('#detail').is_hidden(), f'{tag}: Standort-Blatt: nach unten gewischt → geschlossen')
    # Wetter-Fenster aus dem Detail
    pg.evaluate("window.__watermap.selectPlace('node/7000', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(400)
    pg.evaluate("window.__watermap.selectPlace(window.__watermap.state.places.find(p => p.type === 'slip').id, { full: true })"); pg.wait_for_timeout(400)
    z = pg.locator('#detail .wxz')
    if z.count():
        z.first.click(); pg.wait_for_selector('dialog.wxd[open]'); pg.wait_for_timeout(400)
        r = rect(pg, 'dialog.wxd'); wisch(pg, w / 2, r['y'] + 14, 260)
        check(pg.locator('dialog.wxd[open]').count() == 0 and pg.locator('#detail').is_visible(), f'{tag}: Wetter-Fenster: nach unten gewischt → zu, Standort bleibt offen')
    else:
        check(False, f'{tag}: Wetter-Zeile nicht gefunden')
    # In der Nähe: Fenster über der Karte (Handy) – Wischen nach unten oder Karte antippen führt zurück zur Karte
    pg.goto(uf.BASE + '#naehe'); pg.wait_for_selector('.sidebar .place, .sidebar .nh-leer, .sidebar .nh-zeile1'); pg.wait_for_timeout(500)
    r = rect(pg, '#naehe-kopf-m'); sb = rect(pg, '.sidebar')
    check(10 < r['y'] < 40 and abs(sb['y'] - (r['y'] + r['h'])) <= 2 and abs(sb['y'] + sb['h'] - hh) <= 2, f'{tag}: In der Nähe: Kopf und Liste bilden ein Fenster unten, Karte als Streifen darüber (Kopf bei {r["y"]:.0f} px)')
    pg.screenshot(path=str(uf.SHOTS / f'wischen_{w}_naehe.png'))
    wisch(pg, w / 2, r['y'] + 30, 260)
    check(pg.evaluate("location.hash") in ('', '#karte') and not pg.evaluate("document.body.classList.contains('view-naehe')"), f'{tag}: In der Nähe: nach unten gewischt → Karte')
    pg.goto(uf.BASE + '#naehe'); pg.wait_for_selector('.sidebar .place, .sidebar .nh-leer, .sidebar .nh-zeile1'); pg.wait_for_timeout(400)
    pg.touchscreen.tap(w / 2, 10); pg.wait_for_timeout(300)
    check(not pg.evaluate("document.body.classList.contains('view-naehe')"), f'{tag}: In der Nähe: Tipp auf die Karte oberhalb schließt')
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
