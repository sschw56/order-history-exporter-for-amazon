# #43 – Stufe 1: Zahlungsdaten und digitale Bestellungen

## Basis

- Upstream/Fork-Basis: `41626ee657b4e516eb178cb9b8003c8a0b004586`
- Zielbranch: `feature/43-finance-import`

## Enthalten

- Amazon-CPE-Zahlungstransaktionen pro Order (`date`, `amount`, `currency`)
- positive Beträge = Belastung, negative Beträge = Erstattung
- gleiche Belastungen am gleichen Tag werden nicht global dedupliziert
- Digital-Order-IDs (`Dxx-...`) werden erkannt
- `orderFilter=digital` bleibt bei Jahres-/Seitennavigation erhalten
- digitale Artikel (u. a. Prime Video) werden als `orderType=digital` modelliert
- optionale `digitalId` und `contentType`
- CSV enthält Bestelltyp, Digital-Felder und Zahlungstransaktionen
- JSON enthält die neuen strukturierten Felder direkt

## Bewusste Abgrenzung

- Retail- und Digital-Historie werden in Stufe 1 noch getrennt gestartet/exportiert.
- Payment Method / Kartenanbieter / letzte vier Stellen folgen in einer späteren Stufe.
- Geschenkkarten-/Rewards-Logik ist vorbereitet, aber noch nicht implementiert.
- Die direkte Übertragung an Finance Import folgt erst nach dem Amazon.de-Smoke-Test.

## Manueller Smoke-Test

1. Normalen Bestellverlauf öffnen und einen kleinen Zeitraum als JSON exportieren.
2. Prüfen, ob normale Orders `orderType: "physical"` und `transactions` enthalten.
3. Amazon Digital Orders öffnen (`orderFilter=digital`) und denselben Export starten.
4. Einen bekannten Prime-Video-Kauf/-Leihvorgang prüfen:
   - digitale Order-ID
   - Titel
   - `orderType: "digital"`
   - ggf. `digitalId`/`contentType`
   - Zahlungstransaktion mit Datum/Betrag/Währung
5. Einen Fall mit mehreren Belastungen oder einer Erstattung prüfen, sofern vorhanden.
