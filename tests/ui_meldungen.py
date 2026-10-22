"""UI-Test „Heute vor Ort“ (Lagemeldungen) mit nachgebildeter /api/meldungen und den synthetischen Daten aus ui_full.py.
Start: python3 tests/ui_meldungen.py [screenshots-ordner]"""
import importlib.util, json, pathlib, sys, tempfile, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = int(time.time() * 1000)
RANG = ['alles_frei', 'warteschlange', 'parkplatz_voll', 'rampe_rutschig', 'hindernis', 'gesperrt']

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: problems.append(msg)

def fake_api():
    """Zustand + Route-Handler; mode: 'ok' | 'down' (Netz weg) | 'sperre' (429)."""
    st = {'mode': 'ok', 'posts': [], 'votes': [], 'M': {
        'node/1': [{'id': 'a1', 'standortId': 'node/1', 'typ': 'parkplatz_voll', 'notiz': '<b>Ausweich</b>parkplatz', 'erstelltAm': NOW - 40 * 60000, 'bestaetigt': 3, 'widersprochen': 0},
                   {'id': 'a2', 'standortId': 'node/1', 'typ': 'warteschlange', 'notiz': None, 'erstelltAm': NOW - 20 * 60000, 'bestaetigt': 0, 'widersprochen': 0}],
        'node/2': [{'id': 'b1', 'standortId': 'node/2', 'typ': 'gesperrt', 'notiz': None, 'erstelltAm': NOW - 5 * 60000, 'bestaetigt': 1, 'widersprochen': 0}]}}
    def sortiert(lst): return sorted(lst, key=lambda m: -RANG.index(m['typ']))
    def handler(route):
        r = route.request; u = r.url
        if st['mode'] == 'down': return route.abort()
        if r.method == 'GET' and u.endswith('/api/meldungen/aktiv'):
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'aktiv': [
                {'standortId': k, 'n': len(v), 'typ': sortiert(v)[0]['typ']} for k, v in st['M'].items() if v], 'zeit': NOW}))
        if r.method == 'GET':
            sid = u.split('standort=')[1].replace('%2F', '/')
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'meldungen': sortiert(st['M'].get(sid, [])), 'zeit': NOW}))
        body = json.loads(r.post_data or '{}')
        if '/bestaetigen' in u:
            mid = u.split('/api/meldungen/')[1].split('/')[0]
            st['votes'].append((mid, body.get('stimmt'), r.headers.get('x-geraet')))
            for sid, lst in st['M'].items():
                for m in lst:
                    if m['id'] == mid: m['bestaetigt' if body['stimmt'] else 'widersprochen'] += 1; return route.fulfill(status=200, content_type='application/json', body=json.dumps({'standortId': sid, 'meldungen': sortiert(lst)}))
            return route.fulfill(status=404, content_type='application/json', body='{"fehler":"weg"}')
        st['posts'].append({'body': body, 'geraet': r.headers.get('x-geraet')})
        if st['mode'] == 'sperre':
            return route.fulfill(status=429, content_type='application/json', body=json.dumps({'fehler': 'Du hast hier gerade schon gemeldet. Bitte warte eine Stunde.'}))
        m = {'id': 'n%d' % len(st['posts']), 'standortId': body['standortId'], 'typ': body['typ'], 'notiz': body.get('notiz') or None, 'erstelltAm': NOW, 'bestaetigt': 0, 'widersprochen': 0}
        st['M'].setdefault(body['standortId'], []).append(m)
        return route.fulfill(status=201, content_type='application/json', body=json.dumps({'meldung': m, 'meldungen': sortiert(st['M'][body['standortId']])}))
    return st, handler

def page(b, mobile, geo=None):
    vp = {'width': 375, 'height': 667} if mobile else {'width': 1280, 'height': 800}
    ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1, locale='de-DE',
                        geolocation=geo, permissions=['geolocation'] if geo else [], service_workers='block')
    uf.lib_routes(ctx)
    st, handler = fake_api(); ctx.route('**/api/meldungen**', handler)
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and '501' not in m.text else None)
    pg.errs = errs
    return ctx, pg, st

