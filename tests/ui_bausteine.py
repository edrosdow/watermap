"""UI-Test der gemeinsamen Bausteine (js/bausteine.js, css/bausteine.css – Designumbau Phase 1):
Markup und aria-* von kopf/zeile/gruppe/aktionen/marke/hinweis/chip/seg, Sheet-Rahmen sheetOeffnen (Handy von unten, Desktop Panel rechts),
Stapeln, Esc/×/Wischen schließen, Fokus zurück an den Auslöser, Griff (klein/groß), Einrasten mit echten Touch-Ereignissen (CDP),
„Bewegung reduzieren“ wartet nicht.
Start: python3 tests/ui_bausteine.py [screenshots-ordner]"""
import pathlib, tempfile
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / 'ui_nav.py').read_text(encoding='utf-8').split("with tempfile.TemporaryDirectory()")[0]
ns = {'__file__': str(HERE / 'ui_nav.py'), '__name__': 'ui_nav_lib'}; exec(compile(src, 'ui_nav.py', 'exec'), ns)
uf, page, rect = ns['uf'], ns['page'], ns['rect']
SHOTS = uf.SHOTS
problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

def wisch(pg, x, y0, dy, schritte=8, pause=12):
    c = pg.context.new_cdp_session(pg)
    pt = lambda i: [{'x': x, 'y': y0 + dy * i / schritte}]
    c.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt(0)})
    for i in range(1, schritte + 1):
        c.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pt(i)}); pg.wait_for_timeout(pause)
    c.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    pg.wait_for_timeout(650)

IMPORT = "const B = await import('./js/bausteine.js');"

