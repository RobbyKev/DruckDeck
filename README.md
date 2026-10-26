[README.md](https://github.com/user-attachments/files/33974458/README.md)
# DruckDeck

Magic-the-Gathering-Commander-Decks als **deutsche Proxys** auf A4 drucken. Reine statische Web-App (Vite, Vanilla JS), läuft komplett im Browser – ohne Anmeldung, Backend oder Tracking. Nur für den privaten Gebrauch.

## Funktionen

- **Precon auswählen**: alle Commander-Precons von MTGJSON, Suche nach Deckname, Set-Code oder Set-Name.
- **Deckliste einfügen**: Moxfield/Archidekt-Format (`1 Sol Ring (C21) 263`, `1x Sol Ring`, `Sol Ring`). Abschnitt „Commander“ markiert den Kommandanten.
- **Deutsche Kartenbilder von Scryfall** mit Prüfung, ob das Bild wirklich deutsch ist (siehe unten), Ersatzdrucke und Markierung „nur Englisch verfügbar“.
- **Vorschau** mit Badges, Zusammenfassung, editierbaren Namen und Austausch-Dialog (Klick auf eine Karte).
- **PDF**: A4 hochkant, 3×3 Karten à 63 × 88 mm, Schnittmarken, Checkliste auf Seite 1, Standardländer auf eigenen Seiten am Ende, Rückseiten doppelseitiger Karten direkt hinter der Vorderseite.
- **Cache** in IndexedDB (API-Antworten 7 Tage, Bilder dauerhaft) – ein zweiter Durchlauf ist sofort fertig. „Cache leeren“ im Fußbereich.

## Erkennung „wirklich deutsch“

Scryfall markiert manche Karten als `lang: "de"`, liefert aber das englische Bild. Pro Karte:

1. `/cards/<set>/<nr>/de` holen; `image_status` muss `highres_scan` oder `lowres` sein.
2. Bild (Größe `small`) mit dem englischen Bild desselben Drucks vergleichen: 146×204 px, Graustufen, nur Textkasten (y 110–195). Mittlere absolute Differenz > 4 → deutsch.
3. Sonst andere deutsche Drucke per `oracleid:… lang:de game:paper` (neueste zuerst) prüfen.
4. Sonst englisches Bild, deutlich markiert.

Messwerte aus den Tests: englische Bilder unter `lang:de` liefern exakt 0,0; echte deutsche Karten 11–45; Standardländer (ohne Regeltext) 4,6–9,5.

Bekannte Scryfall-Lücken bei Namen (Raum-, Abenteuer-, Prepare-Karten): fehlt der deutsche Name ganz oder teilweise, wird die Karte markiert und das Namensfeld kann bearbeitet werden.

## Entwicklung

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # Ausgabe in dist/
```

Im Dev-Modus gibt es `window.__dd` und den Endpunkt `/__dev/save` (nur Dev-Server), damit automatische Tests PDFs nach `test-output/` speichern können. Beides ist im Produktions-Build nicht enthalten.

## Hosting auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf `main` und veröffentlicht sie unter `https://<name>.github.io/druckdeck/`.

1. Repo öffentlich stellen (für GitHub Pages mit kostenlosem Konto nötig).
2. Settings → Pages → Source: **GitHub Actions**.

Wegen `base: './'` in `vite.config.js` läuft der Build auch auf jedem anderen statischen Hoster (z. B. Cloudflare Pages: Build-Befehl `npm run build`, Ausgabe `dist`).

## Datenquellen

- [MTGJSON](https://mtgjson.com) – `DeckList.json` und `decks/<fileName>.json` (CORS erlaubt, daher keine GitHub Action nötig).
- [Scryfall API](https://scryfall.com/docs/api) – max. 8 Anfragen/Sekunde.

Inoffiziell, nicht mit Wizards of the Coast verbunden. Nur für private Runden, nicht zum Verkauf.

## Vorbereitet für später

- **Meine Decks**: Object Store `decks` in IndexedDB sowie `saveDeck()`/`listDecks()` in `src/lib/cache.js`.
- **Token-Seite**: MTGJSON liefert pro Deck `tokens`; die Auflösung kann `resolveEntry()` wiederverwenden.
- **Life & Lore**: noch offen.
