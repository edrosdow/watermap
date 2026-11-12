"""UI-Test „Pegel auf der Hauptkarte“ (Designumbau Phase 2a, 7.70.0): Chip „Pegel“ an/aus (Marker, Legende, mindestens eine Ebene),
Marker-Tipp öffnet das Pegel-Sheet (Handy klein → Details groß, Desktop Panel rechts), Schließen setzt Auswahl und Adresse zurück,
Weiterleitungen der alten Pegel-Adressen (#pegel, #pegel/<id>, #karte/pegel/<id>, #pf=<id>, #pegel/fluss/<name>, #pegel/karte),
Hauptsuche findet Pegel und Gewässer, Navigation Karte · Meldungen · Melden · Gemerkt · Mehr. 390 und 1440 px, mit nachgebildeter API.
Start: python3 tests/ui_pegel_karte.py [screenshots-ordner]"""
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

def warte(pg, ausdruck, ms=6000):
    for _ in range(ms // 100):
        if pg.evaluate(ausdruck): return True
        pg.wait_for_timeout(100)
    return False

ENC = urllib.parse.quote(G)
SHEET = '.wm-sheet.pks-sheet'

def run(b, w, hh):
    mobile = w < 768; tag = f'{w}px'; print(f'--- {tag}')
    ctx, pg = page(b, w, hh, mobile)
    pg.add_init_script("try { localStorage.setItem('wm-nav-labels-gesehen', '1'); } catch {}")
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(800)

    # Navigation
    nav = '#bottomnav' if mobile else '#topnav'
    ids = pg.locator(f'{nav} [data-nav]').evaluate_all("els => els.map(e => e.dataset.nav)")
    check(ids == (['karte', 'meldungen', 'melden', 'gemerkt', 'mehr'] if mobile else ['karte', 'meldungen', 'gemerkt', 'mehr']), f'{tag}: Navigation {ids}')

    # Chip „Pegel“ an
    chip = pg.locator('#cats [data-cat=pegel]')
    check(chip.count() == 1 and chip.get_attribute('aria-pressed') == 'false' and pg.locator('#cats .cat-pegel .cat-punkt').count() == 1, f'{tag}: Chip „Pegel“ mit Farbpunkt, aus')
    check(pg.locator('#pk-legende').is_hidden(), f'{tag}: Legende aus, solange der Chip aus ist')
    chip.click(); warte(pg, "document.querySelectorAll('.pk-marker').length > 0")
    check(chip.get_attribute('aria-pressed') == 'true' and pg.locator('.pk-marker').count() == 1, f'{tag}: Chip an → Pegel-Marker auf der Karte')
    check(pg.locator('#pk-legende').is_visible() and 'zwischen MNW und MHW' in pg.locator('#pk-legende').inner_text(timeout=2000) if pg.locator('#pk-legende').evaluate("d => (d.open = true, true)") else False, f'{tag}: Legende sichtbar und aufklappbar')
    pg.locator('#pk-legende').evaluate("d => { d.open = false; }")
    check(pg.evaluate("localStorage.getItem('watermap.gauges')") == '1', f'{tag}: Chip-Zustand gespeichert')
    pg.click('#btn-filter'); pg.wait_for_selector('#filter-panel[open]')
    check('Pegelstände' not in pg.inner_text('#filter-panel'), f'{tag}: Filter ohne Schalter „Pegelstände“ (der Chip ersetzt ihn)')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # mindestens eine Ebene: alle Kategorien aus → Pegel lässt sich nicht ausschalten
    for t in pg.locator('#cats .cat[aria-pressed=true]:not([data-cat=pegel])').evaluate_all("els => els.map(e => e.dataset.cat)"):
        pg.click(f'#cats [data-cat={t}]'); pg.wait_for_timeout(150)
    check(pg.locator('#cats .cat[aria-pressed=true]').evaluate_all("els => els.map(e => e.dataset.cat)") == ['pegel'], f'{tag}: nur noch Pegel an')
    check(pg.locator('#cat-hint').is_hidden(), f'{tag}: kein Hinweis „Wähle oben …“, solange Pegel an ist')
    chip.click(); pg.wait_for_timeout(300)
    check(chip.get_attribute('aria-pressed') == 'true' and 'Mindestens eine Ebene' in pg.inner_text('#toast'), f'{tag}: letzte Ebene bleibt an (Hinweis)')
    pg.click('#cats [data-cat=slip]'); pg.wait_for_timeout(200)

    # Marker → Sheet
    pg.locator('.pk-marker').first.click(); pg.wait_for_selector(SHEET + '.is-offen'); pg.wait_for_timeout(700)
    info = pg.evaluate(f"""() => {{ const s = document.querySelector('{SHEET}'), r = s.getBoundingClientRect();
      return {{ titel: s.querySelector('#pd-name')?.textContent, unter: s.querySelector('.wm-kopf-unter')?.textContent, klein: s.classList.contains('is-klein'),
        kurz: !!s.querySelector('.pks-kurz'), details: !!s.querySelector('.pd'), r: [Math.round(r.left), Math.round(r.right), Math.round(r.width)],
        hash: location.hash, gewaehlt: !!document.querySelector('.pk-pille.is-gewaehlt') }}; }}""")
    check(info['titel'] == 'Vlotho' and info['unter'] == 'Pegel · Weser' and info['hash'] == f'#karte/pegel/{ENC}' and info['gewaehlt'],
          f'{tag}: Marker-Tipp öffnet das Pegel-Sheet (Titel, Unterzeile, Adresse, Marker gewählt) {info}')
    if mobile:
        check(info['klein'] and info['kurz'] and not info['details'], f'{tag}: Handy – Stufe klein mit Kurzansicht')
        db = pg.locator(SHEET + ' .pks-details').bounding_box(); nb = pg.locator('#bottomnav').bounding_box()
        check(db['y'] + db['height'] <= nb['y'] + 1, f'{tag}: „Details“ liegt über der Navigation {db} {nb}')
        pg.screenshot(path=str(SHOTS / f'pegelkarte_{w}_klein.png'))
        pg.click(SHEET + ' .pks-details'); pg.wait_for_timeout(700)
        g2 = pg.evaluate(f"() => {{ const s = document.querySelector('{SHEET}'); return {{ klein: s.classList.contains('is-klein'), details: !!s.querySelector('.pd .pd-verlauf'), griff: s.querySelector('.wm-griff').getAttribute('aria-expanded') }}; }}")
        check(not g2['klein'] and g2['details'] and g2['griff'] == 'true', f'{tag}: „Details“ → Stufe groß mit allen Details {g2}')
    else:
        check(info['details'] and info['r'][1] == w and info['r'][2] == 420, f'{tag}: Desktop – Panel rechts mit allen Details {info["r"]}')
    pg.screenshot(path=str(SHOTS / f'pegelkarte_{w}_gross.png'))
    # Teilen (8.0.4): kleines Sheet mit „Link teilen“ und „Als Bild teilen“
    pg.click(SHEET + ' .pd-teilen'); pg.wait_for_selector('.pd-teilen-sheet.is-offen'); pg.wait_for_timeout(500)
    zt = pg.locator('.pd-teilen-sheet .wm-zeile').all_inner_texts()
    check(len(zt) == 2 and 'Link teilen' in zt[0] and 'Als Bild teilen' in zt[1], f'{tag}: „Teilen“ öffnet „Pegel teilen“ mit Link und Bild {zt}')
    if not mobile:
        with pg.expect_download(timeout=15000) as dl: pg.locator('.pd-teilen-sheet .wm-zeile', has_text='Als Bild').click()
        pg.wait_for_timeout(600)
        check(dl.value.suggested_filename == 'Pegel-Vlotho.png' and pg.locator('.pd-teilen-sheet.is-offen').count() == 0 and pg.locator(SHEET + '.is-offen').count() == 1,
              f'{tag}: „Als Bild teilen“ lädt das Bild herunter, Teilen-Sheet zu, Pegel-Sheet bleibt')
    else:
        pg.click('.pd-teilen-sheet .wm-zu'); pg.wait_for_timeout(600)
        check(pg.locator('.pd-teilen-sheet.is-offen').count() == 0 and pg.locator(SHEET + '.is-offen').count() == 1, f'{tag}: × schließt nur „Pegel teilen“')
    pg.click(SHEET + ' .wm-zu'); pg.wait_for_timeout(700)
    check(pg.locator(SHEET).count() == 0 and pg.evaluate("location.hash") in ('', '#karte') and not pg.locator('.pk-pille.is-gewaehlt').count(), f'{tag}: × schließt, Auswahl und Adresse zurückgesetzt')

    # Weiterleitungen der alten Adressen
    ziele = [('#pegel', None), ('#pegel/karte', None), (f'#pegel/{ENC}', 'sheet'), (f'#karte/pegel/{ENC}', 'sheet'), (f'#pf={ENC}', 'sheet'), ('#pegel/fluss/weser', 'fluss')]
    for adr, erwartet in ziele:
        pg.evaluate("localStorage.setItem('watermap.gauges', '0')")
        pg.goto(uf.BASE + '#mehr'); pg.wait_for_timeout(300); pg.goto(uf.BASE + adr); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(1500)
        r = pg.evaluate(f"""() => ({{ karte: document.body.classList.contains('view-karte'), chip: document.querySelector('#cats [data-cat=pegel]')?.getAttribute('aria-pressed'),
          sheet: document.querySelector('{SHEET}.is-offen #pd-name')?.textContent || null, fluss: document.querySelector('.wm-sheet.pf-sheet #pf-name')?.textContent || null, hash: location.hash }})""")
        ok = r['karte'] and r['chip'] == 'true' and (r['sheet'] == 'Vlotho' if erwartet == 'sheet' else True) and (r['fluss'] == 'Weser' if erwartet == 'fluss' else True)
        check(ok, f'{tag}: alte Adresse {adr} → Karte mit Chip „Pegel“{", Pegel-Sheet" if erwartet == "sheet" else ", Fluss-Sheet" if erwartet == "fluss" else ""} {r}')
        if erwartet == 'fluss': pg.screenshot(path=str(SHOTS / f'pegelkarte_{w}_fluss.png'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(600)

    # Hauptsuche findet Pegel und Gewässer
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(500)
    pg.evaluate("localStorage.setItem('watermap.gauges', '0')"); pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(800)
    if mobile and not pg.locator('#q').is_visible(): pg.click('#search-form button, .search-btn')
    pg.fill('#q', 'vlot'); warte(pg, "[...document.querySelectorAll('#suggest .place-name')].some(e => e.textContent === 'Vlotho')")
    sub = pg.evaluate("[...document.querySelectorAll('#suggest .sg')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())")
    check(any(s.startswith('Vlotho') and 'Pegel · Weser' in s and '96 cm' in s for s in sub), f'{tag}: Suche „vlot“ findet den Pegel mit Wert {sub[:3]}')
    pg.locator('#suggest .sg', has_text='Pegel · Weser').first.click(); pg.wait_for_selector(SHEET + '.is-offen'); pg.wait_for_timeout(600)
    check(pg.locator('#cats [data-cat=pegel]').get_attribute('aria-pressed') == 'true' and pg.inner_text(SHEET + ' #pd-name') == 'Vlotho', f'{tag}: Pegel-Treffer schaltet Pegel ein und öffnet das Sheet')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(600)
    pg.fill('#q', 'wese'); warte(pg, "[...document.querySelectorAll('#suggest .place-sub')].some(e => e.textContent.startsWith('Gewässer'))")
    gew = pg.locator('#suggest .sg', has_text='Gewässer')
    check(gew.count() >= 1 and 'Weser' in gew.first.inner_text(), f'{tag}: Suche „wese“ findet das Gewässer')
    if gew.count(): gew.first.click(); pg.wait_for_timeout(600)
    check(pg.locator('#cats [data-cat=slip]').get_attribute('aria-pressed') == 'true' and pg.locator('#cats [data-cat=pegel]').get_attribute('aria-pressed') == 'true', f'{tag}: Gewässer-Treffer schaltet Pegel und Slipanlagen ein')

    # „Gemerkt“ öffnet das Sheet (Designumbau 3a)
    pg.click(f'{nav} [data-nav=gemerkt]'); pg.wait_for_timeout(600)
    check(pg.evaluate("location.hash") == '#gemerkt' and pg.locator('.wm-sheet.gm-sheet.is-offen').count() == 1 and pg.locator(f'{nav} [data-nav=gemerkt]').get_attribute('aria-current') == 'page', f'{tag}: „Gemerkt“ → Sheet, Punkt aktiv')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(390, 844), (1440, 900)]:
                run(b, w, hh)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