def bausteine(pg, tag):
    r = pg.evaluate("""async () => { %s
      const out = {};
      const zu = []; const k = B.kopf({ titel: 'Slip Vössen', unter: 'Slipanlage · Weser', onZu: () => zu.push(1), aktion: { icon: 'share', label: 'Teilen', onclick: () => {} } });
      document.body.append(k);
      out.kopf = { h2: k.querySelector('h2.wm-kopf-titel').textContent, tab: k.querySelector('h2').getAttribute('tabindex'), unter: k.querySelector('.wm-kopf-unter').textContent,
        knoepfe: [...k.querySelectorAll('button.wm-rund')].map(b => b.getAttribute('aria-label')), titelLinks: k.querySelector('h2').getBoundingClientRect().left < k.querySelector('.wm-zu').getBoundingClientRect().left };
      k.querySelector('.wm-zu').click(); out.kopf.zu = zu.length; k.remove();
      const z1 = B.zeile({ ico: 'gauge', titel: 'Vlotho', unter: 'Weser · fallend', rechts: { wert: '182 cm' }, onClick: () => {} });
      const z2 = B.zeile({ ico: 'map', titel: 'Slip Rinteln', unter: 'Slipanlage', href: '#p=1' });
      const z3 = B.zeile({ ico: 'gauge', titel: 'Rinteln', rechts: { marke: { zustand: 'warn', text: '164 cm' } } });
      const g = B.gruppe([z1, z2, z3], { label: 'Pegel' }); document.body.append(g);
      out.zeilen = [z1, z2, z3].map(z => ({ tag: z.tagName, typ: z.getAttribute('type'), href: z.getAttribute('href'), rechts: z.lastElementChild.className,
        icoHidden: z.querySelector('.wm-kachel-ico').getAttribute('aria-hidden'), h: Math.round(z.getBoundingClientRect().height) }));
      out.gruppe = { role: g.getAttribute('role'), label: g.getAttribute('aria-label'), linie: getComputedStyle(z2).borderTopWidth, radius: getComputedStyle(g).borderRadius };
      g.remove();
      const m = B.marke('hoch', 'Hoch'); out.marke = { cls: m.className, text: m.textContent, punkt: m.querySelector('i').getAttribute('aria-hidden') };
      const hw = B.hinweis({ zustand: 'gut', text: 'Heute keine Probleme gemeldet', ico: 'check', aktion: { text: 'Lage melden', onclick: () => {} } });
      out.hinweis = { cls: hw.className, knopf: hw.querySelector('button').textContent, typ: hw.querySelector('button').type };
      const a = B.aktionen([{ icon: 'route', text: 'Route', primaer: true, href: '#' }, { icon: 'star', text: 'Gemerkt', gemerkt: true, onclick: () => {} }, { icon: 'share', text: 'Teilen', onclick: () => {} }]);
      document.body.append(a);
      out.aktionen = [...a.children].map(x => ({ tag: x.tagName, cls: x.className, pressed: x.getAttribute('aria-pressed'), h: Math.round(x.getBoundingClientRect().height) }));
      a.remove();
      const wahl = []; const c = B.chip({ text: 'Pegel', farbe: 'var(--wm-gut)', onWahl: (an) => { wahl.push(an); } });
      const c2 = B.chip({ text: 'Slip', an: true, onWahl: () => false });
      document.body.append(c, c2);
      out.chip = { vorher: c.getAttribute('aria-pressed'), h: Math.round(c.getBoundingClientRect().height), punkt: !!c.querySelector('.wm-chip-punkt'), haken: c.querySelector('.wm-chip-haken').getAttribute('aria-hidden') };
      c.click(); out.chip.nachher = c.getAttribute('aria-pressed'); out.chip.wahl = wahl;
      c2.click(); out.chip.gesperrt = c2.getAttribute('aria-pressed');
      c.remove(); c2.remove();
      const gew = []; const s = B.seg({ label: 'Zeitraum', wert: 't24', optionen: [{ wert: 't24', text: '24 Std.' }, { wert: 't7', text: '7 Tage' }, { wert: 't30', text: '30 Tage' }], onWahl: (w) => gew.push(w) });
      document.body.append(s);
      s.querySelectorAll('button')[2].click(); s.querySelectorAll('button')[2].click();
      out.seg = { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), pressed: [...s.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')), i: s.style.getPropertyValue('--i'), gew };
      s.remove();
      return out; }""" % IMPORT)
    check(r['kopf']['h2'] == 'Slip Vössen' and r['kopf']['tab'] == '-1' and r['kopf']['unter'] == 'Slipanlage · Weser' and r['kopf']['knoepfe'] == ['Teilen', 'Schließen'] and r['kopf']['titelLinks'] and r['kopf']['zu'] == 1,
          f'{tag}: kopf – Titel links (h2, tabindex -1), Unterzeile, Zusatzaktion links neben ×, × ruft onZu {r["kopf"]}')
    z = r['zeilen']
    check(z[0]['tag'] == 'BUTTON' and z[0]['typ'] == 'button' and z[0]['rechts'] == 'wm-zeile-wert' and z[1]['tag'] == 'A' and z[1]['href'] == '#p=1' and z[1]['rechts'] == 'wm-pfeil'
          and z[2]['tag'] == 'DIV' and z[2]['rechts'] == 'wm-marke is-warn' and all(x['icoHidden'] == 'true' and x['h'] >= 64 for x in z), f'{tag}: zeile – Knopf/Link/Anzeige, rechts Wert/Pfeil/Marke, ≥ 64 px {z}')
    check(r['gruppe'] == {'role': 'group', 'label': 'Pegel', 'linie': '1px', 'radius': '18px'}, f'{tag}: gruppe – Radius m, Linie zwischen Zeilen {r["gruppe"]}')
    check(r['marke'] == {'cls': 'wm-marke is-hoch', 'text': 'Hoch', 'punkt': 'true'}, f'{tag}: marke – Zustand mit Wort {r["marke"]}')
    check(r['hinweis'] == {'cls': 'wm-hinweis is-gut', 'knopf': 'Lage melden', 'typ': 'button'}, f'{tag}: hinweis {r["hinweis"]}')
    a = r['aktionen']
    check(a[0]['tag'] == 'A' and 'is-primaer' in a[0]['cls'] and a[1]['pressed'] == 'true' and 'is-gemerkt' in a[1]['cls'] and a[2]['pressed'] is None and all(x['h'] == 62 for x in a),
          f'{tag}: aktionen – primär, Merken mit aria-pressed, 62 px {a}')
    c = r['chip']
    check(c['vorher'] == 'false' and c['nachher'] == 'true' and c['wahl'] == [True] and c['gesperrt'] == 'true' and c['h'] == 40 and c['punkt'] and c['haken'] == 'true',
          f'{tag}: chip – aria-pressed schaltet, onWahl false hält fest, 40 px, Punkt + Häkchen {c}')
    s = r['seg']
    check(s['role'] == 'group' and s['label'] == 'Zeitraum' and s['pressed'] == ['false', 'false', 'true'] and s['i'].strip() == '2' and s['gew'] == ['t30'],
          f'{tag}: seg – aria-pressed, Markierung --i, onWahl nur bei Wechsel {s}')

