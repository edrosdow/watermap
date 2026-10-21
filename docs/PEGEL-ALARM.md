# Pegel-Alarm per E-Mail einrichten

Die Pegel-Ampel (`/pegel-ampel`) kann Nutzer per E-Mail benachrichtigen, wenn sich ihre Ampel ändert (grün ↔ gelb ↔ rot).
Kostenlos: Netlify Functions und Netlify Blobs (Speicher) sind im Gratis-Tarif enthalten, Mails gehen über **Brevo** (kostenlos bis 300 Mails/Tag; die App verschickt höchstens 250).

## Ablauf
1. Nutzer gibt Pegel, Mindestpegel und E-Mail ein → Bestätigungs-Mail (Double-Opt-in).
2. Klick auf den Link → `/pegel-ampel?…&alarm-bestaetigen=…` → die Seite bestätigt den Alarm.
3. Jede Stunde prüft `netlify/functions/pegel-alarm-pruefen.mjs` alle bestätigten Alarme mit derselben Logik wie die Seite (`public/js/ampel-logik.js`).
4. Ändert sich die Ampel, kommt eine Mail – höchstens alle 6 Stunden je Alarm. Jede Mail hat einen Abmelde-Link.

Grenzen: höchstens 5 Alarme und 3 Anmeldungen pro Tag je E-Mail-Adresse; unbestätigte Anmeldungen werden nach 48 Stunden gelöscht.
Die stündliche Prüfung läuft **nur auf der veröffentlichten Seite**, nicht in Deploy-Vorschauen. Anmelden und Bestätigen funktionieren auch in der Vorschau.

## Einmalig einrichten
1. Kostenloses Konto bei [brevo.com](https://www.brevo.com) anlegen.
2. Brevo → *Senders, Domains & Dedicated IPs* → *Senders* → *Add a sender*: deine E-Mail-Adresse eintragen und über den Code in der Mail bestätigen.
3. Brevo → *SMTP & API* → *API Keys* → *Generate a new API key* → Schlüssel kopieren (**nicht** in einen Chat einfügen).
4. Netlify → *Site configuration* → *Environment variables* → *Add a variable* (jeweils „Contains secret values“ anhaken):
   | Variable | Wert |
   |---|---|
   | `BREVO_API_KEY` | der Schlüssel aus Schritt 3 |
   | `ALARM_ABSENDER` | die Absender-Adresse aus Schritt 2 |
   | `ALARM_ABSENDER_NAME` (optional) | z. B. `WaterMap Pegel-Alarm` |
5. Netlify → *Deploys* → *Trigger deploy* → *Deploy site*.
6. Brevo → *Settings* → *Security* bzw. *Legal* → Vertrag zur Auftragsverarbeitung (DPA) annehmen.

Hinweis: Ohne eigene Domain verschickt Brevo mit deiner privaten Adresse als Absender. Das funktioniert, die Mails landen aber eher im Spam-Ordner. Mit einer eigenen Domain (später) wird die Zustellung besser.

## Prüfen
- Netlify → *Logs* → *Functions* → `pegel-alarm-pruefen`: stündlich eine Zeile „Pegel-Alarm: N aktive Alarme, M Mails“.
- Gespeicherte Alarme: Netlify → *Blobs* → Store `pegel-alarm` (Schlüssel `alarm/…`, `mail/…`, `zaehler/…`).
