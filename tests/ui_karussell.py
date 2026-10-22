"""UI-Test des Foto-Karussells in der Detailansicht (public/js/photos.js) unter der echten CSP.
Start: python3 tests/ui_karussell.py [screenshot-ordner]   (braucht playwright)"""
import functools, json, pathlib, re, struct, sys, tempfile, threading, zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8781
CSP = [l.split(':', 1)[1].strip() for l in (ROOT / '_headers').read_text().splitlines() if 'Content-Security-Policy' in l][0]

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP); super().end_headers()
    def log_message(self, *a): pass

def png(rgb, w=40, h=30):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')

slips = json.loads((ROOT / 'data/osm/slip.geojson').read_text(encoding='utf-8'))['features']
MANY, ONE = slips[0]['id'], slips[1]['id']
OVERRIDES = json.dumps([
    {'id': MANY, 'status': 'approved', 'updated': '2026-10-20', 'photos': [
        {'url': 'photos/t-1.png', 'credit': 'WaterMap-Community', 'alt': 'Rampe bei Niedrigwasser'},
        {'url': 'photos/t-2.png', 'credit': 'Edwin D.', 'alt': '<b>Steg</b> von oben'},
        {'url': 'photos/t-3.png', 'credit': 'WaterMap-Community', 'alt': ''}]},
    {'id': ONE, 'status': 'approved', 'updated': '2026-10-20', 'photos': [{'url': 'photos/t-9.png', 'credit': 'X', 'alt': 'Einzelfoto'}]}])
