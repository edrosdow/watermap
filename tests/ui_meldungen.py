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
        if r.method == 'GET' and u.endswith('/api/meldungen/liste'):
            alle = sorted([m for v in st['M'].values() for m in v], key=lambda m: -m['erstelltAm'])
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'meldungen': alle, 'zeit': NOW}))
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
        pg.click('#peek .meld-zeile'); pg.wait_for_selector('#detail:not([hidden]) .vo-kopf')
        pg.wait_for_timeout(300)
        check(pg.evaluate("document.activeElement.id") == 'heute-vor-ort', f'{tag}: Statuszeile öffnet Details bei „Heute vor Ort“')
    else:
        pg.wait_for_selector('#detail:not([hidden]) .vo-kopf')
    pg.wait_for_selector('#detail .vo-kopf'); pg.wait_for_timeout(200)
    karte = pg.locator('#detail #heute-vor-ort')
    # Zustand b, weiter weg (ohne Position): Status ohne Knöpfe/Chips, unten „Lage melden“
    check('vo-warn' in karte.get_attribute('class') and pg.inner_text('#detail .vo-status') == 'Parkplatz voll'
          and 'vor 40 Min. · 3× bestätigt' in pg.inner_text('#detail .vo-kopf'), f'{tag}: b – wichtigste Meldung mit Alter und Bestätigungen')
    check(pg.evaluate("getComputedStyle(document.querySelector('#detail .vo-oben')).backgroundColor") == 'rgb(255, 246, 227)'
          and pg.evaluate("getComputedStyle(document.querySelector('#detail .vo-karte')).borderTopColor") == 'rgb(235, 199, 122)', f'{tag}: b – getönt #FFF6E3, Rand #EBC77A')
    check(karte.locator('.vo-pille').count() == 0 and karte.locator('.vo-chip').count() == 0 and karte.locator('button.vo-melden').count() == 1, f'{tag}: d – weit weg: keine Knöpfe/Chips, Zeile „Lage melden“')
    mz = karte.locator('.vo-melden').bounding_box()
    check(mz['height'] >= 60 and 'Warst du heute dort? Hilf anderen.' in pg.inner_text('#detail .vo-melden'), f'{tag}: d – „Lage melden“ ≥ 60 px mit Unterzeile')
    check('<b>' in karte.inner_text() and karte.locator('.vo-notiz b').count() == 0, f'{tag}: Notiz als Text, nie als HTML')
    wb = karte.locator('.vo-weiter-btn')
    check(wb.count() == 1 and wb.get_attribute('aria-expanded') == 'false' and 'Warteschlange' in wb.inner_text() and 'vor 20 Min.' in wb.inner_text(), f'{tag}: weitere Meldung eingeklappt')
    wb.click(); check(karte.locator('.vo-weiter-btn').get_attribute('aria-expanded') == 'true' and 'noch nicht bestätigt' in karte.inner_text(), f'{tag}: aufklappbar')
    order = pg.evaluate("[...document.querySelectorAll('#detail .detail-body > *')].map(e => e.id || e.className)")
    i_btn = next(k for k, c in enumerate(order) if 'dbtns' in str(c))
    check(order.index('heute-vor-ort') == i_btn + 1 or order.index('heute-vor-ort') == i_btn + 2, f'{tag}: Karte direkt unter Route/Merken/Teilen')
    check(order.index('heute-vor-ort') < next((k for k, c in enumerate(order) if 'wx-block' in str(c)), 999), f'{tag}: Karte über dem Wetter')
    check('bei Testort' in pg.inner_text('#detail .dh-meta') and pg.locator('#detail .detail-sub').count() == 0, f'{tag}: Ort in der Unterzeile unter dem Namen')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_3b_weit.png'))
    # „Lage melden“ (weit) → sechs Kacheln
    pg.click('#detail .vo-melden'); pg.wait_for_selector('#dlg[open] .lf-grid')
    check(pg.locator('#dlg .lf-tile').count() == 6, f'{tag}: d – „Lage melden“ öffnet die sechs Kacheln')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # Nah (Position bekannt, ≤ 1000 m): „Stimmt das noch?“ und „Lage hat sich geändert?“
    pg.evaluate("(() => { const p = window.__watermap.state.byId.get('node/1'); window.__watermap.state.user = { lat: p.lat + 0.004, lon: p.lon }; })()")
    pg.evaluate("window.__watermap.selectPlace('node/1', { full: true })"); pg.wait_for_selector('#detail .vo-pille')
    karte = pg.locator('#detail #heute-vor-ort')
    check(karte.locator('.vo-frage-text').first.inner_text() == 'Stimmt das noch?' and karte.locator('.vo-oben .vo-pille').count() == 2, f'{tag}: b nah – „Stimmt das noch?“ mit Ja / Nicht mehr')
    chips = [c.strip() for c in karte.locator('.vo-unten .vo-chip').all_inner_texts()]
    check('Lage hat sich geändert?' in karte.inner_text() and chips == ['Alles frei', 'Warteschlange', 'Gesperrt', 'Mehr'], f'{tag}: b nah – passende Chips ({chips})')
    hs = [karte.locator('.vo-chip').nth(i).bounding_box()['height'] for i in range(len(chips))]
    check(min(hs) >= 40, f'{tag}: Chips mindestens 40 px hoch ({min(hs):.0f})')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_4b_nah.png'))
    karte.locator('.vo-oben .vo-pille', has_text='Ja').click(); pg.wait_for_timeout(300)
    check(st['votes'] and st['votes'][-1][1] is True and st['votes'][-1][2], f'{tag}: „Ja“ gesendet (mit Geräte-ID)')
    check(karte.locator('.vo-oben .vo-pille').first.is_disabled() and 'Danke!' in karte.inner_text(), f'{tag}: danach deaktiviert mit „Danke!“')
    pg.wait_for_timeout(1400)
    check('4× bestätigt' in pg.inner_text('#detail .vo-kopf'), f'{tag}: Zähler aktualisiert')
    # Gesperrt: rot getönt
    pg.evaluate("(() => { const p = window.__watermap.state.byId.get('node/2'); window.__watermap.state.user = null; })()")
    pg.evaluate("window.__watermap.selectPlace('node/2', { full: true })"); pg.wait_for_selector('#detail .vo-karte.vo-stop')
    check(pg.evaluate("getComputedStyle(document.querySelector('#detail .vo-oben')).backgroundColor") == 'rgb(254, 242, 242)' and pg.inner_text('#detail .vo-status') == 'Gesperrt', f'{tag}: b gesperrt – rot getönt #FEF2F2')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_5b_rot.png'))
    # Zustand e: keine Meldungen und weit weg → schmale Zeile statt großem Kasten
    pg.evaluate("window.__watermap.state.user = null")
    pg.evaluate("window.__watermap.selectPlace('node/3', { full: true })"); pg.wait_for_selector('#detail .vo-karte.vo-schmal')
    karte = pg.locator('#detail #heute-vor-ort')
    bb = karte.bounding_box()
    check(pg.inner_text('#detail .vo-status') == 'Heute keine Probleme gemeldet' and bb['height'] <= 80, f'{tag}: e – schmale Zeile, höchstens 80 px ({bb["height"]:.0f})')
    check(karte.locator('.vo-chip').count() == 0 and karte.locator('.vo-alle').count() == 0 and karte.locator('.vo-melden').count() == 0, f'{tag}: e – keine Chips, kein „Alle Meldungen“')
    btn = karte.locator('button.vo-schmal-btn')
    check(btn.count() == 1 and btn.bounding_box()['height'] >= 44 and 'Lage melden' in btn.inner_text(), f'{tag}: e – Knopf „Lage melden“ ≥ 44 px')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_6e_schmal.png'))
    btn.click(); pg.wait_for_selector('#dlg[open] .lf-grid')
    check('TEST Slip 3' in pg.inner_text('#dlg .pf-place'), f'{tag}: e – Knopf öffnet „Lage melden“ für den Standort')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    # Zustand a: nah, keine Meldungen
    pg.evaluate("(() => { const p = window.__watermap.state.byId.get('node/3'); window.__watermap.state.user = { lat: p.lat, lon: p.lon + 0.003 }; })()")
    pg.evaluate("window.__watermap.selectPlace('node/3', { full: true })"); pg.wait_for_selector('#detail .vo-unten')
    karte = pg.locator('#detail #heute-vor-ort')
    chips = [c.strip() for c in karte.locator('.vo-chip').all_inner_texts()]
    check(pg.inner_text('#detail .vo-status') == 'Heute keine Probleme gemeldet' and karte.locator('.vo-kopf small').count() == 0, f'{tag}: a – „Heute keine Probleme gemeldet“ ohne Zusatzzeile')
    check('Bist du gerade hier?' in karte.inner_text() and 'ein Tipp genügt' in karte.inner_text() and chips == ['Alles frei', 'Parkplatz voll', 'Warteschlange', 'Mehr'], f'{tag}: a – „Bist du gerade hier?“ mit Chips ({chips})')
    check(karte.locator('.vo-melden').count() == 0, f'{tag}: a – keine Zeile „Lage melden“ (nah)')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_6a.png'))
    # Zustand c: Chip antippen
    karte.locator('.vo-chip', has_text='Parkplatz voll').click(); pg.wait_for_selector('#detail .vo-karte.is-edit')
    check('Deine Meldung' in karte.inner_text() and pg.inner_text('#detail .vo-wahl') == 'Parkplatz voll' and karte.locator('.vo-kopf.is-klein').count() == 1, f'{tag}: c – „Deine Meldung“, gewählte Lage, Status klein')
    check(pg.evaluate("getComputedStyle(document.querySelector('#detail .vo-karte')).borderTopWidth") == '2px', f'{tag}: c – dunkler Rand 2 px')
    check(pg.get_attribute('#vo-notiz', 'maxlength') == '140', f'{tag}: c – Notiz max. 140 Zeichen')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_7c.png'))
    karte.locator('.vo-aendern').click()
    check(karte.locator('.vo-chip').count() == 4 and 'is-edit' not in karte.get_attribute('class'), f'{tag}: „Ändern“ führt zu den Chips zurück')
    karte.locator('.vo-chip', has_text='Alles frei').click(); pg.fill('#vo-notiz', 'Rampe frei geräumt')
    st['mode'] = 'sperre'
    karte.locator('.vo-senden').click(); pg.wait_for_selector('#detail .vo-fehler:not([hidden])')
    check('gerade schon gemeldet' in pg.inner_text('#detail .vo-fehler'), f'{tag}: Sperre freundlich erklärt')
    st['mode'] = 'down'
    karte.locator('.vo-senden').click(); pg.wait_for_timeout(400)
    check('Keine Verbindung' in pg.inner_text('#detail .vo-fehler'), f'{tag}: ohne Verbindung freundlicher Hinweis')
    st['mode'] = 'ok'
    karte.locator('.vo-senden').click(); pg.wait_for_selector('#detail .vo-karte:not(.is-edit) .vo-kopf small')
    check('Danke! Deine Meldung ist jetzt sichtbar.' in pg.inner_text('#toast'), f'{tag}: Toast nach dem Senden')
    p = st['posts'][-1]['body']
    check(p == {'standortId': 'node/3', 'typ': 'alles_frei', 'notiz': 'Rampe frei geräumt'}, f'{tag}: gesendet nur Standort-ID, Typ, Notiz ({p})')
    check('Zuletzt: „Alles frei“ · heute' in pg.inner_text('#detail .vo-kopf'), f'{tag}: danach „Zuletzt: „Alles frei“ · heute …“')
    check(pg.evaluate("window.__watermap.state.meld.get('node/3')?.typ") == 'alles_frei', f'{tag}: Marker-Stand sofort aktualisiert')
    # „Mehr ›“ → sechs Kacheln
    karte.locator('.vo-chip-mehr').click(); pg.wait_for_selector('#dlg[open] .lf-grid')
    send = pg.locator('#dlg .lf-send')
    check(pg.locator('#dlg .lf-tile').count() == 6 and send.get_attribute('aria-disabled') == 'true', f'{tag}: „Mehr“ öffnet sechs Kacheln, Senden erst nach Auswahl')
    hs = [pg.locator('#dlg .lf-tile').nth(i).bounding_box()['height'] for i in range(6)]
    check(min(hs) >= 76, f'{tag}: Kacheln mindestens 76 px hoch ({min(hs):.0f})')
    pg.click('#dlg .lf-tile[data-typ=gesperrt]'); pg.click('#dlg .lf-tile[data-typ=rampe_rutschig]')
    check(pg.locator('#dlg .lf-tile[aria-pressed=true]').count() == 1, f'{tag}: Einfachauswahl mit aria-pressed')
    pg.fill('#lf-note', 'Algen')
    check(pg.inner_text('#dlg .lf-count') == '5 / 140', f'{tag}: Zähler „5 / 140“')
    send.click(); pg.wait_for_selector('#dlg', state='hidden'); pg.wait_for_timeout(300)
    check(pg.inner_text('#detail .vo-status') == 'Rampe rutschig', f'{tag}: Detail zeigt sofort die neue Meldung')
    pg.evaluate("window.__watermap.state.user = null")
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
    check('Lage vor Ort melden' in txt and 'NEU' in txt and 'Wie ist es gerade an der TEST Slip 1' in txt and '80 m' in txt, f'{tag}: Vorschlag „Wie ist es gerade an der …? · 80 m“')
    check(pg.locator('#report-menu .lage-typ').count() == 6, f'{tag}: sechs Lage-Knöpfe direkt im Menü')
    items = pg.locator('#report-menu .rm-item').all_inner_texts()
    check([i.strip() for i in items] == ['Foto einreichen', 'Angaben ergänzen', 'Neue Slipanlage melden', 'Fehler oder Hinweis melden'], f'{tag}: Einträge in Abschnitten, ohne Kraftstoffpreis ({items})')
    check([t.strip().lower() for t in pg.locator('#report-menu .rm-abschnitt').all_inner_texts()] == ['gerade vor ort', 'standort verbessern', 'fehler und hinweise'], f'{tag}: drei Abschnitte')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_4sheet.png'))
    # Ein Tipp sendet sofort
    st['mode'] = 'sperre'
    pg.click('#report-menu .lage-typ[data-typ=parkplatz_voll]'); pg.wait_for_selector('#report-menu .lage-status:not([hidden])')
    check('warte eine Stunde' in pg.inner_text('#report-menu .lage-status') and pg.locator('#report-menu .lage-typ:disabled').count() == 0, f'{tag}: Sperre wird im Menü angezeigt, Knöpfe wieder frei')
    st['mode'] = 'ok'; n0 = len(st['posts'])
    pg.click('#report-menu .lage-typ[data-typ=parkplatz_voll]'); pg.wait_for_selector('#report-menu[open]', state='detached', timeout=5000)
    check(len(st['posts']) == n0 + 1 and st['posts'][-1]['body'] == {'standortId': 'node/1', 'typ': 'parkplatz_voll', 'notiz': ''} and 'Danke' in pg.inner_text('#toast'),
          f'{tag}: Ein Tipp sendet die Meldung sofort, Menü schließt mit Dank')
    pg.click(opener); pg.wait_for_selector('#report-menu[open] .lage-frage:not([hidden])', timeout=8000)
    pg.click('#report-menu .lage-mehr'); pg.wait_for_selector('#dlg[open] .lf-grid')
    check('du bist 80 m entfernt' in pg.inner_text('#dlg .pf-place') and pg.locator('#dlg .lf-back').count() == 1, f'{tag}: Lage melden mit Entfernung und Zurück-Pfeil')
    pg.screenshot(path=str(SHOTS / f'meld_{"m" if mobile else "d"}_5lage.png'))
    pg.click('#dlg .lf-back'); pg.wait_for_selector('#report-menu[open]')
    check(pg.locator('#dlg[open]').count() == 0, f'{tag}: Zurück führt zu „Was möchtest du melden?“')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    # „Angaben ergänzen“ aus dem Menü: Standortauswahl nur Slipanlagen → Formular
    pg.click(opener); pg.wait_for_selector('#report-menu[open]')
    pg.locator('#report-menu .rm-item', has_text='Angaben ergänzen').click(); pg.wait_for_selector('#pickbar:not([hidden])')
    check('Slipanlage, die du ergänzen' in pg.inner_text('#pickbar'), f'{tag}: „Angaben ergänzen“ startet die Standortauswahl')
    r = pg.evaluate("window.__watermap.selectPlace('node/5000')"); pg.wait_for_timeout(150)
    check(r is False and pg.locator('dialog.ae-dlg[open]').count() == 0, f'{tag}: Hafen wird für „Angaben ergänzen“ nicht angenommen')
    pg.evaluate("window.__watermap.selectPlace('node/1')"); pg.wait_for_selector('dialog.ae-dlg[open]')
    check(pg.locator('dialog.ae-dlg[open]').count() == 1, f'{tag}: Formular „Angaben ergänzen“ öffnet für die gewählte Slipanlage')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    ctx.close()

    ctx, pg, st = page(b, mobile, geo=None)   # Standortabfrage abgelehnt
    pg.goto(uf.BASE); pg.wait_for_selector('.cat-slip'); pg.wait_for_timeout(400)
    pg.click(opener); pg.wait_for_selector('#report-menu[open]'); pg.wait_for_timeout(600)
    check(pg.locator('#report-menu .lage-frage').is_hidden(), f'{tag}: ohne Position kein Vorschlag')
    pg.click('#report-menu .lage-main'); pg.wait_for_selector('#pickbar:not([hidden])')
    check('Slipanlage, an der du gerade bist' in pg.inner_text('#pickbar'), f'{tag}: Eintrag startet die Standortauswahl')
    r = pg.evaluate("window.__watermap.selectPlace('node/5000')"); pg.wait_for_timeout(200)
    check(r is False and pg.locator('#dlg[open]').count() == 0 and pg.locator('#pickbar').is_visible(), f'{tag}: Hafen wird für die Lagemeldung nicht angenommen')
    pg.evaluate("window.__watermap.selectPlace('node/2')"); pg.wait_for_selector('#dlg[open] .lf-grid')
    check('TEST Slip 2' in pg.inner_text('#dlg .pf-place'), f'{tag}: gewählter Standort im Formular')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    # „Heute vor Ort“ nur bei Slipanlagen
    pg.evaluate("window.__watermap.selectPlace('node/5000', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(300)
    check('TEST Marina 0' in pg.inner_text('#detail') and pg.locator('#detail #heute-vor-ort').count() == 0 and pg.locator('#detail .vo-melden').count() == 0,
          f'{tag}: Hafen ohne „Heute vor Ort“ und „Lage melden“')
    pg.evaluate("window.__watermap.selectPlace('node/2', { full: true })"); pg.wait_for_selector('#detail #heute-vor-ort')
    # Offline: Stand von …, Melden aus
    ctx.set_offline(True); st['mode'] = 'down'
    pg.evaluate("window.dispatchEvent(new Event('offline'))")
    pg.evaluate("window.__watermap.selectPlace('node/1', { full: true })"); pg.wait_for_selector('#detail .vo-kopf small')
    check('Offline' in pg.inner_text('#detail .vo-kopf'), f'{tag}: offline mit Hinweis auf den Stand')
    check(pg.locator('#detail .vo-melden').is_disabled(), f'{tag}: offline ist „Lage melden“ aus')
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
