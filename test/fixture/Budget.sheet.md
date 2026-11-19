# Budget 2027

Quarterly plan for the Folio launch.

## Costs

| Item | Owner | Status | Q1 | Q2 | Q3 | Q4 | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Design | Gabriele | Done | 1200 | 800 | 400 | 400 | =SUM(D2:G2) |
| Engineering | Federico | Doing | 5400 | 5400 | 4000 | 3000 | =SUM(D3:G3) |
| Marketing | Gabriele | Todo | 0 | 1500 | 2500 | 3000 | =SUM(D4:G4) |
| Hosting | Federico | Doing | 90 | 90 | 120 | 150 | =SUM(D5:G5) |
| Total |  |  | =SUM(D2:D5) | =SUM(E2:E5) | =SUM(F2:F5) | =SUM(G2:G5) | =SUM(H2:H5) |
| Share of total |  |  | =D6/$H$6 | =E6/$H$6 | =F6/$H$6 | =G6/$H$6 | =IF(H6>20000,"Over budget","On budget") |

<!-- sheet: {"cols":{"A":{"width":150},"D":{"format":"currency"},"E":{"format":"currency"},"F":{"format":"currency"},"G":{"format":"currency"},"H":{"format":"currency","bold":true}},"cells":{"A6":{"bold":true},"D7":{"format":"percent"},"E7":{"format":"percent"},"F7":{"format":"percent"},"G7":{"format":"percent"}},"charts":[{"type":"column","title":"Costs by quarter","range":"A1:G5","stacked":true}]} -->

## Rates

| Role | Day rate | Lookup |
| --- | --- | --- |
| Design | 450 | =VLOOKUP("Engineering",A2:B4,2,FALSE) |
| Engineering | 600 |  |
| Marketing | 380 |  |
