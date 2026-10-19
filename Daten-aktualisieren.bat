@echo off
chcp 65001 >nul
echo WaterMap: OSM-Daten fuer Deutschland aktualisieren (dauert 30-90 Minuten)
echo.
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% scripts\import_osm.py
if errorlevel 1 goto fehler
%PY% scripts\validate_data.py
if errorlevel 1 goto fehler
echo.
echo Fertig. Jetzt den Ordner "public" bei Netlify neu hochladen.
pause
exit /b 0
:fehler
echo.
echo Es ist ein Fehler aufgetreten (siehe oben). Die bisherigen Daten wurden nicht veraendert.
pause
exit /b 1
