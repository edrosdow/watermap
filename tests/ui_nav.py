"""UI-Test der schwebenden Navigationsleiste (Handy, unter 768 px; Desktop bleibt oben): Maße und Glas, Symbole, Markierung mit
Dehn-Animation, Plopp, „Melden“, Zurück-Taste, Adressen, Abzeichen „neu“, reduzierte Bewegung, langes Drücken, erster Start,
Tastatur, nichts verdeckt (Seiten, Vorschau, Detail, Melden-Menü, Pegel-Ampel) – bei 375 und 390 px.
Start: python3 tests/ui_nav.py [screenshots-ordner]"""
import importlib.util, json, pathlib, re, tempfile, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ui_full', HERE / 'ui_full.py'); uf = importlib.util.module_from_spec(spec); spec.loader.exec_module(uf)
SHOTS = uf.SHOTS
NOW = int(time.time() * 1000)
problems = []
LABELS = ['Karte', 'Pegel', 'Melden', 'Meldungen', 'Mehr']
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def meldung(i, standort, minuten=5, typ='parkplatz_voll'):
    return {'id': f'm{i}', 'standortId': standort, 'typ': typ, 'notiz': None, 'erstelltAm': NOW - minuten * 60000, 'bestaetigt': 0, 'widersprochen': 0}

def page(b, w, hh, mobile=True, reduced=False, labels_gesehen=True, meldungen=()):
    ctx = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1, locale='de-DE', service_workers='block',
                        reduced_motion='reduce' if reduced else 'no-preference')
    uf.lib_routes(ctx)
    st = {'M': list(meldungen)}
    def api(route):
        r = route.request; u = r.url
        j = lambda body: route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
        if r.method == 'GET' and u.endswith('/api/meldungen/liste'): return j({'meldungen': st['M'], 'zeit': NOW})
        if r.method == 'GET' and u.endswith('/api/meldungen/aktiv'): return j({'aktiv': [], 'zeit': NOW})
        if r.method == 'GET': return j({'meldungen': [], 'zeit': NOW})
        return route.fulfill(status=404, body='{}')
    ctx.route('**/api/meldungen**', api)
    ctx.route('**/api/pegel/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
    if labels_gesehen: ctx.add_init_script("try { localStorage.setItem('wm-nav-labels-gesehen', '1'); } catch {}")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and '404' not in m.text else None)
    pg.errs = errs; pg.st = st
    return ctx, pg

def warte(pg, ausdruck, ms=5000):
    """Wartet, bis der JS-Ausdruck wahr ist (wait_for_function braucht eval, das die CSP der Seite verbietet)."""
    ende = time.time() + ms / 1000
    while time.time() < ende:
        if pg.evaluate(ausdruck): return True
        pg.wait_for_timeout(100)
    raise AssertionError(f'Zeit abgelaufen: {ausdruck}')

def rect(pg, sel):
    return pg.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }", sel)
cx = lambda r: r['x'] + r['w'] / 2
item = lambda n: f'#bottomnav [data-nav={n}]'
css = lambda pg, sel, prop: pg.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p]", [sel, prop])

