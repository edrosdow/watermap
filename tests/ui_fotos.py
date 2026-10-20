"""UI-Test der Foto-Verwaltung (public/admin/fotos.html) mit nachgebauter Funktion, unter der echten CSP.
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
REPORTS = [{'id': 'r1', 'created': '2026-10-20T15:00:00Z', 'standort_id': 'node/1937154973', 'standort_name': 'Tegel',
            'foto': 'photos/a.jpg', 'grund': 'Babybett, <i>kein</i> Slip', 'veroeffentlicht': True}]
PUBLISHED = [{'standort_id': 'node/1937154973', 'url': 'photos/a.jpg', 'alt': 'Babybett', 'credit': 'WaterMap-Community'},
             {'standort_id': 'node/632876845', 'url': 'photos/b.jpg', 'alt': '', 'credit': 'WaterMap-Community'}]
LOG = [{'zeit': '2026-10-20T16:00:00Z', 'aktion': 'entfernt', 'standort_id': 'node/5', 'foto': 'photos/z.jpg', 'beschreibung': 'Brot', 'grund': 'kein Slip'},
       {'zeit': '2026-10-20T15:30:00Z', 'aktion': 'freigegeben', 'standort_id': 'node/632876845', 'standort_name': 'Slip Vössen', 'foto': 'photos/b.jpg', 'beschreibung': '<img src=x>'},
       {'zeit': '2026-10-20T15:00:00Z', 'aktion': 'abgelehnt', 'standort_id': '__other', 'standort_name': 'Irgendwo', 'beschreibung': 'unscharf'}]
posted = []

def api(route):
    r = route.request
    if r.headers.get('x-passwort') != 'geheim':
        return route.fulfill(status=401, content_type='application/json', body='{"fehler":"Passwort falsch."}')
    j = lambda body: route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    if r.method == 'GET':
        if 'meldungen' in r.url: return j({'meldungen': REPORTS})
        if 'veroeffentlicht' in r.url: return j({'fotos': PUBLISHED})
        if 'verlauf' in r.url: return j({'verlauf': LOG})
        if 'bild=' in r.url or 'datei=' in r.url: return route.fulfill(status=200, content_type='image/png', body=PNG)
        return j({'fotos': FOTOS})
    posted.append(json.loads(r.post_data))
    j({'ok': True})

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
    check(pg.locator('#tabs').is_hidden() and pg.locator('.card').count() == 0, 'falsches Passwort: nichts sichtbar')
    pg.fill('#pw', 'geheim'); pg.click('#login button')
    pg.locator('#tab-neu .card img[src^="blob:"] >> nth=2').wait_for()
    check(pg.locator('#login').is_hidden() and pg.inner_text('#n-neu') == '3' and pg.inner_text('#n-gemeldet') == '1' and pg.inner_text('#n-veroeffentlicht') == '2',
          'Reiter mit Anzahlen (3 eingereicht, 1 gemeldet, 2 veröffentlicht)')
    check('hot' in pg.get_attribute('#n-gemeldet', 'class'), 'Meldungen sind hervorgehoben')

    # Eingereicht
    cards = pg.locator('#tab-neu .card')
    check('<b>Rampe</b>' in cards.nth(0).inner_text() and pg.locator('#tab-neu .card b').count() == 0, 'Beschreibung bleibt Text')
    check(cards.nth(1).locator('button.ok').is_disabled() and 'nicht freigeben' in cards.nth(1).inner_text(), 'ohne Rechte nicht freigebbar')
    other = cards.nth(2)
    check(other.locator('button.ok').is_disabled() and 'Porta In Vössen' in other.inner_text(), 'ohne Standort: Freigeben gesperrt, Hinweis da')
    other.locator('input.where').fill('https://watermaps.netlify.app/#p=node%2F632876845')
    check(not other.locator('button.ok').is_disabled(), 'nach Einfügen des Links freigebbar')
    other.locator('button.ok').click(); pg.locator('#msg', has_text='Freigegeben').wait_for()
    check(posted == [{'aktion': 'freigeben', 'id': 's3', 'standort': 'node/632876845'}], f'Standort wird mitgeschickt ({posted})')
    posted.clear()
    pg.locator('#tab-neu .card >> nth=0').locator('button.ok').click(); pg.wait_for_timeout(300)
    check(posted == [{'aktion': 'freigeben', 'id': 's1'}], f'Freigabe gesendet ({posted})')
    posted.clear()
    pg.once('dialog', lambda d: d.dismiss())
    pg.locator('#tab-neu .card >> nth=1').locator('button', has_text='Ablehnen').click(); pg.wait_for_timeout(300)
    check(posted == [], 'Ablehnen erst nach Bestätigung')
    pg.once('dialog', lambda d: d.accept())
    pg.locator('#tab-neu .card >> nth=1').locator('button', has_text='Ablehnen').click(); pg.locator('#msg', has_text='Abgelehnt').wait_for()
    check(posted == [{'aktion': 'ablehnen', 'id': 's2'}], f'Ablehnen gesendet ({posted})')
    posted.clear()
    pg.screenshot(path=str(SHOTS / 'fotos_eingereicht.png'), full_page=True)

    # Gemeldet
    pg.click('#tabs [data-tab=gemeldet]')
    rep = pg.locator('#tab-gemeldet .card'); rep.locator('img[src^="blob:"]').wait_for()
    check(pg.locator('#tab-neu').is_hidden() and 'Babybett, <i>kein</i> Slip' in rep.inner_text() and rep.locator('i').count() == 0, 'Meldung mit Grund (als Text)')
    pg.once('dialog', lambda d: d.accept())
    rep.locator('button', has_text='Foto entfernen').click(); pg.locator('#msg', has_text='Foto entfernt').wait_for()
    check(posted == [{'aktion': 'entfernen', 'standort_id': 'node/1937154973', 'url': 'photos/a.jpg', 'meldung': 'r1'}], f'Foto entfernen aus der Meldung ({posted})')
    posted.clear()
    pg.locator('#tab-gemeldet button', has_text='Meldung verwerfen').click(); pg.locator('#msg', has_text='Meldung verworfen').wait_for()
    check(posted == [{'aktion': 'meldung_verwerfen', 'id': 'r1'}], f'Meldung verwerfen ({posted})')
    posted.clear()
    pg.screenshot(path=str(SHOTS / 'fotos_gemeldet.png'), full_page=True)

    # Veröffentlicht
    pg.click('#tabs [data-tab=veroeffentlicht]')
    pg.locator('#tab-veroeffentlicht .card img[src^="blob:"] >> nth=1').wait_for()
    check(pg.locator('#tab-veroeffentlicht .card').count() == 2 and 'Babybett' in pg.inner_text('#published'), 'veröffentlichte Fotos mit Bild und Beschreibung')
    pg.once('dialog', lambda d: d.accept())
    pg.locator('#tab-veroeffentlicht .card >> nth=0').locator('button', has_text='Entfernen').click(); pg.locator('#msg', has_text='Foto entfernt').wait_for()
    check(posted == [{'aktion': 'entfernen', 'standort_id': 'node/1937154973', 'url': 'photos/a.jpg'}], f'Entfernen gesendet ({posted})')

    # Verlauf
    pg.click('#tabs [data-tab=verlauf]')
    log = pg.inner_text('#log')
    check(pg.locator('#log li').count() == 3 and log.index('Entfernt') < log.index('Freigegeben') < log.index('Abgelehnt'), 'Verlauf: alle Aktionen, neueste zuerst')
    check('Grund: kein Slip' in log and '„Brot“' in log and 'Slip Vössen' in log and 'Irgendwo' in log, 'Verlauf mit Standort, Beschreibung und Grund')
    check('<img src=x>' in log and pg.locator('#log img').count() == 0, 'Verlauf: Text bleibt Text')
    pg.screenshot(path=str(SHOTS / 'fotos_verlauf.png'), full_page=True)
    check(not errors, f'keine JS-/CSP-Fehler {errors}')
    b.close()
srv.shutdown()
print('\nFEHLER: ' + ('; '.join(problems) if problems else 'keine'))
sys.exit(1 if problems else 0)
