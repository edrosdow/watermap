"""Startet die Node-Tests der Foto-Freigabe (netlify/functions/fotos.mjs), wenn Node vorhanden ist."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which("node"), "Node.js nicht installiert")
class FotoFreigabeTests(unittest.TestCase):
    def test_function(self):
        res = subprocess.run(["node", str(ROOT / "tests" / "fotos_function_test.mjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)


if __name__ == "__main__":
    unittest.main()
