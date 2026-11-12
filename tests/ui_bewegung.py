"""UI-Test „Bewegung“ (Designumbau Phase 4, 7.73.0): Lupe → Suchfeld (Handy, aria-expanded, Fokus, Escape), Chips behalten ihre Knöpfe
(Punkt/Häkchen gleiten), Marker ploppen ein, Merken mit Stern-Flug zu „Gemerkt“ und Abzeichen-Sprung, Umschalter gleitet (wm-seg),
Pegelwert zählt hoch, Kurve zeichnet sich, Listen erscheinen versetzt, „Bewegung reduzieren“: kein Flug, kein Zählen.
Start: python3 tests/ui_bewegung.py [screenshots-ordner]"""
import pathlib, tempfile, urllib.parse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / 'ui_bereiche.py').read_text(encoding='utf-8').split('with tempfile.TemporaryDirectory() as t:')[0]
ns = {'__file__': str(HERE / 'ui_bereiche.py'), '__name__': 'ui_bereiche_lib'}; exec(compile(src, 'ui_bereiche.py', 'exec'), ns)
uf, page, G = ns['uf'], ns['page'], ns['G']
SHOTS = uf.SHOTS
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def run(b, w, hh, reduziert=False):
    mobile = w < 768; tag = f'{w}px' + (' reduziert' if reduziert else ''); print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile)
    if reduziert: pg.emulate_media(reduced_motion='reduce')
    pg.add_init_script("try { localStorage.setItem('wm-nav-labels-gesehen', '1'); } catch {}")
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container', timeout=60000); pg.wait_for_timeout(1200)

    # 1) Lupe → Suchfeld
    lupe = pg.locator('.search-btn')
    if mobile:
        check(lupe.get_attribute('aria-expanded') == 'false' and pg.get_attribute('#q', 'tabindex') == '-1' and pg.locator('#search-form').bounding_box()['width'] <= 49,
              f'{tag}: Suche zu – runde Lupe, Feld nicht per Tab erreichbar')
        lupe.click(); pg.wait_for_timeout(700)
        check(lupe.get_attribute('aria-expanded') == 'true' and pg.evaluate("document.activeElement.id") == 'q' and pg.locator('#search-form').bounding_box()['width'] > w * 0.85,
              f'{tag}: Lupe → Pille auf volle Breite, Fokus im Feld')
        check(pg.evaluate("getComputedStyle(document.querySelector('.toolbar')).opacity") == '0', f'{tag}: Chips gleiten weg')
        pg.fill('#q', 'TEST'); pg.wait_for_selector('#suggest:not([hidden]) li')
        pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(700)
        check(lupe.get_attribute('aria-expanded') == 'false' and pg.evaluate("document.activeElement.classList.contains('search-btn')") and pg.input_value('#q') == '',
              f'{tag}: Escape – alles rückwärts, Fokus zurück auf die Lupe')
    else:
        check(pg.locator('#search-form').bounding_box()['width'] > 300 and pg.get_attribute('#q', 'tabindex') == '0', f'{tag}: Desktop – Suchfeld offen in der Kopfleiste')

    # 5) Chips: derselbe Knopf bleibt (Punkt/Häkchen gleiten)
    pg.evaluate("document.querySelector('#cats [data-cat=marina]').dataset.merke = '1'")
    pg.click('#cats [data-cat=marina]'); pg.wait_for_timeout(80)
    check(pg.get_attribute('#cats [data-cat=marina]', 'data-merke') == '1' and pg.get_attribute('#cats [data-cat=marina]', 'aria-pressed') == 'true', f'{tag}: Chip bleibt derselbe Knopf beim Umschalten')
    # 3) Marker ploppen ein (nicht bei „Bewegung reduzieren“)
    n = pg.locator('.wm-plopp').count()
    check((n == 0) if reduziert else (0 < n <= 30), f'{tag}: Marker ploppen ein ({n}, höchstens 30)')
    pg.wait_for_timeout(2500)

    # 4) Merken: Stern-Flug zu „Gemerkt“, Abzeichen springt
    pg.evaluate("window.__watermap.selectPlace('node/1', { full: true })"); pg.wait_for_selector('#detail .fav'); pg.wait_for_timeout(700)
    pg.click('#detail .fav'); pg.wait_for_timeout(150)
    flug = pg.locator('.wm-flug').count()
    check(flug == (0 if reduziert else 1), f'{tag}: {"kein Flug" if reduziert else "Stern fliegt zu „Gemerkt“"} ({flug})')
    pg.screenshot(path=str(SHOTS / f'bewegung_{w}{"_r" if reduziert else ""}_flug.png'))
    pg.wait_for_timeout(1000)
    check(pg.locator('.wm-flug').count() == 0 and pg.get_attribute('#detail .fav', 'aria-pressed') == 'true', f'{tag}: Flug beendet, gemerkt')
    pg.click('#detail .fav'); pg.wait_for_timeout(300)
    check('entfernt' in pg.inner_text('#toast') and pg.locator('#toast .toast-aktion').inner_text() == 'Rückgängig' and pg.locator('.wm-flug').count() == 0,
          f'{tag}: Entfernen ohne Flug, Toast mit „Rückgängig“')
    pg.click('#toast .toast-aktion'); pg.wait_for_timeout(300)
    check(pg.get_attribute('#detail .fav', 'aria-pressed') == 'true', f'{tag}: „Rückgängig“ merkt wieder')

    # 8) Pegelwert zählt hoch, Kurve zeichnet sich; 6) Umschalter gleitet
    pg.goto('about:blank'); pg.goto(uf.BASE + f'#karte/pegel/{urllib.parse.quote(G)}'); pg.wait_for_selector('.pks-sheet', timeout=60000)
    if mobile: pg.wait_for_selector('.pks-sheet .pks-details'); pg.click('.pks-sheet .pks-details')
    pg.wait_for_selector('.pks-sheet .pd-wert strong'); pg.wait_for_timeout(60)
    erst = pg.inner_text('.pks-sheet .pd-wert strong')
    pg.wait_for_timeout(900)
    check(pg.inner_text('.pks-sheet .pd-wert strong') == '96' and (erst == '96' if reduziert else erst != '96'), f'{tag}: großer Wert {"sofort" if reduziert else "zählt hoch"} ({erst} → 96)')
    seg = pg.locator('.pks-sheet .pd-umschalter')
    check(seg.locator('.wm-seg-ind').count() == 1 and 'wm-seg' in seg.get_attribute('class'), f'{tag}: Zeitraum-Umschalter mit gleitender Markierung')
    seg.locator('button[data-bereich="24h"]').click(); pg.wait_for_timeout(100)
    check('--i: 0' in seg.get_attribute('style').replace('--i:0', '--i: 0'), f'{tag}: Markierung gleitet zur Wahl (--i)')
    # 9) Listen erscheinen versetzt
    pg.goto('about:blank'); pg.goto(uf.BASE + '#mehr'); pg.wait_for_selector('.mh-sheet .wm-zeile', timeout=60000)
    d = pg.locator('.mh-sheet .wm-zeile').evaluate_all("els => els.map(e => e.style.animationDelay)")
    check((all(x in ('', '0ms') for x in d)) if reduziert else (d[:3] == ['0ms', '55ms', '110ms']), f'{tag}: Zeilen erscheinen versetzt ({d[:3]})')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run(b, 390, 844); run(b, 1440, 900); run(b, 390, 844, reduziert=True)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
raise SystemExit(1 if problems else 0)
