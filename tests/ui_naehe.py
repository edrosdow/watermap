"""UI-Test „In der Nähe“: Bezugspunkt, Standortfreigabe (nachgebildet), Ortssuche, Liste, Zurück-Taste – mit den Daten aus ui_full.py.
Start: python3 tests/ui_naehe.py [screenshots-ordner]"""
import importlib.util, json, math, pathlib, re, sys, tempfile, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = int(time.time() * 1000)
POS = (51.5, 7.5)

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

# Freigabe und Ortung nachgebildet: Zustand bleibt über Neuladen (localStorage), Abfragen werden gezählt
GEO = """
(() => {
  const K = '__test.perm';
  if (!localStorage.getItem(K)) localStorage.setItem(K, '%(perm)s');
  const status = { get state() { return localStorage.getItem(K); }, onchange: null };
  const q = navigator.permissions && navigator.permissions.query.bind(navigator.permissions);
  if (navigator.permissions) navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve(status) : q(d));
  window.__geoCalls = 0;
  navigator.geolocation.getCurrentPosition = (ok, err) => {
    window.__geoCalls++;
    const s = localStorage.getItem(K);
    setTimeout(() => {
      if (s === 'granted' || (s === 'prompt' && %(allow)s)) { localStorage.setItem(K, 'granted'); ok({ coords: { latitude: %(lat)s, longitude: %(lon)s, accuracy: 30 } }); }
      else { localStorage.setItem(K, 'denied'); err({ code: 1 }); }
    }, 30);
  };
})();
"""

ORTE = {
    'bünde': [{'display_name': 'Bünde, Kreis Herford, Nordrhein-Westfalen', 'lat': '52.2', 'lon': '8.58', 'boundingbox': ['52.1', '52.3', '8.5', '8.7']}],
    'rügen': [{'display_name': 'Sassnitz, Rügen, Mecklenburg-Vorpommern', 'lat': '54.52', 'lon': '13.64', 'boundingbox': ['54.5', '54.6', '13.6', '13.7']}],
}

def page(b, w, hh, mobile, perm='prompt', allow='true', init=''):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1, locale='de-DE', service_workers='block')
    uf.lib_routes(ctx)
    def geocoder(route):
        q = route.request.url.split('q=')[-1]
        from urllib.parse import unquote
        q = unquote(q).lower()
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(next((v for k, v in ORTE.items() if k in q), [])))
    ctx.route('**/nominatim.openstreetmap.org/**', geocoder)
    ctx.route('**/api/meldungen/aktiv', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'zeit': NOW, 'aktiv': [
        {'standortId': 'node/1', 'n': 1, 'typ': 'parkplatz_voll', 'at': NOW - 40 * 60000}]})))
    ctx.route('**/api/meldungen?*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"meldungen": [], "zeit": %d}' % NOW))
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    ctx.add_init_script(GEO % {'perm': perm, 'allow': allow, 'lat': POS[0], 'lon': POS[1]} + init)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and '501' not in m.text else None)
    pg.errs = errs
    return ctx, pg

def kopf(pg, mobile):
    return pg.inner_text('#naehe-kopf-m' if mobile else '#naehe-kopf-d')

def oeffnen(pg, mobile):
    pg.goto(uf.BASE + '#naehe'); pg.wait_for_selector('.place.nk, .nh-leer', timeout=10000); pg.wait_for_timeout(300)

def km(a, b):
    r = 6371.0088; p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))