def run(b, mobile):
    tag = 'Handy 375' if mobile else 'Desktop'
    print(f'--- {tag}')
    ctx, pg, st = page(b, mobile)
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip'); pg.wait_for_timeout(500)
    # Kategorie-Chips: Start Slipanlagen, mindestens eine bleibt aktiv
    check(pg.get_attribute('.cat-slip', 'aria-pressed') == 'true' and pg.get_attribute('.cat-fuel', 'aria-pressed') == 'false', f'{tag}: Start mit Slipanlagen')
    pg.click('.cat-slip'); pg.wait_for_timeout(150)
    check(pg.get_attribute('.cat-slip', 'aria-pressed') == 'true' and 'Mindestens eine' in pg.inner_text('#toast'), f'{tag}: letzte Kategorie lässt sich nicht abwählen')
    pg.click('.cat-fuel'); pg.wait_for_timeout(150)
    check(pg.locator('.cat[aria-pressed=true] .cat-check').count() == 2 and pg.evaluate("getComputedStyle(document.querySelector('.cat-fuel')).backgroundColor") == 'rgb(255, 255, 255)', f'{tag}: aktive Chips weiß mit Haken')
    check(pg.evaluate("getComputedStyle(document.querySelector('.cat-marina')).backgroundColor") == 'rgba(0, 0, 0, 0)', f'{tag}: inaktiver Chip transparent')
    pg.click('.cat-fuel'); pg.wait_for_timeout(150)
    # Marker-Abzeichen
    pg.evaluate("window.__watermap.state.map.raw.setView([window.__watermap.state.byId.get('node/1').lat, window.__watermap.state.byId.get('node/1').lon], 14, { animate: false })"); pg.wait_for_timeout(300)
    pg.evaluate("window.__watermap.applyFilters()"); pg.wait_for_timeout(200)   # Stub: setIcon zeichnet gruppierte Marker nicht neu
    b1 = pg.locator('.wm-pin .wm-mbadge:not(.is-stop)')
    check(b1.count() >= 1 and b1.first.inner_text() == '2', f'{tag}: Abzeichen mit Anzahl am Pin')
    check(pg.evaluate("getComputedStyle(document.querySelector('.wm-mbadge:not(.is-stop)')).backgroundColor") == 'rgb(180, 83, 9)', f'{tag}: Abzeichen orange #B45309')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_1karte.png'))
    pg.evaluate("window.__watermap.state.map.raw.setView([window.__watermap.state.byId.get('node/2').lat, window.__watermap.state.byId.get('node/2').lon], 14, { animate: false })"); pg.wait_for_timeout(300)
    pg.evaluate("window.__watermap.applyFilters()"); pg.wait_for_timeout(200)
    check(pg.locator('.wm-pin .wm-mbadge.is-stop i').count() >= 1, f'{tag}: rotes Abzeichen mit Querstrich bei „gesperrt“')
    # Standort öffnen
    pg.evaluate("window.__watermap.selectPlace('node/1')")
    if mobile:
        pg.wait_for_selector('#peek .meld-zeile')
        z = pg.inner_text('#peek .meld-zeile')
        check('Parkplatz voll' in z and 'vor 40 Min.' in z and '3× bestätigt' in z and '+1 weitere' in z, f'{tag}: Statuszeile in der Vorschau ({z!r})')
        check(pg.evaluate("getComputedStyle(document.querySelector('#peek .meld-zeile')).backgroundColor") == 'rgb(255, 246, 227)', f'{tag}: Statuszeile getönt #FFF6E3')
        pg.screenshot(path=str(SHOTS / 'meld_m_2vorschau.png'))
        pg.click('#peek .meld-zeile'); pg.wait_for_selector('#detail:not([hidden]) .meld-item')
        pg.wait_for_timeout(300)
        check(pg.evaluate("document.activeElement.id") == 'heute-vor-ort', f'{tag}: Statuszeile öffnet Details bei „Heute vor Ort“')
    else:
        pg.wait_for_selector('#detail:not([hidden]) .meld-item')
        check(pg.locator('#detail .detail-body > .meld-slot .meld-zeile').count() == 1, f'{tag}: Statuszeile oben im Detailpanel')
    sec = pg.locator('#detail #heute-vor-ort')
    txt = sec.inner_text()
    check('verschwindet nach 24 h' in txt and pg.locator('#detail .meld-item').count() == 2, f'{tag}: Abschnitt „Heute vor Ort“ mit zwei Meldungen')
    check('<b>' in txt and pg.locator('#detail .meld-notiz b').count() == 0, f'{tag}: Notiz als Text, nie als HTML')
    order = pg.evaluate("[...document.querySelectorAll('#detail .detail-body > *')].map(e => e.id || e.className)")
    check('heute-vor-ort' in order and order.index('heute-vor-ort') < next((k for k, c in enumerate(order) if 'wx-block' in str(c)), 999), f'{tag}: „Heute vor Ort“ über dem Wetter')
    # Bestätigen
    first = pg.locator('#detail .meld-item').first
    first.locator('button', has_text='Stimmt noch').click(); pg.wait_for_timeout(300)
    check(st['votes'] and st['votes'][0][1] is True and st['votes'][0][2], f'{tag}: „Stimmt noch“ gesendet (mit Geräte-ID)')
    first = pg.locator('#detail .meld-item').first
    check(first.locator('button', has_text='Stimmt noch').is_disabled() and 'Danke' in first.inner_text(), f'{tag}: danach deaktiviert mit Dank')
    check('4× bestätigt' in pg.inner_text('#detail .meld-zeile'), f'{tag}: Statuszeile zählt mit')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_3detail.png'), full_page=False)
    # Standort ohne Meldungen
    pg.evaluate("window.__watermap.selectPlace('node/3', { full: true })"); pg.wait_for_selector('#detail .meld-keine')
    check('Keine Probleme gemeldet' in pg.inner_text('#detail #heute-vor-ort') and pg.locator('#detail .meld-zeile').count() == 0, f'{tag}: ohne Meldungen „Keine Probleme gemeldet“, keine Statuszeile')
    # „Lage hier melden“ → Formular
    pg.click('#detail .meld-link'); pg.wait_for_selector('#dlg[open] .lf-grid')
    send = pg.locator('#dlg .lf-send')
    check(pg.locator('#dlg .lf-tile').count() == 6 and send.get_attribute('aria-disabled') == 'true', f'{tag}: sechs Kacheln, Senden erst nach Auswahl')
    hs = [pg.locator('#dlg .lf-tile').nth(i).bounding_box()['height'] for i in range(6)]
    check(min(hs) >= 76, f'{tag}: Kacheln mindestens 76 px hoch ({min(hs):.0f})')
    check(pg.locator('#dlg .lf-back').count() == 0, f'{tag}: ohne Melden-Sheet kein Zurück-Pfeil')
    pg.click('#dlg .lf-tile[data-typ=gesperrt]'); pg.click('#dlg .lf-tile[data-typ=alles_frei]')
    check(pg.locator('#dlg .lf-tile[aria-pressed=true]').count() == 1 and pg.get_attribute('#dlg .lf-tile[data-typ=alles_frei]', 'aria-pressed') == 'true', f'{tag}: Einfachauswahl mit aria-pressed')
    pg.fill('#lf-note', 'Rampe frei geräumt')
    check(pg.inner_text('#dlg .lf-count') == '18 / 140' and pg.get_attribute('#lf-note', 'maxlength') == '140', f'{tag}: Zähler „18 / 140“')
    st['mode'] = 'sperre'
    send.click(); pg.wait_for_selector('#dlg .pf-status.error')
    check('gerade schon gemeldet' in pg.inner_text('#dlg .pf-status'), f'{tag}: Sperre freundlich erklärt')
    st['mode'] = 'down'
    send.click(); pg.wait_for_timeout(400)
    check('Keine Verbindung' in pg.inner_text('#dlg .pf-status'), f'{tag}: ohne Verbindung freundlicher Hinweis')
    st['mode'] = 'ok'
    send.click(); pg.wait_for_selector('#dlg', state='hidden')
    check('Danke! Deine Meldung ist jetzt sichtbar.' in pg.inner_text('#toast'), f'{tag}: Toast nach dem Senden')
    p = st['posts'][-1]['body']
    check(p == {'standortId': 'node/3', 'typ': 'alles_frei', 'notiz': 'Rampe frei geräumt'}, f'{tag}: gesendet nur Standort-ID, Typ, Notiz ({p})')
    pg.wait_for_timeout(300)
    check(pg.evaluate("window.__watermap.state.meld.get('node/3')?.typ") == 'alles_frei' and pg.locator('#detail .meld-item').count() == 1, f'{tag}: Marker-Stand und Detail sofort aktualisiert')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # Filter „Aktuelle Meldungen“
    n, on, cnt = uf.layer(pg, 'meldungen')
    check(n == 1 and on == 'false' and cnt == '3', f'{tag}: Filter-Schalter „Aktuelle Meldungen“ mit Anzahl ({cnt})')
    uf.layer(pg, 'meldungen', click=True); pg.wait_for_timeout(200)
    ids = pg.evaluate("window.__watermap.state.filtered.map(p => p.id).sort()")
    check(ids == ['node/1', 'node/2', 'node/3'], f'{tag}: nur Standorte mit Meldungen ({ids})')
    check(pg.inner_text('#filter-n') == '1', f'{tag}: Filter-Abzeichen zählt mit')
    if not mobile:
        t = pg.locator('#filter-tags .ftag', has_text='Aktuelle Meldungen')
        check(t.count() == 1 and t.get_attribute('aria-label') == 'Filter Aktuelle Meldungen entfernen', f'{tag}: Etikett „Aktuelle Meldungen ×“')
        t.click(); pg.wait_for_timeout(150)
    else:
        uf.layer(pg, 'meldungen', click=True); pg.wait_for_timeout(150)
    check(pg.evaluate("window.__watermap.state.meldOnly") is False and pg.evaluate("window.__watermap.state.filtered.length") > 3, f'{tag}: Filter wieder aus')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # Melden-Sheet: mit Position in der Nähe → Vorschlag; ohne Position → nur Eintrag
    lat, lon = 51.5, 7.5
    ctx, pg, st = page(b, mobile, geo={'latitude': 0, 'longitude': 0})
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip'); pg.wait_for_timeout(400)
    plat, plon = pg.evaluate("[window.__watermap.state.byId.get('node/1').lat, window.__watermap.state.byId.get('node/1').lon]")
    ctx.set_geolocation({'latitude': plat + 0.0007, 'longitude': plon})
    opener = '#bottomnav [data-nav=melden]' if mobile else '#btn-report'
    pg.click(opener); pg.wait_for_selector('#report-menu[open] .lage-frage:not([hidden])', timeout=8000)
    txt = pg.inner_text('#report-menu')
    check('Lage vor Ort melden' in txt and 'NEU' in txt and 'Bist du an der TEST Slip 1' in txt and '80 m' in txt, f'{tag}: Vorschlag „Bist du an der …? · 80 m“')
    items = pg.locator('#report-menu .rm-item').all_inner_texts()
    check([i.strip() for i in items] == ['Neue Slipanlage melden', 'Kraftstoffpreis melden', 'Foto einreichen', 'Fehler oder Hinweis melden'], f'{tag}: vier bisherige Einträge darunter')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_4sheet.png'))
    pg.click('.lage-ja'); pg.wait_for_selector('#dlg[open] .lf-grid')
    check('du bist 80 m entfernt' in pg.inner_text('#dlg .pf-place') and pg.locator('#dlg .lf-back').count() == 1, f'{tag}: Lage melden mit Entfernung und Zurück-Pfeil')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_5lage.png'))
    pg.click('#dlg .lf-back'); pg.wait_for_selector('#report-menu[open]')
    check(pg.locator('#dlg[open]').count() == 0, f'{tag}: Zurück führt zu „Was möchtest du melden?“')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    ctx.close()

    ctx, pg, st = page(b, mobile, geo=None)   # Standortabfrage abgelehnt
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip'); pg.wait_for_timeout(400)
    pg.click(opener); pg.wait_for_selector('#report-menu[open]'); pg.wait_for_timeout(600)
    check(pg.locator('#report-menu .lage-frage').is_hidden(), f'{tag}: ohne Position kein Vorschlag')
    pg.click('#report-menu .lage-main'); pg.wait_for_selector('#pickbar:not([hidden])')
    check('an dem du gerade bist' in pg.inner_text('#pickbar'), f'{tag}: Eintrag startet die Standortauswahl')
    pg.evaluate("window.__watermap.selectPlace('node/2')"); pg.wait_for_selector('#dlg[open] .lf-grid')
    check('TEST Slip 2' in pg.inner_text('#dlg .pf-place'), f'{tag}: gewählter Standort im Formular')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    # Offline: Stand von …, Melden aus
    ctx.set_offline(True); st['mode'] = 'down'
    pg.evaluate("window.dispatchEvent(new Event('offline'))")
    pg.evaluate("window.__watermap.selectPlace('node/1', { full: true })"); pg.wait_for_selector('#detail .meld-offline')
    check('Stand von' in pg.inner_text('#detail .meld-offline') or 'Offline' in pg.inner_text('#detail .meld-offline'), f'{tag}: offline mit Hinweis auf den Stand')
    check(pg.locator('#detail .meld-link').is_disabled(), f'{tag}: offline ist „Lage hier melden“ aus')
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run(b, False); run(b, True)
            b.close()
    finally:
        srv.shutdown()
print('\nFEHLER:', problems if problems else 'keine')
sys.exit(1 if problems else 0)
