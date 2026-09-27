# Finance #43 – Stufe 3: direkte Übergabe an Finance Import

## Umfang

- eigener Firefox-Extension-Identifier `finance-amazon-exporter@swrz-home.de`
- Finance-Import-Einstellungen im Popup:
  - URL
  - API-Token
  - optionaler Gerätename
- lokaler Extension-Storage pro Firefox-Profil
- eigener Button `An Finance Import senden`
- gleicher Amazon-Scraping-Workflow wie beim Datei-Export
- Versand des vollständigen Order-JSON an `/api/amazon/orders`
- authentifizierter Verbindungstest über `/api/health`
- Speicherung des letzten Sendeergebnisses im Extension-Storage
- idempotenter Server-Import über den normalisierten Payload-Hash

## Mehrere Macs

Die spätere signierte XPI kann unverändert auf mehreren Macs installiert werden. URL, API-Token und Gerätename werden je Firefox-Profil separat gespeichert. Die Installations-ID wird automatisch pro Profil erzeugt. Mehrere Installationen dürfen denselben serverseitigen Bearer-Token verwenden.

## Sicherheit

Der API-Token wird nur im lokalen Extension-Storage und serverseitig in `/etc/finance-import.env` gehalten. Er wird weder in den Exportdateien noch im Repository gespeichert. Die produktive URL muss HTTPS verwenden. Der Manifest-Zugriff ist auf `https://finance.swrz-home.de/*` begrenzt.
