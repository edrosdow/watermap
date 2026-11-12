"""UI-Test „Passt mein Boot?“ (Designumbau Phase 2b, 7.71.0) – ersetzt ui_ampel.py (alte Seite Pegel-Ampel).
Abschnitt im Pegel-Sheet (ohne Mindestpegel Zeile → Formular −/+ 5 cm, Bootstyp, Speichern, Ändern, Entfernen, Fehler),
Übernahme aus watermap.ampel, Ampel in „Gemerkt“ und Einstellungen, Vorschlag im Alarm-Fenster,
Einstiegsseite /pegel-ampel (Inhalt, ?pegel= und #am-alarm leiten weiter, Links aus den Alarm-Mails), #pegel/suche. 390 und 1440 px.
Start: python3 tests/ui_pegel_ampel.py [screenshots-ordner]"""
import json, pathlib, tempfile, urllib.parse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / 'ui_bereiche.py').read_text(encoding='utf-8').split('with tempfile.TemporaryDirectory() as t:')[0]
ns = {'__file__': str(HERE / 'ui_bereiche.py'), '__name__': 'ui_bereiche_lib'}; exec(compile(src, 'ui_bereiche.py', 'exec'), ns)
uf, page, G = ns['uf'], ns['page'], ns['G']   # Pegel Vlotho, 96 cm
SHOTS = uf.SHOTS
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

ENC = urllib.parse.quote(G)
S = '.wm-sheet.pks-sheet'

