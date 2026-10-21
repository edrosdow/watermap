"""Startet die Node-Tests der Pegel-Ampel-Logik (public/js/ampel-logik.js), wenn Node vorhanden ist."""
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


if __name__ == "__main__":
    unittest.main()