def run(b, w, hh, mobile):
    tag = f'{w}px'
    print(f'--- {tag}')
    nav = '#bottomnav' if mobile else '#topnav'

    # 1) Erstes Öffnen ohne Freigabe: kein Browser-Dialog, Erklär-Karte, Liste um die Kartenmitte
    ctx, pg = page(b, w, hh, mobile)
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip'); pg.wait_for_timeout(300)
    item = pg.locator(f'{nav} [data-nav=naehe]')
    check(item.inner_text().strip() == 'In der Nähe' and item.get_attribute('href') == './#naehe', f'{tag}: Tab „In der Nähe“ (#naehe)')
    item.click(); pg.wait_for_selector('.place.nk'); pg.wait_for_timeout(300)
    check(pg.url.endswith('#naehe') and item.get_attribute('aria-current') == 'page', f'{tag}: Adresse #naehe, Tab aktiv')
    check(pg.evaluate('window.__geoCalls') == 0, f'{tag}: beim Öffnen keine Standortabfrage')
    check(pg.locator('.nh-erklaer').is_visible() and 'nicht gespeichert, nicht gesendet' in pg.inner_text('.nh-erklaer'), f'{tag}: Erklär-Karte bei fehlender Freigabe')
    k = kopf(pg, mobile)
    check('In der Nähe' in k and 'um Kartenmitte' in k, f'{tag}: Kopf nennt den Bezugspunkt „um Kartenmitte“ ({k!r})')
    check('um die Kartenmitte' in pg.inner_text('.nh-zahl'), f'{tag}: Zeile „… um die Kartenmitte“')
    check(pg.locator('#sidebar button', has_text='Favoriten').count() == 0 and pg.locator('#sidebar [role=tab]').count() == 0, f'{tag}: kein Umschalter Standorte/Favoriten')
    check(pg.locator('#naehe-kopf-m').is_visible() == mobile and pg.locator('#naehe-kopf-d').is_visible() != mobile, f'{tag}: Kopf {"über den Kategorien" if mobile else "in der Seitenleiste"}')
    if not mobile:
        sb = pg.locator('#sidebar').bounding_box(); mw = pg.locator('.map-wrap').bounding_box()
        check(sb['x'] < 1 and mw['x'] >= sb['width'] - 1 and pg.locator('#toolbar').is_visible(), f'{tag}: linke Seitenleiste neben der Karte, Kategorien in der Werkzeugleiste')
    else:
        check(pg.locator('#toolbar').is_hidden() and pg.locator('.nh-cat').count() == 3, f'{tag}: Kategorien im Navy-Kopf')
    check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{tag}: kein horizontales Scrollen')
    klein = pg.evaluate("""[...document.querySelectorAll('.nh-kopf button, .nh-erklaer button, .place.nk, .nh-sort')].filter(e => e.offsetParent !== null)
        .map(e => { const r = e.getBoundingClientRect(); return [e.className || e.tagName, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[2] < 44)""")
    check(not klein, f'{tag}: Touch-Ziele ≥ 44 px {klein[:3]}')
    karte = pg.locator('.place.nk').first
    check(karte.locator('.nk-ico').count() == 1 and karte.locator('.nk-dist').count() == 1 and 'Min.' not in karte.inner_text(), f'{tag}: Karte mit Symbol und Entfernung, ohne Fahrzeit')
    pg.screenshot(path=str(SHOTS / f'naehe_{w}_1erst.png'))

    # 2) „Position verwenden“ → erlaubt
    pg.click('.nh-erklaer .btn-primary'); pg.wait_for_timeout(400)
    k = kopf(pg, mobile)
    check(pg.evaluate('window.__geoCalls') == 1 and 'um deine Position' in k and pg.locator('.nh-erklaer').count() == 0, f'{tag}: erlaubt → „um deine Position“, Karte weg ({k!r})')
    zahl = pg.inner_text('.nh-zahl')
    check('Standorte im Umkreis von' in zahl, f'{tag}: „<n> Standorte im Umkreis von <r> km“ ({zahl!r})')
    # Umkreis 25 → 50 → 100 km bei weniger als 5 Treffern
    pts = pg.evaluate("window.__watermap.state.filtered.map(p => [p.lat, p.lon])")
    erwartet = next((r for r in (25, 50, 100) if sum(1 for p in pts if km(POS, p) <= r) >= 5), 100)
    n = sum(1 for p in pts if km(POS, p) <= erwartet)
    check(f'{n} Standorte im Umkreis von {erwartet} km' in zahl.replace('\n', ' '), f'{tag}: Umkreis {erwartet} km mit {n} Treffern ({zahl!r})')
    d = [t for t in pg.locator('.nk-dist').all_inner_texts()]
    werte = [float(x[:-3].replace(',', '.')) if x.endswith(' km') else float(x[:-2]) / 1000 for x in d]
    check(werte == sorted(werte), f'{tag}: „Nächste zuerst“ ({d[:4]})')
    check('Standorte in der Nähe' in pg.inner_text('#live'), f'{tag}: Trefferzahl wird angesagt')
    # Wahl bleibt nach Neuladen, Freigabe erteilt → direkt Position, keine Karte
    pg.reload(); pg.wait_for_selector('.place.nk'); pg.wait_for_timeout(400)
    check('um deine Position' in kopf(pg, mobile) and pg.locator('.nh-erklaer').count() == 0 and pg.evaluate('window.__geoCalls') == 1, f'{tag}: nach Neuladen wieder „um deine Position“')
    # Sortierung Name A–Z
    pg.select_option('.nh-sort', 'name'); pg.wait_for_timeout(200)
    namen = [t.strip() for t in pg.locator('.nk-name').all_inner_texts()]
    check(namen == sorted(namen, key=lambda s: s.lower()) or len(namen) < 2, f'{tag}: Sortierung „Name A–Z“')
    pg.select_option('.nh-sort', 'naechste'); pg.wait_for_timeout(200)
    ctx.close()

    # 3) „Position verwenden“ → abgelehnt; Hinweis, Anleitung, Fenster mit gesperrter „Meine Position“
    ctx, pg = page(b, w, hh, mobile, allow='false'); oeffnen(pg, mobile)
    pg.click('.nh-erklaer .btn-primary'); pg.wait_for_timeout(400)
    check(pg.locator('.nh-blockiert').is_visible() and 'Standort im Browser blockiert.' in pg.inner_text('.nh-blockiert') and pg.locator('.nh-erklaer').count() == 0,
          f'{tag}: abgelehnt → schmaler Hinweis statt Erklär-Karte')
    farbe = pg.evaluate("getComputedStyle(document.querySelector('.nh-blockiert')).backgroundColor")
    check(farbe == 'rgb(255, 246, 227)', f'{tag}: Hinweis gelb getönt ({farbe})')
    check('um Kartenmitte' in kopf(pg, mobile), f'{tag}: ohne Position gilt die Kartenmitte')
    pg.click('.nh-blockiert .nh-link'); pg.wait_for_selector('#dlg[open] .nh-anleitung')
    t = pg.inner_text('#dlg')
    check('iPhone' in t and 'Android' in t and 'Computer' in t, f'{tag}: Anleitung für iPhone, Android, Desktop')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.locator('.nh-aendern:visible').click(); pg.wait_for_selector('#naehe-bezug[open]')
    mp = pg.locator('#naehe-bezug .nb-zeile', has_text='Meine Position')
    check(mp.get_attribute('aria-disabled') == 'true' and 'im Browser blockiert' in mp.inner_text(), f'{tag}: „Meine Position“ ausgegraut, „im Browser blockiert“')
    check(mp.get_attribute('aria-current') is None and pg.locator('#naehe-bezug .nb-zeile', has_text='Kartenmitte').get_attribute('aria-current') == 'true', f'{tag}: aktiv ist die Kartenmitte, nicht die blockierte Position')
    pg.screenshot(path=str(SHOTS / f'naehe_{w}_3blockiert.png'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    check(pg.locator('#naehe-bezug[open]').count() == 0, f'{tag}: Escape schließt das Fenster')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # 4) Bereits blockiert: Hinweis sofort, keine Abfrage
    ctx, pg = page(b, w, hh, mobile, perm='denied'); oeffnen(pg, mobile)
    check(pg.locator('.nh-blockiert').is_visible() and pg.locator('.nh-erklaer').count() == 0 and pg.evaluate('window.__geoCalls') == 0, f'{tag}: blockiert → Hinweis, keine Abfrage')
    ctx.close()

    # 5) Freigabe bereits erteilt: direkt „Meine Position“, keine Erklär-Karte; „Meine Position“ auf der Karte teilt den Status
    ctx, pg = page(b, w, hh, mobile, perm='granted'); oeffnen(pg, mobile); pg.wait_for_timeout(300)
    check('um deine Position' in kopf(pg, mobile) and pg.locator('.nh-erklaer').count() == 0, f'{tag}: Freigabe erteilt → direkt Position')
    ctx.close()

    # 6) Ort eingeben, Wahl bleibt nach Neuladen, zuletzt gesucht, Kartenmitte, Meldungs-Etikett, leerer Zustand
    ctx, pg = page(b, w, hh, mobile); oeffnen(pg, mobile)
    pg.click('.nh-erklaer .btn-outline'); pg.wait_for_selector('#naehe-bezug[open]'); pg.wait_for_timeout(150)
    check(pg.evaluate("document.activeElement.classList.contains('nb-suche')"), f'{tag}: „Ort eingeben“ → Fokus im Suchfeld')
    check(pg.get_attribute('.nb-suche', 'placeholder') == 'Ort, Gewässer oder Postleitzahl', f'{tag}: Suchfeld „Ort, Gewässer oder Postleitzahl“')
    zeilen = [t.split('\n')[0] for t in pg.locator('#naehe-bezug .nb-liste:not(.nb-treffer) .nb-zeile').all_inner_texts()]
    check(zeilen[:2] == ['Meine Position', 'Kartenmitte'], f'{tag}: Fenster mit „Meine Position“ und „Kartenmitte“ ({zeilen})')
    check(pg.locator('#naehe-bezug .nb-zeile', has_text='Kartenmitte').get_attribute('aria-current') == 'true', f'{tag}: Kartenmitte als aktiv markiert')
    box = pg.locator('#naehe-bezug').bounding_box()
    check(box['y'] >= 0 and box['y'] + box['height'] <= hh + 1, f'{tag}: Fenster ganz sichtbar')
    pg.fill('.nb-suche', 'Bünde'); pg.wait_for_selector('.nb-treffer .nb-zeile')
    pg.screenshot(path=str(SHOTS / f'naehe_{w}_6suche.png'))
    pg.click('.nb-treffer .nb-zeile'); pg.wait_for_timeout(300)
    check('um Bünde' in kopf(pg, mobile) and pg.locator('.nh-erklaer').count() == 0 and pg.locator('#naehe-bezug[open]').count() == 0, f'{tag}: Ort gewählt → „um Bünde“, Karte weg')
    gesp = pg.evaluate("JSON.parse(localStorage.getItem('watermap.naehe.bezug'))")
    check(gesp.get('art') == 'ort' and gesp.get('name') == 'Bünde' and abs(gesp.get('lat') - 52.2) < 1e-6, f'{tag}: nur die Wahl gespeichert ({gesp})')
    pg.reload(); pg.wait_for_selector('.place.nk'); pg.wait_for_timeout(300)
    check('um Bünde' in kopf(pg, mobile), f'{tag}: Ort bleibt nach Neuladen')
    pg.locator('.nh-aendern:visible').click(); pg.wait_for_selector('#naehe-bezug[open]')
    gm = pg.locator('#naehe-bezug .nb-zeile', has_text='Bünde')
    check(gm.count() == 1 and 'gemerkt' in gm.inner_text() and gm.locator('.nb-haken').count() == 1, f'{tag}: gemerkter Ort mit Haken')
    pg.fill('.nb-suche', 'Rügen'); pg.wait_for_selector('.nb-treffer .nb-zeile'); pg.click('.nb-treffer .nb-zeile'); pg.wait_for_timeout(300)
    check(pg.locator('.nh-leer').is_visible() and 'Keine Standorte im Umkreis von 100 km' in pg.inner_text('.nh-leer')
          and pg.locator('.nh-leer button', has_text='Ort ändern').count() == 1 and pg.locator('.nh-leer button', has_text='Filter zurücksetzen').count() == 1, f'{tag}: leerer Zustand mit „Ort ändern“ und „Filter zurücksetzen“')
    pg.click('.nh-leer button:has-text("Ort ändern")'); pg.wait_for_selector('#naehe-bezug[open]')
    zuletzt = pg.locator('#naehe-bezug .nb-zeile', has_text='zuletzt gesucht')
    check(zuletzt.count() == 1 and 'Bünde' in zuletzt.inner_text(), f'{tag}: zuletzt gesuchte Orte')
    pg.locator('#naehe-bezug .nb-zeile', has_text='Kartenmitte').click(); pg.wait_for_timeout(300)
    check('um Kartenmitte' in kopf(pg, mobile) and pg.locator('.place.nk').count() > 0, f'{tag}: Kartenmitte gewählt')
    # Bezugspunkt direkt an node/1 (Meldung „Parkplatz voll“ vor 40 Min.)
    p1 = pg.evaluate("(() => { const p = window.__watermap.state.byId.get('node/1'); return { name: 'Testpunkt', lat: p.lat, lon: p.lon }; })()")
    pg.evaluate("(o) => { localStorage.setItem('watermap.naehe.bezug', JSON.stringify({ art: 'ort', ...o })); }", p1)
    pg.reload(); pg.wait_for_selector('.place.nk'); pg.wait_for_timeout(500)
    erste = pg.locator('.place.nk').first
    check(erste.get_attribute('data-id') == 'node/1' and re.search(r'Parkplatz voll · vor 4\d Min\.', erste.inner_text()) and erste.locator('.nh-meld.ton-warn').count() == 1, f'{tag}: Meldungs-Etikett mit Alter')

    # Kategorien gemeinsam mit der Karte
    if mobile:
        pg.click('.nh-cat[data-cat=marina]'); pg.wait_for_timeout(200)
        check(pg.locator('.nh-cat[data-cat=marina]').get_attribute('aria-pressed') == 'true' and pg.evaluate("window.__watermap.state.cats.has('marina')"), f'{tag}: Kategorie im Kopf wählt auch auf der Karte')
    else:
        pg.click('#cats .cat-marina'); pg.wait_for_timeout(200)
        check(pg.locator('.place.nk .bg-marina').count() > 0, f'{tag}: Kategorie aus der Werkzeugleiste wirkt auf die Liste')
    pg.screenshot(path=str(SHOTS / f'naehe_{w}_2liste.png'))

    # Tipp → Karte mit Vorschau; Zurück → wieder „In der Nähe“ an derselben Stelle
    liste = pg.locator('#list')
    if mobile:
        liste.evaluate('e => e.scrollTop = 300'); pg.wait_for_timeout(100)
        y = liste.evaluate('e => e.scrollTop')
        ziel = pg.locator('.place.nk').nth(4); zid = ziel.get_attribute('data-id')
        ziel.click(); pg.wait_for_selector('#peek:not([hidden])'); pg.wait_for_timeout(300)
        check(pg.locator(f'{nav} [data-nav=karte]').get_attribute('aria-current') == 'page' and pg.evaluate('window.__watermap.state.selectedId') == zid, f'{tag}: Tipp → Karte, Vorschau des Standorts')
        pg.go_back(); pg.wait_for_selector('.place.nk'); pg.wait_for_timeout(300)
        y2 = liste.evaluate('e => e.scrollTop')
        check(pg.url.endswith('#naehe') and abs(y2 - y) < 5, f'{tag}: Zurück → „In der Nähe“ an derselben Stelle ({y} → {y2})')
    else:
        ziel = pg.locator('.place.nk').nth(1); zid = ziel.get_attribute('data-id')
        ziel.click(); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(200)
        check(pg.locator('#sidebar').is_visible() and pg.evaluate('window.__watermap.state.selectedId') == zid, f'{tag}: Tipp → Details neben der Liste')
    # „Auf Karte“: alle Treffer im Ausschnitt
    ids = pg.evaluate("[...document.querySelectorAll('.place.nk')].map(e => e.dataset.id)")
    pg.locator('.nh-knopf:visible').click(); pg.wait_for_timeout(400)
    drin = pg.evaluate("""(ids) => { const m = window.__watermap.state.map, b = m.getBounds();
        return ids.map(id => window.__watermap.state.byId.get(id)).every(p => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east); }""", ids)
    check(drin and (not mobile or pg.locator(f'{nav} [data-nav=karte]').get_attribute('aria-current') == 'page'), f'{tag}: „Auf Karte“ zeigt alle {len(ids)} Treffer')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # 7) Favoriten bleiben eigener Tab mit denselben Karten
    ctx, pg = page(b, w, hh, mobile, init="try { localStorage.setItem('watermap.favorites.v1', JSON.stringify(['node/1'])); } catch {}")
    pg.goto(uf.BASE + '#favoriten'); pg.wait_for_selector('.place.nk')
    check(pg.locator('.place.nk').count() == 1 and pg.inner_text('#list-title') == 'Favoriten' and pg.locator('.nh-kopf').first.is_hidden(), f'{tag}: Favoriten als eigener Tab')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run(b, 375, 667, True); run(b, 390, 844, True); run(b, 1024, 768, False); run(b, 1440, 900, False)
            b.close()
    finally:
        srv.shutdown()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
