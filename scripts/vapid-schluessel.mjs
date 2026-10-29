// Erzeugt ein VAPID-Schlüsselpaar für den Pegel-Alarm per Push. Auf DEINEM Rechner ausführen (Node.js ab 18):
//   node scripts/vapid-schluessel.mjs
// Die drei ausgegebenen Werte in Netlify eintragen: Site configuration → Environment variables (VAPID_PRIVATE_KEY als „Secret“).
// Den privaten Schlüssel niemandem schicken und nicht ins Repository legen. Neue Schlüssel machen bestehende Push-Abos ungültig.
import { createECDH } from 'node:crypto';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log('VAPID_PUBLIC_KEY=' + b64url(ecdh.getPublicKey()));      // 65 Byte, unkomprimiert
const priv = ecdh.getPrivateKey();
console.log('VAPID_PRIVATE_KEY=' + b64url(Buffer.concat([Buffer.alloc(32 - priv.length), priv])));   // immer 32 Byte
console.log('VAPID_SUBJECT=mailto:DEINE-ADRESSE@example.de   ← durch deine Kontaktadresse ersetzen');
