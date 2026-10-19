import csv, io, json, pathlib, subprocess, sys, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parent.parent

class SubmissionTests(unittest.TestCase):
    def run_script(self, form, rows):
        with tempfile.TemporaryDirectory() as t:
            f = pathlib.Path(t) / 'x.csv'
            buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=sorted({k for r in rows for k in r})); w.writeheader(); w.writerows(rows)
            f.write_text('﻿' + buf.getvalue(), encoding='utf-8')
            return subprocess.run([sys.executable, '-I', str(ROOT / 'scripts' / 'submissions_to_json.py'), form, str(f)], capture_output=True, text=True)

    def test_slip_mapping_and_privacy(self):
        r = self.run_script('slipanlage-melden', [
            {'name': 'TEST Rampe Süd', 'gewaesser': 'TEST-See', 'lat': '51,5', 'lon': '7.5', 'zugang': 'oeffentlich', 'gebuehr': 'kostenpflichtig', 'gebuehr_betrag': '5 €',
             'parkplatz': 'ja', 'trailerparkplatz': '', 'kontakt': 'geheim@example.org', 'created_at': '2026-10-01T10:00:00Z', 'ip': '1.2.3.4'},
            {'name': 'kaputt', 'lat': 'abc', 'lon': '7'}])
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertEqual(len(d), 1)
        e = d[0]
        self.assertEqual((e['status'], e['access'], e['fee'], e['fee_note']), ('pending', 'public', True, '5 €'))
        self.assertIs(e['attrs']['parking'], True); self.assertIsNone(e['attrs']['trailer_parking'])   # leer = unbekannt
        self.assertEqual((e['lat'], e['lon']), (51.5, 7.5))
        self.assertNotIn('geheim', r.stdout); self.assertNotIn('1.2.3.4', r.stdout)
        self.assertIn('ÜBERSPRUNGEN', r.stderr)

    def test_price_mapping(self):
        r = self.run_script('tankpreis-melden', [
            {'tankstelle_id': 'node/7', 'kraftstoff': 'benzin', 'preis': '2,149', 'datum': '2026-10-02'},
            {'tankstelle_id': '__other', 'tankstelle_name': 'Irgendwo', 'kraftstoff': 'diesel', 'preis': '2', 'datum': '2026-10-02'}])
        d = json.loads(r.stdout)
        self.assertEqual(d, [{'station_id': 'node/7', 'fuel': 'petrol', 'price': 2.149, 'observed': '2026-10-02', 'status': 'pending', 'submitted': d[0]['submitted']}])
        self.assertIn('nicht in der Liste', r.stderr)

if __name__ == '__main__':
    unittest.main()
