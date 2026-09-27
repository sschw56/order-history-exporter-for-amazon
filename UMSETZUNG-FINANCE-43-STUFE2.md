# Finance #43 – Stufe 2: Zahlungsart und Karten-Endziffern

Diese Stufe erweitert die bereits vorhandenen Amazon-CPE-Zahlungstransaktionen um optionale Zahlungsmetadaten.

## JSON

Eine Transaktion kann zusätzlich enthalten:

- `paymentMethod`, z. B. `Visa`, `Mastercard`, `PayPal` oder `SEPA/Lastschrift`
- `cardLast4`, falls Amazon die letzten vier Kartenziffern anzeigt

Die Zuordnung erfolgt bevorzugt innerhalb des jeweiligen CPE-Transaktionsblocks. Falls dort keine Zahlungsmetadaten gefunden werden, wird die Bestelldetailseite als Fallback verwendet.

## CSV

Zusätzliche Spalten:

- `Transaction Payment Methods`
- `Transaction Card Last 4`

Mehrere Transaktionen bleiben positionsgleich über ` | ` getrennt.

## Digital Orders

Der bereits getestete Hotfix ist enthalten: digitale `Dxx-...`-Bestellungen werden auch dann als `digital` erkannt, wenn sie in der normalen Bestellhistorie erscheinen.
