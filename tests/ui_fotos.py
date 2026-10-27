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
          'beschreibung': '<b>Rampe</b> bei Niedrigwasser', 'rechte': True, 'hat_foto': True, 'kategorie': 'rampe'},
         {'id': 's2', 'created': '2026-10-20T13:00:00Z', 'standort_id': 'node/1', 'standort_name': 'Ohne Rechte',
          'beschreibung': 'x', 'rechte': False, 'hat_foto': True},
         {'id': 's3', 'created': '2026-10-20T14:00:00Z', 'standort_id': '__other', 'standort_name': 'Porta In Vössen',
          'beschreibung': 'Slipanlage', 'rechte': True, 'hat_foto': True, 'kategorie': None, 'motiv': 'Rampe, Steg'}]
REPORTS = [{'id': 'r1', 'created': '2026-10-20T15:00:00Z', 'standort_id': 'node/1937154973', 'standort_name': 'Tegel',
            'foto': 'photos/a.jpg', 'grund': 'Babybett, <i>kein</i> Slip', 'veroeffentlicht': True}]
PUBLISHED = [{'standort_id': 'node/1937154973', 'url': 'photos/a.jpg', 'alt': 'Babybett', 'credit': 'WaterMap-Community'},
             {'standort_id': 'node/632876845', 'url': 'photos/b.jpg', 'alt': '', 'credit': 'WaterMap-Community'}]
LOG = [{'zeit': '2026-10-20T16:00:00Z', 'aktion': 'entfernt', 'standort_id': 'node/5', 'foto': 'photos/z.jpg', 'beschreibung': 'Brot', 'grund': 'kein Slip'},
       {'zeit': '2026-10-20T15:30:00Z', 'aktion': 'freigegeben', 'standort_id': 'node/632876845', 'standort_name': 'Slip Vössen', 'foto': 'photos/b.jpg', 'beschreibung': '<img src=x>'},
       {'zeit': '2026-10-20T15:00:00Z', 'aktion': 'abgelehnt', 'standort_id': '__other', 'standort_name': 'Irgendwo', 'beschreibung': 'unscharf'}]
SLIP0 = json.loads((ROOT / 'data/osm/slip.geojson').read_text(encoding='utf-8'))['features'][0]
SLIPS = [{'id': 'n1', 'created': '2026-10-20T09:00:00Z', 'name': 'Doppelt', 'gewaesser': 'See', 'lat': SLIP0['geometry']['coordinates'][1], 'lon': SLIP0['geometry']['coordinates'][0],
          'zugang': 'oeffentlich', 'gebuehr': 'kostenlos', 'gebuehr_betrag': '', 'parkplatz': 'ja', 'trailerparkplatz': '', 'beschreibung': '<b>Beton</b>', 'kontakt': 'a@b.de',
          'hat_foto': True, 'rechte': False, 'dublette': True},
         {'id': 'n2', 'created': '2026-10-20T09:30:00Z', 'name': 'Neu am Meer', 'gewaesser': 'Nordsee', 'lat': 54.9, 'lon': 2.0, 'zugang': '', 'gebuehr': '',
          'gebuehr_betrag': '', 'parkplatz': '', 'trailerparkplatz': '', 'beschreibung': '', 'kontakt': '', 'hat_foto': False, 'rechte': False, 'dublette': False}]
PREISE = [{'id': 'p1', 'created': '2026-10-20T10:00:00Z', 'tankstelle_id': 'node/7000', 'tankstelle_name': 'Tanke', 'kraftstoff': 'diesel', 'preis': 2.189, 'datum': '2026-10-19', 'kommentar': 'Schild', 'hat_beleg': True},
          {'id': 'p2', 'created': '2026-10-20T10:30:00Z', 'tankstelle_id': '__other', 'tankstelle_name': 'Irgendwo', 'kraftstoff': 'benzin', 'preis': 2.0, 'datum': '2026-10-19', 'kommentar': '', 'hat_beleg': False}]