def sheets(pg, tag, mobile, w, hh):
    # öffnen, Fokus, Rolle, Lage
    pg.evaluate("""async () => { %s
      const knopf = document.createElement('button'); knopf.id = 'test-ausloeser'; knopf.textContent = 'öffnen'; document.body.append(knopf); knopf.focus();
      window.__zu = [];
      window.__s1 = B.sheetOeffnen({ kopf: { titel: 'Gemerkt', unter: '2 Pegel · 1 Ort' }, inhalt: [B.gruppe([B.zeile({ ico: 'gauge', titel: 'Vlotho', onClick: () => {} })])],
        klein: '40%%', onZu: () => window.__zu.push('s1') }); }""" % IMPORT)
    pg.wait_for_timeout(600)
    # langsamer Rechner: warten, bis das Sheet ganz eingefahren ist (keine laufende Animation mehr)
    pg.wait_for_function("() => { const el = document.querySelector('.wm-sheet'); return el && !el.getAnimations().length && getComputedStyle(el).transform.replace(/\s/g, '') in { 'none': 1, 'matrix(1,0,0,1,0,0)': 1 }; }", timeout=5000)
    info = pg.evaluate("""() => { const el = document.querySelector('.wm-sheet'); const r = el.getBoundingClientRect(); const t = el.querySelector('.wm-kopf-titel');
      return { role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'), labelledby: el.getAttribute('aria-labelledby') === t.id, fokus: document.activeElement === t,
        offen: el.classList.contains('is-offen'), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), Math.round(r.width)],
        griff: getComputedStyle(el.querySelector('.wm-griff')).display, expanded: el.querySelector('.wm-griff').getAttribute('aria-expanded'),
        zIndex: +el.style.zIndex }; }""")
    check(info['role'] == 'dialog' and info['modal'] == 'false' and info['labelledby'] and info['fokus'] and info['offen'], f'{tag}: Sheet – role=dialog, nicht modal, Titel als Name und Fokus {info}')
    if mobile:
        check(info['r'][0] == 0 and info['r'][2] == w and info['r'][3] == hh and info['griff'] != 'none' and info['expanded'] == 'true', f'{tag}: Handy – von unten über die ganze Breite, Griff sichtbar {info["r"]}')
    else:
        check(info['r'][2] == w and info['r'][4] == 420 and info['r'][3] == hh and info['r'][1] >= 100 and info['griff'] == 'none', f'{tag}: Desktop – Panel rechts 420 px unter der Kopfleiste, ohne Griff {info["r"]}')
    pg.screenshot(path=str(SHOTS / f'bausteine_{w}_sheet.png'))

    # stapeln: zweites Sheet aus dem ersten heraus
    pg.evaluate("""async () => { %s
      const b = document.createElement('button'); b.id = 'test-in-s1'; b.textContent = 'Pegel'; window.__s1.inhalt.append(b); b.focus();
      window.__s2 = B.sheetOeffnen({ kopf: { titel: 'Pegel Vlotho' }, inhalt: [B.marke('gut', 'Normal')], onZu: () => window.__zu.push('s2') }); }""" % IMPORT)
    pg.wait_for_timeout(600)
    st = pg.evaluate("() => { const s = [...document.querySelectorAll('.wm-sheet')]; return { n: s.length, z: s.map(e => +e.style.zIndex), fokus: document.activeElement.textContent }; }")
    check(st['n'] == 2 and st['z'][1] > st['z'][0] and st['fokus'] == 'Pegel Vlotho', f'{tag}: Stapeln – zweites Sheet liegt oben, Fokus auf seinem Titel {st}')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(650)
    st = pg.evaluate("() => ({ n: document.querySelectorAll('.wm-sheet').length, fokus: document.activeElement.id, zu: window.__zu })")
    check(st == {'n': 1, 'fokus': 'test-in-s1', 'zu': ['s2']}, f'{tag}: Esc schließt nur das oberste, Fokus zurück an den Auslöser im ersten Sheet {st}')

    if mobile:
        # Griff: klein ↔ groß
        pg.click('.wm-sheet .wm-griff'); pg.wait_for_timeout(600)
        k = pg.evaluate("() => { const el = document.querySelector('.wm-sheet'); return { klein: el.classList.contains('is-klein'), exp: el.querySelector('.wm-griff').getAttribute('aria-expanded'), top: Math.round(el.getBoundingClientRect().top), h: el.offsetHeight }; }")
        check(k['klein'] and k['exp'] == 'false' and abs((hh - k['top']) - round(k['h'] * 0.4)) <= 3, f'{tag}: Griff – Stufe klein (40 % sichtbar), aria-expanded=false {k}')
        # Touch: kurz ziehen → bleibt klein; hochziehen → groß; weit runter → zu
        top = k['top']
        wisch(pg, w / 2, top + 10, 30, schritte=4, pause=60)
        k2 = pg.evaluate("() => { const el = document.querySelector('.wm-sheet'); return { klein: el.classList.contains('is-klein'), tf: el.style.transform, top: Math.round(el.getBoundingClientRect().top) }; }")
        check(k2['klein'] and k2['tf'] == '' and abs(k2['top'] - top) <= 2, f'{tag}: Wischen kurz – federt in „klein“ zurück, keine Inline-Lage übrig {k2}')
        wisch(pg, w / 2, top + 10, -(top - 120), schritte=10, pause=16)
        k3 = pg.evaluate("() => { const el = document.querySelector('.wm-sheet'); return { klein: el.classList.contains('is-klein'), tf: el.style.transform, exp: el.querySelector('.wm-griff').getAttribute('aria-expanded') }; }")
        check(not k3['klein'] and k3['tf'] == '' and k3['exp'] == 'true', f'{tag}: Hochwischen – rastet in „groß“ ein {k3}')
        t = rect(pg, '.wm-sheet')['y']
        wisch(pg, w / 2, t + 10, 150, schritte=10, pause=60)   # 8.0.6: aus „groß“ ein mittlerer, langsamer Zug schließt direkt (kein Halt in „klein“)
        pg.wait_for_timeout(600)
        st = pg.evaluate("() => ({ n: document.querySelectorAll('.wm-sheet').length, fokus: document.activeElement.id, zu: window.__zu })")
        check(st == {'n': 0, 'fokus': 'test-ausloeser', 'zu': ['s2', 's1']}, f'{tag}: Runterwischen aus „groß“ – Sheet direkt zu, Fokus zurück an den Auslöser {st}')
    else:
        pg.click('.wm-sheet .wm-zu'); pg.wait_for_timeout(650)
        st = pg.evaluate("() => ({ n: document.querySelectorAll('.wm-sheet').length, fokus: document.activeElement.id, zu: window.__zu })")
        check(st == {'n': 0, 'fokus': 'test-ausloeser', 'zu': ['s2', 's1']}, f'{tag}: × schließt, Fokus zurück an den Auslöser {st}')

def ruhig(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce', service_workers='block')
    uf.lib_routes(ctx); pg = ctx.new_page()
    pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container')
    r = pg.evaluate("""async () => { %s
      const s = B.sheetOeffnen({ kopf: { titel: 'Mehr' }, inhalt: [] });
      const offenSofort = getComputedStyle(s.el).transitionDuration;
      s.schliessen();
      return { dauer: offenSofort, weg: !document.querySelector('.wm-sheet') }; }""" % IMPORT)
    check(r['weg'] and r['dauer'] == '0.001s', f'Bewegung reduzieren: Übergang 1 ms, Schließen ohne Warten {r}')
    ctx.close()

with tempfile.TemporaryDirectory() as t:
    site = uf.build_site(pathlib.Path(t)); srv = uf.serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w, hh in [(390, 844), (1440, 900)]:
                mobile = w < 768; tag = f'{w}px'; print(f'--- {tag}')
                ctx, pg = page(b, w, hh, mobile)
                pg.goto(uf.BASE + '#karte'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(500)
                bausteine(pg, tag)
                sheets(pg, tag, mobile, w, hh)
                ctx.close()
            ruhig(b)
            b.close()
    finally:
        srv.shutdown()
print('FEHLER:', problems if problems else 'keine')
