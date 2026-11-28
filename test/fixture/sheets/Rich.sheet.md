# Sales tracker

Monthly orders by region. Edit in Folio or any Markdown editor.

## Orders

| Date       | Region | Product  | Qty | Price | Total      |
| ---------- | :----: | -------- | --: | ----: | ---------: |
| 2026-01-05 | EU     | Notebook | 4   | 3.5   | =D2*E2     |
| 2026-01-09 | US     | Pen      | 12  | 1.2   | =D3*E3     |
| 2026-02-02 | EU     | Folder   | 6   | 2.1   | =D4*E4     |
| Total      |        |          |     |       | =SUM(F2:F4) |

<!-- sheet: {"cols":{"E":{"format":"currency"},"F":{"format":"currency","bold":true,"width":140}},"cells":{"A1":{"fill":"#f2f2f2","bold":true},"A5":{"bold":true,"border":{"top":"thin #1f1f1f"}}},"merges":["A5:C5"],"freeze":{"rows":1},"validation":[{"range":"B2:B4","type":"list","formula1":"EU,US"}],"cf":[{"range":"F2:F4","rule":{"type":"highlightCell","subType":"number","operator":"greaterThan","value":10,"style":{"bg":{"rgb":"#e6e6e6"}}}}],"notes":{"F5":"Grand total"},"filter":{"range":"A1:F4"},"charts":[{"type":"column","range":"C1:D4"}]} -->

## Regions

| Code | Name   |
| ---- | ------ |
| EU   | Europe |
| US   | United States |

<!-- workbook: {"names":{"Grand":"=Orders!$F$5"},"scenarios":[{"name":"High price","cells":{"Orders!E2":5}}]} -->

```fql Summary
from sheet "Orders" range A1:F4
| groupby Region
| rollup qty = sum(Qty)
| load to sheet "Summary" at A1
```