def warte(pg, ausdruck, ms=8000):
    for _ in range(ms // 100):
        if pg.evaluate(ausdruck): return True
        pg.wait_for_timeout(100)
    return False

def frisch(pg, adr):
    pg.goto('about:blank'); pg.goto(uf.BASE + adr)

def sheet_gross(pg, mobile):
    pg.wait_for_selector(S, timeout=60000)
    if mobile: pg.wait_for_selector(S + ' .pks-details'); pg.click(S + ' .pks-details')
    pg.wait_for_selector(S + ' .pmb', timeout=8000); pg.wait_for_timeout(500)

def run(b, w, hh):
    mobile = w < 768; tag = f'{w}px'; print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile)
    alarm_calls = []
    def alarm_api(route):
        body = json.loads(route.request.post_data or '{}'); alarm_calls.append(body)
        extra = {'pegelName': 'Vlotho', 'art': 'schwelle', 'richtung': 'unter', 'wert': 90} if body.get('aktion') == 'bestaetigen' else {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, **extra}))
    ctx.route('**/.netlify/functions/pegel-alarm', alarm_api)
    pg.add_init_script("try { localStorage.setItem('wm-nav-labels-gesehen', '1'); } catch {}")

    # ---- Übernahme aus der alten Pegel-Ampel (einmalig)
    pg.goto(uf.BASE + 'ueber.html')
    pg.evaluate(f"localStorage.setItem('watermap.ampel', JSON.stringify({{ pegel: '{G}', min: 150, boot: 'segel', hoehe: 2 }}))")
    frisch(pg, f'#karte/pegel/{ENC}'); sheet_gross(pg, mobile)
    t = pg.inner_text(S + ' .pmb')
    check('Zu niedrig – 54 cm unter deinem Mindestpegel' in t and 'Mindestpegel 150 cm' in t and 'Segelboot' in t, f'{tag}: Übernahme aus watermap.ampel ({t!r})')
    check(pg.locator(S + ' .pmb .wm-hinweis.is-stop').count() == 1, f'{tag}: Hinweiszeile im Zustand „stop“')
    check(json.loads(pg.evaluate("localStorage.getItem('watermap.mindestpegel')")) == {G: 150}, f'{tag}: watermap.mindestpegel geschrieben')
    check(pg.locator(S + ' a[href*="pegel-ampel"]').count() == 0, f'{tag}: kein Link mehr auf die Ampel-Seite')
    # Reihenfolge: direkt unter der Aktionsleiste, vor dem Verlauf
    reihe = pg.locator(S + ' .pd').evaluate("""p => { const a = p.querySelector('.pd-knoepfe'), m = p.querySelector('.pmb'), v = p.querySelector('.pd-verlauf');
        return !!(a.compareDocumentPosition(m) & 4) && !!(m.compareDocumentPosition(v) & 4); }""")
    check(reihe, f'{tag}: Abschnitt zwischen Aktionsleiste und Verlauf')
    pg.locator(S + ' .pmb').screenshot(path=str(SHOTS / f'pmb_{w}_mit.png'))

    # ---- Ändern → Entfernen → Zeile „Mindestpegel festlegen“
    pg.click(S + ' .pmb .wm-hinweis-aktion'); pg.wait_for_selector(S + ' .pmb-form')
    check(pg.input_value(S + ' .pmb-wert') == '150' and pg.locator(S + ' .pmb-entfernen').count() == 1, f'{tag}: Formular mit 150 cm und „Entfernen“')
    check(pg.evaluate("document.activeElement?.classList.contains('pmb-wert')"), f'{tag}: Fokus im Feld')
    pg.click(S + ' .pmb-entfernen'); pg.wait_for_timeout(300)
    check(pg.locator(S + ' .pmb .wm-zeile').count() == 1 and 'Mindestpegel festlegen' in pg.inner_text(S + ' .pmb'), f'{tag}: entfernt → Zeile „Mindestpegel festlegen“')
    check(json.loads(pg.evaluate("localStorage.getItem('watermap.mindestpegel')")) == {}, f'{tag}: Speicher leer, keine zweite Übernahme')
    pg.locator(S + ' .pmb').screenshot(path=str(SHOTS / f'pmb_{w}_ohne.png'))

    # ---- Festlegen: Vorbelegung, −/+ 5 cm, Fehler, Bootstyp, Speichern
    pg.click(S + ' .pmb .wm-zeile'); pg.wait_for_selector(S + ' .pmb-form')
    check(pg.input_value(S + ' .pmb-wert') == '95', f'{tag}: vorbelegt mit dem gerundeten Pegel ({pg.input_value(S + " .pmb-wert")})')
    check(pg.locator(S + ' .pmb .wm-seg button[aria-pressed=true]').inner_text() == 'Segelboot', f'{tag}: Bootstyp aus den Einstellungen vorbelegt')
    check(pg.locator(S + ' .pmb-entfernen').count() == 0, f'{tag}: ohne Mindestpegel kein „Entfernen“')
    pg.click(S + ' .pmb-pm[aria-label="5 cm mehr"]'); pg.click(S + ' .pmb-pm[aria-label="5 cm mehr"]'); pg.click(S + ' .pmb-pm[aria-label="5 cm weniger"]')
    check(pg.input_value(S + ' .pmb-wert') == '100', f'{tag}: −/+ in 5-cm-Schritten')
    pg.fill(S + ' .pmb-wert', ''); pg.click(S + ' .pmb button[type=submit]')
    check(pg.get_attribute(S + ' .pmb-wert', 'aria-invalid') == 'true' and 'zwischen' in pg.inner_text(S + ' .pmb .wm-feld-fehler'), f'{tag}: leeres Feld → Fehler am Feld')
    pg.locator(S + ' .pmb-form').screenshot(path=str(SHOTS / f'pmb_{w}_form.png'))
    pg.fill(S + ' .pmb-wert', '80'); pg.click(S + ' .pmb .wm-seg button[data-wert=kanu]'); pg.click(S + ' .pmb button[type=submit]'); pg.wait_for_timeout(300)
    t = pg.inner_text(S + ' .pmb')
    check('Knapp – 16 cm über deinem Mindestpegel' in t and 'Kanu/SUP' in t and pg.locator(S + ' .pmb .wm-hinweis.is-warn').count() == 1, f'{tag}: gespeichert → „Knapp“ ({t!r})')
    check(json.loads(pg.evaluate("localStorage.getItem('watermap.boot')")).get('typ') == 'kanu', f'{tag}: Bootstyp in watermap.boot')
    check(pg.evaluate("document.activeElement?.classList.contains('wm-hinweis-aktion')"), f'{tag}: Fokus danach auf „Ändern“')
    pg.click(S + ' .pmb .wm-hinweis-aktion'); pg.fill(S + ' .pmb-wert', '60'); pg.click(S + ' .pmb .wm-btn.is-leise:not(.pmb-entfernen)'); pg.wait_for_timeout(200)
    check('Knapp – 16 cm' in pg.inner_text(S + ' .pmb'), f'{tag}: „Abbrechen“ lässt den Wert')
    pg.click(S + ' .pmb .wm-hinweis-aktion'); pg.fill(S + ' .pmb-wert', '60'); pg.press(S + ' .pmb-wert', 'Enter'); pg.wait_for_timeout(200)
    check('Passt – 36 cm über deinem Mindestpegel' in pg.inner_text(S + ' .pmb') and pg.locator(S + ' .pmb .wm-hinweis.is-gut').count() == 1, f'{tag}: Enter speichert → „Passt“')

    # ---- Alarm-Fenster schlägt den Mindestpegel vor
    pg.click(S + ' .pd-alarm'); pg.wait_for_selector('.wm-sheet.wxd-alarm.is-offen')
    check(pg.input_value('#al-wert') == '60' and pg.locator('.al-r[data-r=unter][aria-pressed=true]').count() == 1 and 'Mindestpegel (60 cm)' in pg.inner_text('.wm-sheet.wxd-alarm'),
          f'{tag}: Alarm-Fenster schlägt „unter 60 cm“ vor')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(700)

    # ---- Gemerkt: Ampel als Marke rechts
    pg.evaluate(f"localStorage.setItem('watermap.meinePegel', JSON.stringify(['{G}']))")
    frisch(pg, '#gemerkt'); pg.wait_for_selector('.gm-sheet .wm-zeile .wm-marke', timeout=30000)
    m = pg.locator('.gm-sheet .wm-zeile .wm-marke')
    check(m.inner_text() == 'Passt' and 'is-gut' in m.get_attribute('class') and '96 cm' in pg.inner_text('.gm-sheet .wm-zeile:has(.wm-marke)'), f'{tag}: „Gemerkt“ zeigt „Passt“ und den Wert in der Unterzeile')

    # ---- Einstellungen: Mindestpegel-Zeile, kein Ampel-Alarm mehr
    frisch(pg, '#mehr/einstellungen'); pg.wait_for_selector('.ei-seite', timeout=30000); pg.wait_for_timeout(500)
    et = pg.inner_text('.ei-seite')
    check('Ampel-Alarm' not in et and pg.locator('a[href*="pegel-ampel"]').count() == 0, f'{tag}: Einstellungen ohne „Ampel-Alarm (Pegel-Ampel)“')
    zl = pg.locator('.ei-mindest')
    check(zl.count() == 1 and 'Mindestpegel 60 cm' in zl.inner_text() and zl.locator('a').get_attribute('href') == f'#karte/pegel/{ENC}', f'{tag}: Einstellungen listen den Mindestpegel mit Link zum Pegel')

    # ---- Einstiegsseite
    pg.goto(uf.BASE + 'pegel-ampel.html'); pg.wait_for_selector('h1')
    check('Passt mein Boot' in pg.inner_text('h1') and pg.locator('link[rel=canonical]').get_attribute('href') == 'https://watermaps.netlify.app/pegel-ampel', f'{tag}: Einstiegsseite mit Titel und canonical')
    check(pg.locator('.am-hero, #am-q').count() == 0 and pg.get_attribute('#pa-suchen', 'href') == './#pegel/suche', f'{tag}: kein Navy-Kopf, Knopf „Pegel suchen“')
    check(pg.get_attribute('meta[name=theme-color]', 'content') == '#0B3045', f'{tag}: theme-color wie die App')
    pg.screenshot(path=str(SHOTS / f'einstieg_{w}.png'), full_page=True)
    pg.click('#pa-suchen'); pg.wait_for_selector('.leaflet-container', timeout=60000)
    check(warte(pg, "document.activeElement?.id === 'q'") and pg.get_attribute('#cats [data-cat=pegel]', 'aria-pressed') == 'true', f'{tag}: „Pegel suchen“ → Karte, Pegel an, Suche aktiv')
    frisch(pg, f'pegel-ampel.html?pegel={ENC}&min=40'); pg.wait_for_selector(S, timeout=60000)
    check(f'#karte/pegel/{G}' in urllib.parse.unquote(pg.url) and 'pegel-ampel' not in pg.url, f'{tag}: ?pegel= leitet ins Pegel-Sheet ({pg.url[-60:]})')
    frisch(pg, f'pegel-ampel.html?pegel={ENC}#am-alarm'); pg.wait_for_selector('.wm-sheet.wxd-alarm.is-offen', timeout=60000)
    check(pg.locator(S).count() == 1, f'{tag}: #am-alarm → Pegel-Sheet mit Alarm-Fenster')
    pg.keyboard.press('Escape')
    # Links aus den Mails (Bestätigen/Abbestellen) laufen weiter über die Einstiegsseite
    alarm_calls.clear()
    pg.goto(uf.BASE + f'pegel-ampel.html?alarm-bestaetigen=tok123'); pg.wait_for_selector('#pa-meldung:not([hidden]):has-text("aktiv")', timeout=8000)
    check(alarm_calls == [{'aktion': 'bestaetigen', 'token': 'tok123'}] and 'tok123' not in pg.url and 'Vlotho' in pg.inner_text('#pa-meldung'), f'{tag}: Bestätigungslink aus der Mail')
    pg.goto(uf.BASE + f'pegel-ampel.html?pegel={ENC}&min=40&alarm-abmelden=tok9'); pg.wait_for_selector('#pa-meldung:has-text("abbestellt")', timeout=8000)
    check(alarm_calls[-1] == {'aktion': 'abmelden', 'token': 'tok9'} and 'pegel-ampel' in pg.url and pg.get_attribute('#pa-suchen', 'href') == f'./#karte/pegel/{ENC}',
          f'{tag}: Abmeldelink (Ampel-Alarm) bleibt auf der Seite, Knopf „Pegel ansehen“')
    check(not pg.errs, f'{tag}: keine Fehler in der Konsole {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(390, 844), (1440, 900)]: run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print(f'\n{len(problems)} Probleme' if problems else '\nAlle Prüfungen bestanden', '· Bilder:', SHOTS)
raise SystemExit(1 if problems else 0)
