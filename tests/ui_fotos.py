"""UI-Test der Foto-Freigabe (public/admin/fotos.html) mit nachgebauter Funktion.
Start: python3 tests/ui_fotos.py [screenshot-ordner]   (braucht playwright)"""
import functools, json, pathlib, sys, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8779
CSP = [l.split(':', 1)[1].strip() for l in (ROOT / '_headers').read_text().splitlines() if 'Content-Security-Policy' in l][0]

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP); super().end_headers()
    def log_message(self, *a): pass

PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2a2c1b10000000049454e44ae426082')
FOTOS = [{'id': 's1', 'created': '2026-10-20T12:00:00Z', 'standort_id': 'node/632876845', 'standort_name': 'Slip Vössen',
          'beschreibung': '<b>Rampe</b> bei Niedrigwasser', 'rechte': True, 'hat_foto': True},
         {'id': 's2', 'created': '2026-10-20T13:00:00Z', 'standort_id': 'node/1', 'standort_name': 'Ohne Rechte',
          'beschreibung': 'x', 'rechte': False, 'hat_foto': True},
         {'id': 's3', 'created': '2026-10-20T14:00:00Z', 'standort_id': '__other', 'standort_name': 'Porta In Vössen',
          'beschreibung': 'Slipanlage', 'rechte': True, 'hat_foto': True}]
PUBLISHED = [{'standort_id': 'node/5', 'url': 'photos/a.jpg', 'alt': 'Babybett', 'credit': 'WaterMap-Community'},
             {'standort_id': 'node/5', 'url': 'photos/b.jpg', 'alt': '', 'credit': 'WaterMap-Community'}]
posted = []

def api(route):
    r = route.request
    if r.headers.get('x-passwort') != 'geheim':
        return route.fulfill(status=401, content_type='application/json', body='{"fehler":"Passwort falsch."}')
    if r.method == 'GET' and 'veroeffentlicht' in r.url:
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'fotos': PUBLISHED}))
    if r.method == 'GET' and ('bild=' in r.url or 'datei=' in r.url):
        return route.fulfill(status=200, content_type='image/png', body=PNG)
    if r.method == 'GET':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'fotos': FOTOS}))
    posted.append(json.loads(r.post_data))
    route.fulfill(status=200, content_type='application/json', body='{"ok":true}')

problems = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: problems.append(msg)

srv = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '401' not in m.text else None)
    pg.route('**/.netlify/functions/fotos**', api)
    pg.goto(f'http://127.0.0.1:{PORT}/admin/fotos.html')
    pg.fill('#pw', 'falsch'); pg.click('#login button')
    pg.locator('#msg', has_text='Passwort falsch').wait_for()     # CSP verbietet eval → keine wait_for_function
    check(pg.locator('.card').count() == 0, 'falsches Passwort: nichts sichtbar')
    pg.fill('#pw', 'geheim'); pg.click('#login button')
    pg.wait_for_selector('.card img[src^="blob:"]')
    check(pg.locator('.card').count() == 3 and '3 Foto(s)' in pg.inner_text('#msg'), 'Liste mit drei Einreichungen')
    other = pg.locator('.card >> nth=2')
    check(other.locator('button.ok').is_disabled() and 'Porta In Vössen' in other.inner_text(), 'ohne Standort: Freigeben gesperrt, Hinweis da')
    other.locator('input.where').fill('https://watermaps.netlify.app/#p=node%2F632876845')
    check(not other.locator('button.ok').is_disabled(), 'nach Einfügen des Links freigebbar')
    other.locator('button.ok').click()
    other.locator('.status', has_text='Freigegeben').wait_for()
    check(posted == [{'aktion': 'freigeben', 'id': 's3', 'standort': 'node/632876845'}], f'Standort wird mitgeschickt ({posted})')
    posted.clear()
    check('<b>Rampe</b>' in pg.inner_text('.card >> nth=0') and pg.locator('.card b').count() == 0, 'Beschreibung bleibt Text')
    check(pg.locator('.card >> nth=1').locator('button.ok').is_disabled() and 'nicht freigeben' in pg.inner_text('.card >> nth=1'), 'ohne Rechte nicht freigebbar')
    pg.locator('.card >> nth=0').locator('button.ok').click()
    pg.locator('.card >> nth=0').locator('.status', has_text='Freigegeben').wait_for()
    check(posted == [{'aktion': 'freigeben', 'id': 's1'}], f'Freigabe gesendet ({posted})')
    pg.once('dialog', lambda d: d.dismiss())
    pg.locator('.card >> nth=1').locator('button', has_text='Ablehnen').click()
    pg.wait_for_timeout(300)
    check(len(posted) == 1, 'Ablehnen erst nach Bestätigung')
    # Veröffentlichte Fotos entfernen
    pg.locator('.pub img[src^="blob:"] >> nth=1').wait_for()
    check(pg.locator('.pub').count() == 2 and 'Babybett' in pg.inner_text('#published'), 'veröffentlichte Fotos mit Bild und Beschreibung')
    n = len(posted)
    pg.once('dialog', lambda d: d.accept())
    pg.locator('.pub >> nth=0').locator('button', has_text='Entfernen').click()
    pg.locator('.pub >> nth=0').locator('.status', has_text='Entfernt').wait_for()
    check(posted[n:] == [{'aktion': 'entfernen', 'standort_id': 'node/5', 'url': 'photos/a.jpg'}], f'Entfernen gesendet ({posted[n:]})')
    pg.screenshot(path=str(SHOTS / 'fotos_freigabe.png'), full_page=True)
    check(not errors, f'keine JS-/CSP-Fehler {errors}')
    b.close()
srv.shutdown()
print('\nFEHLER: ' + ('; '.join(problems) if problems else 'keine'))
sys.exit(1 if problems else 0)