HINWEISE = [{'id': 'h1', 'created': '2026-10-20T11:00:00Z', 'standort_id': 'node/5', 'standort_name': 'Hafen', 'art': 'oeffnungszeiten', 'art_text': 'Falsche Öffnungszeiten',
             'details': 'Montags <u>zu</u>', 'kontakt': 'x@y.de'},
            {'id': 'u1', 'created': '2026-10-20T12:00:00Z', 'standort_id': 'node/9', 'standort_name': 'Slip Nord', 'art': 'meldung', 'art_text': 'Unpassende Lagemeldung',
             'details': 'Lagemeldung unpassend\nMeldung-ID: 00ab12cd34ef5678\nGrund: Beleidigend', 'kontakt': '', 'meldung_id': '00ab12cd34ef5678'}]
LOG.append({'zeit': '2026-10-20T14:00:00Z', 'bereich': 'slip', 'aktion': 'freigegeben', 'standort_id': 'c/neu-20261020-abc', 'standort_name': 'Neue Rampe', 'beschreibung': 'Weser'})
# Ergänzung zu einer echten Slipanlage (bisher-Werte kommen aus public/data)
_SLIP = next(f for f in json.loads((ROOT / 'data/osm/slip.geojson').read_text(encoding='utf-8'))['features'] if f['properties'].get('access') == 'public')
ERG = [{'id': 'e1', 'created': '2026-10-26T10:00:00Z', 'standort_id': _SLIP['id'], 'standort_name': 'Slip Süd', 'angaben': [['Zugang', 'Öffentlich'], ['Bootsgröße', 'bis 7 m']],
        'bemerkung': 'Schlüssel beim <b>Hafenmeister</b>', 'leer': False}]
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
        if 'form=slipanlage-melden' in r.url: return j({'slips': SLIPS})
        if 'form=tankpreis-melden' in r.url: return j({'preise': PREISE})
        if 'form=fehler-melden' in r.url: return j({'hinweise': HINWEISE})
        if 'form=slip-ergaenzen' in r.url: return j({'ergaenzungen': ERG})
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
    check(pg.inner_text('#n-slips') == '2' and pg.inner_text('#n-preise') == '2' and pg.inner_text('#n-hinweise') == '2', 'Reiter Slipanlagen, Preise, Hinweise mit Anzahlen')

    # Eingereicht
    cards = pg.locator('#tab-neu .card')
    check('<b>Rampe</b>' in cards.nth(0).inner_text() and pg.locator('#tab-neu .card b').count() == 0, 'Beschreibung bleibt Text')
    check(cards.nth(1).locator('button.ok').is_disabled() and 'nicht freigeben' in cards.nth(1).inner_text(), 'ohne Rechte nicht freigebbar')
    other = cards.nth(2)
    check(other.locator('button.ok').is_disabled() and 'Porta In Vössen' in other.inner_text(), 'ohne Standort: Freigeben gesperrt, Hinweis da')
    other.locator('input.where').fill('https://watermaps.netlify.app/#p=node%2F632876845')
    check(other.locator('button.ok').is_disabled() and 'Motiv (alte Angabe): Rampe, Steg' in other.inner_text(), 'ohne Kategorie noch gesperrt, alte Motiv-Angabe sichtbar')
    other.locator('select.kat').select_option('steg')
    check(not other.locator('button.ok').is_disabled(), 'mit Link und Kategorie freigebbar')
    other.locator('button.ok').click(); pg.locator('#msg', has_text='Freigegeben').wait_for()
    check(posted == [{'aktion': 'freigeben', 'id': 's3', 'kategorie': 'steg', 'standort': 'node/632876845'}], f'Standort und Kategorie werden mitgeschickt ({posted})')
    posted.clear()
    pg.locator('#tab-neu .card >> nth=0').locator('button.ok').click(); pg.wait_for_timeout(300)
    check(pg.locator('#tab-neu .card >> nth=0').locator('select.kat').input_value() == 'rampe', 'Kategorie der Einreichung vorausgewählt')
    check(posted == [{'aktion': 'freigeben', 'id': 's1', 'kategorie': 'rampe'}], f'Freigabe mit Kategorie gesendet ({posted})')
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
    pub2 = pg.locator('#tab-veroeffentlicht .card >> nth=1')
    check(pub2.locator('select.kat').input_value() == '' and pub2.locator('button', has_text='Kategorie speichern').is_disabled(), 'älteres Foto ohne Kategorie, Speichern gesperrt')
    pub2.locator('select.kat').select_option('rampe'); pub2.locator('button', has_text='Kategorie speichern').click(); pg.locator('#msg', has_text='Kategorie „Rampe“ gespeichert').wait_for()
    check(posted == [{'aktion': 'kategorie', 'standort_id': 'node/632876845', 'url': 'photos/b.jpg', 'kategorie': 'rampe'}], f'Kategorie nachträglich gesetzt ({posted})')
    posted.clear()
    pg.once('dialog', lambda d: d.accept())
    pg.locator('#tab-veroeffentlicht .card >> nth=0').locator('button', has_text='Entfernen').click(); pg.locator('#msg', has_text='Foto entfernt').wait_for()
    check(posted == [{'aktion': 'entfernen', 'standort_id': 'node/1937154973', 'url': 'photos/a.jpg'}], f'Entfernen gesendet ({posted})')

    posted.clear()
    # Slipanlagen
    pg.click('#tabs [data-tab=slips]')
    sl = pg.locator('#tab-slips .card')
    sl.nth(0).locator('.near', has_text='Achtung').wait_for(timeout=15000); sl.nth(1).locator('.near.ok').wait_for()
    t0 = sl.nth(0).inner_text()
    check('<b>Beton</b>' in t0 and sl.nth(0).locator('b').count() == 0 and 'Öffentlich' in t0 and 'a@b.de' in t0, 'Slip-Meldung mit Angaben (Text bleibt Text)')
    check('bestätigt, dass in der Nähe' in t0 and 'Foto wird nicht übernommen' in t0, 'Hinweise: Dublette bestätigt, Foto ohne Rechte')
    check('Achtung: bekannte Slipanlage 0 m' in t0 and 'Keine bekannte Slipanlage im Umkreis' in sl.nth(1).inner_text(), 'Dublettenprüfung gegen bekannte Slipanlagen')
    check(sl.nth(0).locator('a[href*="openstreetmap.org/?mlat="]').count() == 1, 'Lage mit Kartenlink')
    sl.nth(1).locator('button.ok').click(); pg.locator('#msg', has_text='Slipanlage freigegeben').wait_for()
    check(posted == [{'form': 'slipanlage-melden', 'aktion': 'freigeben', 'id': 'n2'}], f'Slipanlage freigeben ({posted})')
    posted.clear()
    pg.once('dialog', lambda d: d.accept())
    pg.locator('#tab-slips .card >> nth=0').locator('button', has_text='Ablehnen').click(); pg.locator('#msg', has_text='Slipanlage abgelehnt').wait_for()
    check(posted == [{'form': 'slipanlage-melden', 'aktion': 'ablehnen', 'id': 'n1'}], f'Slipanlage ablehnen ({posted})')
    posted.clear()
    pg.screenshot(path=str(SHOTS / 'verwaltung_slips.png'), full_page=True)
    # Preise
    pg.click('#tabs [data-tab=preise]')
    pr = pg.locator('#tab-preise .card')
    check('2,189 €/l' in pr.nth(0).inner_text() and not pr.nth(0).locator('button.ok').is_disabled(), 'Preis mit Betrag, freigebbar')
    check(pr.nth(1).locator('button.ok').is_disabled() and 'nicht in der Liste' in pr.nth(1).inner_text(), 'unbekannte Tankstelle nicht freigebbar')
    pr.nth(0).locator('button.ok').click(); pg.locator('#msg', has_text='Preis freigegeben').wait_for()
    check(posted == [{'form': 'tankpreis-melden', 'aktion': 'freigeben', 'id': 'p1'}], f'Preis freigeben ({posted})')
    posted.clear()
    # Hinweise
    pg.click('#tabs [data-tab=hinweise]')
    hi = pg.locator('#tab-hinweise .card', has_text='Hafen')
    check(hi.locator('button.danger').count() == 0, 'normaler Hinweis ohne „Meldung entfernen“')
    lm = pg.locator('#tab-hinweise .card', has_text='Slip Nord')
    check('Unpassende Lagemeldung' in lm.inner_text() and lm.locator('button.danger', has_text='Meldung entfernen').count() == 1, 'Lagemeldung-Hinweis mit „Meldung entfernen“')
    pg.once('dialog', lambda d: d.accept())
    lm.locator('button.danger').click(); pg.locator('#msg', has_text='Lagemeldung entfernt').wait_for()
    check(posted == [{'form': 'fehler-melden', 'aktion': 'lagemeldung_entfernen', 'id': 'u1'}], f'Lagemeldung entfernen ({posted})')
    posted.clear()
    check('Montags <u>zu</u>' in hi.inner_text() and hi.locator('u').count() == 0 and 'Falsche Öffnungszeiten' in hi.inner_text()
          and hi.locator('a[href="mailto:x@y.de"]').count() == 1, 'Hinweis mit Art, Text und Rückfrage-Adresse')
    hi.locator('button', has_text='Erledigt').click(); pg.locator('#msg', has_text='erledigt').wait_for()
    check(posted == [{'form': 'fehler-melden', 'aktion': 'erledigt', 'id': 'h1'}], f'Hinweis erledigt ({posted})')
    # Ergänzungen: bisher → neu, Übernehmen
    pg.click('#tabs [data-tab=ergaenzungen]')
    er = pg.locator('#tab-ergaenzungen .card')
    for _ in range(40):
        if '…' not in er.inner_text(): break
        pg.wait_for_timeout(150)
    et = er.inner_text()
    check(pg.inner_text('#n-ergaenzungen') == '1' and 'Slip Süd' in et and 'bis 7 m' in et and 'Schlüssel beim <b>Hafenmeister</b>' in et and er.locator('b').count() == 0,
          'Ergänzung mit Angaben und Bemerkung (als Text)')
    zug = er.locator('tbody tr', has_text='Zugang')
    check(zug.locator('.alt').inner_text() == 'Öffentlich' and 'gleich' in (zug.locator('.neu').get_attribute('class') or '')
          and er.locator('tbody tr', has_text='Bootsgröße').locator('.alt').inner_text() == 'Unbekannt', f'bisher → neu aus den veröffentlichten Daten ({et!r})')
    er.locator('button.ok', has_text='Übernehmen').click(); pg.locator('#msg', has_text='übernommen').wait_for()
    check(posted[-1:] == [{'form': 'slip-ergaenzen', 'aktion': 'uebernehmen', 'id': 'e1'}], f'Übernehmen ({posted})')
    posted.clear()
    # Verlauf
    pg.click('#tabs [data-tab=verlauf]')
    log = pg.inner_text('#log')
    check(pg.locator('#log li').count() == 4 and log.index('Entfernt') < log.index('Freigegeben') < log.index('Abgelehnt'), 'Verlauf: alle Aktionen in Reihenfolge')
    check('Slipanlage' in log and 'Neue Rampe' in log and log.count('Foto') >= 3, 'Verlauf zeigt den Bereich (Foto, Slipanlage …)')
    check('Grund: kein Slip' in log and '„Brot“' in log and 'Slip Vössen' in log and 'Irgendwo' in log, 'Verlauf mit Standort, Beschreibung und Grund')
    check('<img src=x>' in log and pg.locator('#log img').count() == 0, 'Verlauf: Text bleibt Text')
    pg.screenshot(path=str(SHOTS / 'fotos_verlauf.png'), full_page=True)
    check(not errors, f'keine JS-/CSP-Fehler {errors}')
    b.close()
srv.shutdown()
print('\nFEHLER: ' + ('; '.join(problems) if problems else 'keine'))
sys.exit(1 if problems else 0)
