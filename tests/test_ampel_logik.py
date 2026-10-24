"""Startet die Node-Tests (Pegel-Ampel, E-Mail-Alarm, „In der Nähe“, Pegel-Trend, Flüsse), wenn Node vorhanden ist."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which("node"), "Node.js nicht installiert")
class PegelAmpelLogikTests(unittest.TestCase):
    def test_logik(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "ampel_logik_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    @unittest.skipUnless((ROOT / "node_modules" / "@netlify" / "blobs").exists(), "npm install fehlt")
    def test_alarm(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "pegel_alarm_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)


    def test_umgebung(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "umgebung_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_pegel_trend(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "pegel_trend_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_pegel_fluss(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "pegel_fluss_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_gezeiten_probe(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "gezeiten_probe_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_gezeiten(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "gezeiten_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_meldungen(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "meldungen_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)


if __name__ == "__main__":
    unittest.main()
