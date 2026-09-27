# Finance #43 – Digital-Order-Hotfix

Digitale Amazon-Bestellungen können auf der regulären Bestellhistorie erscheinen. Daher reicht die bisherige Erkennung anhand von `orderFilter=digital` auf der aktuellen Seite nicht aus.

Der Hotfix erkennt digitale Bestellungen zusätzlich pro Order anhand von:

- Amazon-Digital-Order-ID (`Dxx-...`, z. B. `D01-...`)
- `digi_order_details` in der Detail-URL

Dadurch wird für diese Orders der Digital-Item-Parser verwendet, auch wenn der Abruf von der normalen Bestellhistorie gestartet wurde. Der bestehende CSV-Test wurde außerdem auf die bereits lokal getestete headerbasierte Spaltenermittlung umgestellt.