IMAGES = {'t-1': png((200, 30, 30)), 't-2': png((30, 160, 60)), 't-3': png((30, 60, 200)), 't-9': png((120, 120, 120))}

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [('desktop', {'width': 1280, 'height': 900}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        print(f'--- {name}')
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, locale='de-DE', service_workers='block')
        ctx.route('**/data/community/overrides.json', lambda r: r.fulfill(status=200, content_type='application/json', body=OVERRIDES))
        ctx.route(re.compile(r'.*/photos/t-\d\.png$'), lambda r: r.fulfill(status=200, content_type='image/png', body=IMAGES[r.request.url.rsplit('/', 1)[1][:-4]]))
        ctx.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
        ctx.route(re.compile(r'https://.*'), lambda r: r.abort())
        ctx.add_init_script("document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI));")
        ctx.add_init_script("try { localStorage.setItem('watermap.geoAsked', '1'); localStorage.setItem('watermap.cats', 'slip'); } catch {}")
        pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)   # Kacheln sind absichtlich blockiert
        pg.goto(f'http://127.0.0.1:{PORT}/#p={MANY}')
        frame = pg.locator('#detail .ph-frame'); frame.wait_for()
        count = lambda: pg.inner_text('#detail .ph-count')
        src = lambda: pg.get_attribute('#detail .ph-frame img >> nth=-1', 'src')   # beim Wechsel liegen kurz zwei Bilder übereinander
        pg.locator('#detail .ph-frame img').first.wait_for()            # erstes Bild erscheint nach dem Dekodieren
        check(pg.locator('#detail .ph-frame img').count() == 1 and count() == '1 / 3', f'{name}: ein Bild, Zähler 1 / 3')
        check(pg.evaluate("getComputedStyle([...document.querySelectorAll('#detail .ph-frame img')].pop()).objectFit") == 'cover', f'{name}: Foto füllt das Bildfeld')
        check('Rampe bei Niedrigwasser' in pg.inner_text('#detail .ph-meta') and 'Foto: WaterMap-Community' in pg.inner_text('#detail .ph-meta'), f'{name}: Beschreibung und Urheber')
        pg.click('#detail .ph-next'); pg.locator('#detail .ph-frame img[src$="t-2.png"]').wait_for()
        check(count() == '2 / 3' and src().endswith('t-2.png'), f'{name}: Pfeil weiter')
        check('<b>Steg</b> von oben' in pg.inner_text('#detail .ph-caption') and pg.locator('#detail .ph-caption b').count() == 0, f'{name}: Beschreibung bleibt Text')
        pg.click('#detail .ph-prev'); pg.click('#detail .ph-prev')
        check(count() == '3 / 3' and pg.locator('#detail .ph-caption').is_hidden(), f'{name}: Pfeil zurück, rundherum; ohne Beschreibung keine Zeile')
        frame.focus(); pg.keyboard.press('ArrowRight')
        check(count() == '1 / 3', f'{name}: Pfeiltaste')
        box = frame.bounding_box(); y = box['y'] + box['height'] / 2
        pg.evaluate("""([x0, x1, y]) => { const f = document.querySelector('#detail .ph-frame');
            f.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: x0, clientY: y, bubbles: true }));
            f.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: x1, clientY: y + 5, bubbles: true })); }""",
                    [box['x'] + box['width'] * .8, box['x'] + box['width'] * .2, y])
        check(count() == '2 / 3', f'{name}: Wischen nach links → nächstes Foto')
        pg.wait_for_timeout(600)
        check(pg.locator('#detail .ph-frame img').count() == 1 and src().endswith('t-2.png'), f'{name}: nach dem Übergang bleibt genau ein Bild')
        pg.screenshot(path=str(SHOTS / f'karussell_{name}.png'))
        # Vollbild
        pg.click('#detail .ph-frame img >> nth=-1')
        lb = pg.locator('dialog.lightbox[open]'); lb.wait_for()
        check(pg.inner_text('dialog.lightbox .ph-count') == '2 / 3', f'{name}: Vollbild öffnet beim aktuellen Foto')
        check(pg.evaluate("getComputedStyle([...document.querySelectorAll('dialog.lightbox img')].pop()).objectFit") == 'contain', f'{name}: Vollbild zeigt das ganze Foto')
        pg.keyboard.press('ArrowRight'); pg.locator('dialog.lightbox img[src$="t-3.png"]').wait_for()
        check(pg.inner_text('dialog.lightbox .ph-count') == '3 / 3' and pg.get_attribute('dialog.lightbox img >> nth=-1', 'src').endswith('t-3.png'), f'{name}: Vollbild blättert')
        pg.wait_for_timeout(200)                     # Bild fertig dekodieren lassen (Screenshot)
        pg.screenshot(path=str(SHOTS / f'karussell_{name}_vollbild.png'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check(pg.locator('dialog.lightbox').count() == 0 and pg.locator('#detail').is_visible(), f'{name}: Escape schließt nur das Vollbild')
        # Foto melden
        pg.click('#detail .ph-report'); pg.wait_for_selector('#dlg[open]')
        check('Foto unpassend: photos/t-2.png' in pg.input_value('#dlg textarea[name=details]')
              and pg.locator('#dlg input[name=standort_id]').get_attribute('value') == MANY and pg.input_value('#dlg select[name=art]') == 'foto',
              f'{name}: „Foto melden“ füllt die Meldung vor')
        pg.click('#dlg-close')
        # Standort mit einem Foto: keine Pfeile, kein Zähler
        pg.evaluate(f"window.__watermap.selectPlace({json.dumps(ONE)})"); pg.locator('#detail .ph-caption', has_text='Einzelfoto').wait_for()
        check(pg.locator('#detail .ph-nav:visible').count() == 0 and pg.locator('#detail .ph-count').count() == 0, f'{name}: ein Foto ohne Pfeile und Zähler')
        csp = pg.evaluate('window.__csp || []')
        check(not errors and not csp, f'{name}: keine JS-/CSP-Fehler {errors[:3]} {csp[:3]}')
        ctx.close()
    b.close()
srv.shutdown()
print('\nFEHLER: ' + ('; '.join(problems) if problems else 'keine'))
sys.exit(1 if problems else 0)