def run(b, w, hh):
    tag = f'{w}px'
    print(f'--- {tag}')
    M = [meldung(1, 'node/1'), meldung(2, 'node/2', 20, 'gesperrt'), meldung(3, 'node/3', 50, 'alles_frei')]
    ctx, pg = page(b, w, hh, meldungen=M)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(700)

    # ---- Aussehen und Maße
    bar = rect(pg, '#bottomnav')
    c = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('#bottomnav')); return { pos: s.position, r: s.borderTopLeftRadius, bg: s.backgroundColor, bf: s.backdropFilter || s.webkitBackdropFilter || '', bw: s.borderTopWidth, z: s.zIndex }; })()")
    check(c['pos'] == 'fixed' and abs(bar['x'] - 16) <= 1 and abs(bar['x'] + bar['w'] - (w - 16)) <= 1 and abs(bar['y'] + bar['h'] - (hh - 28)) <= 1 and abs(bar['h'] - 68) <= 1,
          f'{tag}: Leiste schwebt (16 px seitlich, 28 px unten, 68 px hoch) {bar}')
    check(c['r'] == '34px' and c['bg'] == 'rgba(255, 255, 255, 0.82)' and 'blur(22px)' in c['bf'] and c['bw'] == '1px', f'{tag}: helles Glas, Ecken 34 px, Rand 1 px ({c})')
    labels = pg.locator('#bottomnav .bn-item').evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
    check([re.sub(r', .*$', '', l) for l in labels] == LABELS, f'{tag}: fünf Plätze in der Reihenfolge Karte · Pegel · Melden · Meldungen · Mehr ({labels})')
    check(all(t.strip() == '' or t.strip().isdigit() for t in pg.locator('#bottomnav .bn-item').all_inner_texts()) and pg.locator('#bottomnav .bn-label').count() == 0, f'{tag}: nur Symbole, kein sichtbarer Text')
    ws = [rect(pg, f'{item(n)}')['w'] for n in ['karte', 'pegel', 'melden', 'meldungen', 'mehr']]
    check(max(ws) - min(ws) <= 1 and all(rect(pg, item(n))['h'] >= 56 for n in ['karte', 'pegel', 'melden', 'meldungen', 'mehr']), f'{tag}: gleich breite Plätze, Trefferfläche ≥ 56 px ({ws})')
    sizes = pg.evaluate("['karte', 'pegel', 'meldungen', 'mehr'].map(n => document.querySelector(`#bottomnav [data-nav=${n}] svg`).getBoundingClientRect().width)")
    check(sizes == [26, 26, 26, 26], f'{tag}: Symbole 26 px ({sizes})')
    plus = rect(pg, '#bottomnav .bn-plus')
    check(abs(plus['w'] - 54) <= 0.5 and abs(plus['h'] - 54) <= 0.5 and plus['y'] >= bar['y'] and plus['y'] + plus['h'] <= bar['y'] + bar['h'] and css(pg, '#bottomnav .bn-plus', 'backgroundColor') == 'rgb(8, 127, 156)'
          and abs(rect(pg, '#bottomnav .bn-center svg')['w'] - 28) <= 0.5, f'{tag}: „Melden“ 54 px Petrol mit Plus 28 px, innerhalb der Leiste')
    check(css(pg, item('karte'), 'color') == 'rgb(8, 127, 156)' and css(pg, item('pegel'), 'color') == 'rgb(86, 104, 120)', f'{tag}: aktiv Petrol, inaktiv #566878')
    check(pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('#bottomnav [data-nav=karte] svg')); return s.fill + ' ' + s.fillOpacity; })()") == 'rgb(8, 127, 156) 0.3', f'{tag}: aktive Karte mit 30 % Füllung')
    ind = rect(pg, '#bottomnav .bn-ind'); k = rect(pg, item('karte'))
    ci = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('#bottomnav .bn-ind')); return { bg: s.backgroundColor, r: s.borderTopLeftRadius, sh: s.boxShadow, pe: s.pointerEvents }; })()")
    check(abs(cx(ind) - cx(k)) <= 1 and abs(ind['h'] - 56) <= 1 and abs(ind['w'] - (k['w'] - 6)) <= 1 and ci['r'] == '28px' and ci['bg'] == 'rgba(8, 127, 156, 0.14)' and 'rgba(8, 127, 156, 0.12)' in ci['sh'] and ci['pe'] == 'none',
          f'{tag}: Markierung 56 px hoch unter „Karte“, Petrol 14 % ({ind})')
    check(pg.get_attribute(item('karte'), 'aria-current') == 'page' and pg.locator('#bottomnav [aria-current]').count() == 1, f'{tag}: aria-current nur am aktiven Punkt')
    pg.screenshot(path=str(SHOTS / f'nav_{w}_1karte.png'))

    # ---- Wechsel Karte → Mehr: Dehnen, dann Zusammenziehen; Plopp
    pg.click(item('mehr')); pg.wait_for_timeout(50)
    mid = rect(pg, '#bottomnav .bn-ind')
    check(mid['w'] > k['w'] * 1.4 and 'scaleY(0.88)' in pg.evaluate("document.querySelector('#bottomnav .bn-ind').style.transform"), f'{tag}: Phase 1 – Markierung dehnt sich und wird flacher ({mid["w"]:.0f} px)')
    pg.wait_for_timeout(900)
    mehr = rect(pg, item('mehr')); ind = rect(pg, '#bottomnav .bn-ind')
    check(abs(cx(ind) - cx(mehr)) <= 1.5 and abs(ind['w'] - (mehr['w'] - 6)) <= 1.5 and pg.evaluate("document.querySelector('#bottomnav .bn-ind').style.transform") == '', f'{tag}: Phase 2 – zusammengezogen unter „Mehr“ ({ind})')
    check(pg.get_attribute(item('mehr'), 'aria-current') == 'page' and pg.get_attribute(item('karte'), 'aria-current') is None, f'{tag}: aria-current wandert mit')
    check(css(pg, item('mehr') + ' svg', 'strokeWidth') == '2.4px' or css(pg, item('mehr') + ' svg', 'strokeWidth') == '2.4', f'{tag}: aktives „Mehr“ mit dickerer Linie')
    pg.screenshot(path=str(SHOTS / f'nav_{w}_2mehr.png'))
    # Tipp auf den aktiven Punkt: keine Animation
    pg.click(item('mehr')); pg.wait_for_timeout(100)
    again = rect(pg, '#bottomnav .bn-ind')
    check(abs(again['w'] - ind['w']) <= 1 and abs(again['x'] - ind['x']) <= 1, f'{tag}: Tipp auf den aktiven Punkt animiert nicht')
    # Nachbar: Pegel; Plopp sofort nach dem Klick
    plop = pg.evaluate("(() => { const a = document.querySelector('#bottomnav [data-nav=pegel]'); a.click(); return a.classList.contains('is-plop'); })()")
    check(plop, f'{tag}: neues Symbol ploppt (is-plop)')
    pg.wait_for_timeout(1000)
    check(not pg.evaluate("document.querySelector('#bottomnav [data-nav=pegel]').classList.contains('is-plop')") and abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('pegel')))) <= 1.5, f'{tag}: Plopp vorbei, Markierung unter „Pegel“')

    # ---- Zurück-Taste und Adressen bewegen die Markierung ebenfalls
    pg.click(item('meldungen')); pg.wait_for_timeout(700)
    pg.go_back(); pg.wait_for_timeout(900)
    check(pg.get_attribute(item('pegel'), 'aria-current') == 'page' and abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('pegel')))) <= 1.5, f'{tag}: Zurück-Taste: Markierung wieder unter „Pegel“')
    pg.evaluate("location.hash = '#naehe'"); pg.wait_for_timeout(900)
    check(pg.get_attribute(item('mehr'), 'aria-current') == 'page' and abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('mehr')))) <= 1.5, f'{tag}: #naehe → „Mehr“ markiert, Markierung folgt')
    pg.evaluate("location.hash = '#favoriten'"); pg.wait_for_timeout(500)
    check(pg.get_attribute(item('mehr'), 'aria-current') == 'page', f'{tag}: #favoriten → „Mehr“ markiert')

    # ---- „Melden“: keine Markierung, nur Plopp; Menü liegt über der Leiste
    pg.click(item('karte')); pg.wait_for_timeout(900)
    vorher = rect(pg, '#bottomnav .bn-ind')
    plop = pg.evaluate("(() => { const a = document.querySelector('#bottomnav [data-nav=melden]'); a.click(); return a.classList.contains('is-plop'); })()")
    pg.wait_for_selector('#report-menu[open]'); pg.wait_for_timeout(500)
    nachher = rect(pg, '#bottomnav .bn-ind')
    check(plop and abs(nachher['x'] - vorher['x']) <= 1 and pg.get_attribute(item('melden'), 'aria-current') is None and pg.get_attribute(item('karte'), 'aria-current') == 'page',
          f'{tag}: „Melden“ – Plus ploppt, Markierung bleibt bei „Karte“, Menü offen')
    top = pg.evaluate("(() => { const b = document.querySelector('#bottomnav').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!e.closest('#report-menu'); })()")
    check(top, f'{tag}: Melden-Menü liegt über der Leiste')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check(pg.evaluate("(() => { const b = document.querySelector('#bottomnav').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height * 0.2); return !!e.closest('#bottomnav'); })()"), f'{tag}: danach ist die Leiste wieder da')

    # ---- Abzeichen „neu“ (die Übersicht wurde oben schon besucht: Stand zurücksetzen)
    pg.evaluate("localStorage.removeItem('watermap.meldungen.gesehen'); window.dispatchEvent(new Event('online'))")
    badge = pg.locator(f'{item("meldungen")} .nav-badge')
    warte(pg, "document.querySelector('#bottomnav [data-nav=meldungen] .nav-badge').textContent === '3'", 5000)
    bs = pg.evaluate("(() => { const b = document.querySelector('#bottomnav [data-nav=meldungen] .nav-badge'), s = getComputedStyle(b), i = document.querySelector('#bottomnav [data-nav=meldungen] .bn-ico').getBoundingClientRect(), r = b.getBoundingClientRect();"
                     " return { bg: s.backgroundColor, col: s.color, bw: s.borderTopWidth, bc: s.borderTopColor, rechts: r.x + r.width / 2 > i.x + i.width / 2, oben: r.y + r.height / 2 < i.y + i.height / 2, label: b.parentElement.getAttribute('aria-label') }; })()")
    check(bs['bg'] == 'rgb(8, 127, 156)' and bs['col'] == 'rgb(255, 255, 255)' and bs['bw'] == '2px' and bs['bc'] == 'rgb(255, 255, 255)' and bs['rechts'] and bs['oben'], f'{tag}: Abzeichen Petrol, weißer Rand 2 px, oben rechts am Symbol ({bs})')
    check(bs['label'] == 'Meldungen, 3 neu', f'{tag}: aria-label „Meldungen, 3 neu“ ({bs["label"]})')
    pg.screenshot(path=str(SHOTS / f'nav_{w}_3abzeichen.png'))
    pg.click(item('meldungen')); pg.wait_for_timeout(500)
    check(badge.is_hidden() and pg.get_attribute(item('meldungen'), 'aria-label') == 'Meldungen', f'{tag}: Übersicht angesehen → Abzeichen weg')
    pg.click(item('karte')); pg.wait_for_timeout(500)
    check(badge.is_hidden(), f'{tag}: nach dem Verlassen bleibt es weg')
    pg.st['M'].append({**meldung(9, 'node/4'), 'erstelltAm': int(time.time() * 1000) + 5000})
    pg.evaluate("window.dispatchEvent(new Event('online'))")
    warte(pg, "document.querySelector('#bottomnav [data-nav=meldungen] .nav-badge').textContent === '1'", 5000)
    check(pg.get_attribute(item('meldungen'), 'aria-label') == 'Meldungen, 1 neu', f'{tag}: neue Meldung → „1 neu“')
    pg.reload(); pg.wait_for_selector('.leaflet-container')
    warte(pg, "document.querySelector('#bottomnav [data-nav=meldungen] .nav-badge').textContent === '1'", 5000)
    check(True, f'{tag}: Stand bleibt nach dem Neuladen')
    # Eigene Meldungen zählen nicht
    pg.evaluate("localStorage.setItem('watermap.meldungen.eigene', JSON.stringify(['m9']))"); pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(1200)
    check(pg.locator(f'{item("meldungen")} .nav-badge').is_hidden(), f'{tag}: eigene Meldungen zählen nicht als neu')

    # ---- Adresse beim Start: Markierung sofort, ohne Animation
    pg.goto(uf.BASE + '#meldungen'); pg.reload(); pg.wait_for_selector('#meldungsseite:not([hidden])'); pg.wait_for_timeout(300)
    check(abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('meldungen')))) <= 1.5 and 'none' in pg.evaluate("document.querySelector('#bottomnav .bn-ind').style.transition"), f'{tag}: Start bei #meldungen: Markierung sofort an der richtigen Stelle')

    # ---- Langes Drücken: Beschriftung als Blase, ohne zu navigieren
    pg.goto(uf.BASE + '#karte'); pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(500)
    pe = rect(pg, item('pegel'))
    pg.mouse.move(cx(pe), pe['y'] + pe['h'] / 2); pg.mouse.down(); pg.wait_for_timeout(600)
    tip = pg.locator('#bottomnav .bn-tip')
    tb = rect(pg, '#bottomnav .bn-tip') if tip.count() else None
    check(tip.count() == 1 and tip.inner_text() == 'Pegel' and tb['y'] + tb['h'] <= bar['y'] + 1, f'{tag}: langes Drücken zeigt „Pegel“ als Blase über dem Symbol')
    pg.mouse.up(); pg.wait_for_timeout(300)
    check(not pg.url.endswith('#pegel') and pg.get_attribute(item('karte'), 'aria-current') == 'page', f'{tag}: langes Drücken löst den Link nicht aus')
    pg.wait_for_timeout(1000)
    check(pg.locator('#bottomnav .bn-tip').count() == 0, f'{tag}: Blase verschwindet kurz nach dem Loslassen')
    pg.mouse.click(cx(pe), pe['y'] + pe['h'] / 2); pg.wait_for_timeout(400)
    check(pg.get_attribute(item('pegel'), 'aria-current') == 'page', f'{tag}: ein kurzer Tipp navigiert danach normal')

    # ---- Tastatur: Leiste ausblenden
    pg.click(item('karte')); pg.wait_for_timeout(500)
    pg.focus('#q'); pg.wait_for_timeout(500)
    check(pg.evaluate("document.querySelector('#bottomnav').classList.contains('is-weg')") and css(pg, '#bottomnav', 'visibility') == 'hidden', f'{tag}: Eingabefeld im Fokus → Leiste ausgeblendet')
    pg.evaluate("document.activeElement.blur()"); pg.wait_for_timeout(500)
    check(not pg.evaluate("document.querySelector('#bottomnav').classList.contains('is-weg')") and css(pg, '#bottomnav', 'visibility') == 'visible', f'{tag}: Fokus weg → Leiste wieder da')

    # ---- Nichts verdeckt
    bar = rect(pg, '#bottomnav')
    for adr, sel in [('#pegel', '#pegelseite'), ('#meldungen', '#meldungsseite'), ('#mehr', '#mehrseite')]:
        pg.goto(uf.BASE + adr); pg.reload(); pg.wait_for_selector(f'{sel}:not([hidden])'); pg.wait_for_timeout(700)
        tiefstes = pg.evaluate("""(sel) => { const sc = document.querySelector(sel); sc.scrollTop = sc.scrollHeight;
          return Math.max(...[...sc.querySelectorAll('*')].map(e => e.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom)); }""", sel)
        check(tiefstes <= bar['y'] + 1, f'{tag}: {adr[1:]}-Seite: der letzte Inhalt liegt über der Leiste ({tiefstes:.0f} ≤ {bar["y"]:.0f})')
    for adr in ['#naehe', '#favoriten']:
        pg.goto(uf.BASE + adr); pg.reload(); pg.wait_for_selector('#sidebar'); pg.wait_for_timeout(700)
        pb = float(re.sub('px', '', css(pg, '#list', 'paddingBottom')))
        check(pb >= hh - bar['y'] + 8, f'{tag}: Liste {adr}: unterer Abstand ≥ Leiste + Rand ({pb:.0f} px)')
    pg.goto(uf.BASE + '#karte'); pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(700)
    fab, nb = rect(pg, '#btn-locate'), rect(pg, '#btn-naehe-m')
    check(fab['y'] + fab['h'] <= bar['y'] - 16 and abs(fab['x'] + fab['w'] - (w - 20)) <= 1 and abs(fab['w'] - 48) <= 1 and nb['y'] + nb['h'] <= bar['y'] - 8, f'{tag}: Standort-Knopf (48 px, rechts 20 px) und „In der Nähe“ über der Leiste')
    gl = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('#btn-locate')); return { bg: s.backgroundColor, bf: s.backdropFilter || s.webkitBackdropFilter || '', r: s.borderTopLeftRadius }; })()")
    check(gl['bg'] == 'rgba(255, 255, 255, 0.82)' and 'blur(22px)' in gl['bf'] and gl['r'] in ('50%', '24px'), f'{tag}: Standort-Knopf im Glas-Stil ({gl})')
    pg.evaluate("window.__watermap.selectPlace('node/1')"); pg.wait_for_selector('#peek:not([hidden])'); pg.wait_for_timeout(300)
    pk = rect(pg, '#peek')
    check(pk['y'] + pk['h'] <= bar['y'] - 8, f'{tag}: Vorschau-Karte über der Leiste ({pk["y"] + pk["h"]:.0f} ≤ {bar["y"]:.0f})')
    pg.evaluate("window.__watermap.selectPlace('node/1', { full: true })"); pg.wait_for_selector('#detail:not([hidden])'); pg.wait_for_timeout(400)
    over = pg.evaluate("(() => { const b = document.querySelector('#bottomnav').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height * 0.2); return !!e.closest('#bottomnav'); })()")
    letzter = pg.evaluate("""() => { const sc = document.querySelector('#detail .detail-scroll'); sc.scrollTop = sc.scrollHeight;
      return Math.max(...[...document.querySelectorAll('#detail .detail-body > *')].map(e => e.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom)); }""")
    check(over and letzter <= bar['y'] + 1, f'{tag}: Detail reicht bis unten, die Leiste schwebt darüber; der letzte Inhalt liegt frei ({letzter:.0f} ≤ {bar["y"]:.0f})')
    pg.screenshot(path=str(SHOTS / f'nav_{w}_4detail.png'))
    check(not pg.errs, f'{tag}: keine JS-Fehler {pg.errs[:3]}')
    ctx.close()

    # ---- Pegel-Ampel: dieselbe Leiste, Seite lässt Platz
    ctx, pg = page(b, w, hh)
    pg.goto(uf.BASE + 'pegel-ampel.html'); pg.wait_for_selector('#am-q'); pg.wait_for_timeout(700)
    b2 = rect(pg, '#bottomnav')
    check(abs(b2['y'] + b2['h'] - (hh - 28)) <= 1 and pg.get_attribute(item('pegel'), 'aria-current') == 'page' and abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('pegel')))) <= 1.5,
          f'{tag}: Pegel-Ampel: gleiche Leiste, „Pegel“ markiert')
    tiefstes = pg.evaluate("() => { window.scrollTo(0, document.documentElement.scrollHeight); return Math.max(...[...document.querySelectorAll('body > *:not(nav):not(script)')].map(e => e.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom)); }")
    check(tiefstes <= b2['y'] + 1, f'{tag}: Pegel-Ampel: der letzte Inhalt liegt über der Leiste ({tiefstes:.0f} ≤ {b2["y"]:.0f})')
    check(not pg.errs, f'{tag}: Pegel-Ampel ohne JS-Fehler {pg.errs[:3]}')
    ctx.close()

def sonderfaelle(b):
    print('--- Sonderfälle')
    # reduzierte Bewegung: kein Dehnen, kein Ploppen, 120 ms linear
    ctx, pg = page(b, 390, 844, reduced=True)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(600)
    k = rect(pg, item('karte'))
    plop = pg.evaluate("(() => { const a = document.querySelector('#bottomnav [data-nav=mehr]'); a.click(); return a.classList.contains('is-plop'); })()")
    pg.wait_for_timeout(50)
    mid = rect(pg, '#bottomnav .bn-ind')
    tr = pg.evaluate("document.querySelector('#bottomnav .bn-ind').style.transition")
    check(not plop and abs(mid['w'] - (k['w'] - 6)) <= 1 and '120ms linear' in tr and pg.evaluate("document.querySelector('#bottomnav .bn-ind').style.transform") == '', f'reduzierte Bewegung: kein Plopp, kein Dehnen, 120 ms linear ({tr})')
    pg.wait_for_timeout(300)
    check(abs(cx(rect(pg, '#bottomnav .bn-ind')) - cx(rect(pg, item('mehr')))) <= 1.5, 'reduzierte Bewegung: Markierung am Ziel')
    ctx.close()
    # erster Start: alle fünf Beschriftungen einmalig
    ctx, pg = page(b, 390, 844, labels_gesehen=False)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('#bottomnav .bn-tip', timeout=8000)
    tips = [t.strip() for t in pg.locator('#bottomnav .bn-tip').all_inner_texts()]
    check(tips == LABELS and pg.evaluate("localStorage.getItem('wm-nav-labels-gesehen')") == '1', f'erster Start: alle fünf Beschriftungen über der Leiste ({tips})')
    warte(pg, "document.querySelectorAll('#bottomnav .bn-tip').length === 0", 6000)
    check(True, 'erster Start: nach ca. 3 Sekunden wieder weg')
    pg.reload(); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(2500)
    check(pg.locator('#bottomnav .bn-tip').count() == 0, 'zweiter Start: keine Beschriftungen mehr (gemerkt)')
    ctx.close()
    # Desktop: Leiste unten weg, Navigation oben wie bisher
    ctx, pg = page(b, 1024, 768, mobile=False)
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(600)
    texte = [t.strip() for t in pg.locator('#topnav [data-nav]').all_inner_texts()]
    check(pg.locator('#bottomnav').is_hidden() and pg.locator('#topnav').is_visible() and texte == ['Karte', 'Pegel', 'Meldungen', 'Mehr'] and pg.locator('#topnav .nav-badge').count() == 0, f'Desktop: Navigation oben unverändert, keine Leiste unten ({texte})')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(375, 667), (390, 844)]:
                run(b, w, hh)
            sonderfaelle(b)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
