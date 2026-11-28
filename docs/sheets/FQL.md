# FQL — Folio Query Language

FQL is Folio Sheets' language for getting and shaping data (Power Query) and for data models (Power Pivot). It is
plain text in the workbook, so people and AI assistants can read, write and review it like any other Markdown.

````markdown
```fql Sales
let minQty = 1

query Clean =
  from csv "data/orders.csv"
  | fill down Region
  | where Qty >= minQty and Region in ("EU", "US")
  | derive Total = Qty * Price, Month = month(Date)

query ByRegion =
  from query Clean
  | groupby Region
  | rollup Revenue = round(sum(Total), 2), Orders = count()
  | join Regions on Region = Code left
  | orderby -Revenue
  | load to sheet "Summary" at B2

query Regions = from sheet "Regions"
```
````

- Implementation: `src/sheets/core/fql/parse.js` (lexer and parser, errors with line and column) and
  `src/sheets/core/fql/run.js` (compiler onto Arquero tables). Both are pure; they run in the data engine.
- Expressions compile to closures; no text is ever evaluated as code.
- A block that holds only a pipeline (`from … | …`) is one query named after the block.

## Program

| Statement | Meaning |
|---|---|
| `let name = expr` | A parameter, usable in any expression. |
| `query Name = source \| step \| …` | A query. Names are case-insensitive and unique in the block; `` `Name with spaces` `` in backticks. |
| `model Name` + indented `table`, `relate`, `measure` lines | A data model (see below). |
| `-- comment`, `# comment` | Comments to the end of the line. |

A step may start on the next line, as long as the line starts with `|`.

## Sources

| Source | Reads |
|---|---|
| `from sheet "Orders"` / `from sheet "Orders" range A1:F200` | A sheet of this workbook as the person sees it (computed values). Row 1 holds the column names. |
| `from csv "data/x.csv"` / `with (delimiter = ";", header = true, types = true)` | A CSV file inside the open folder, relative to the workbook. |
| `from json "data/x.json"` | An array of objects, or `{ "data": [...] }`. |
| `from xlsx "data/book.xlsx" sheet "Sheet1"` | A sheet of an Excel file (SheetJS). |
| `from parquet "data/events.parquet"` | Parquet, through DuckDB (optional component). |
| `from sql "SELECT …"` / `on "data/db.duckdb"` | SQL through DuckDB; file paths in the SQL are workspace paths. |
| `from query Name` | Another query of the same block. Cycles are an error. |
| `from model Name evaluate m1, m2 by Table.col, …` | Measures of a model, grouped by any column of any related table. |
| `from values([["Name", "Qty"], ["a", 1]])` | Inline data. |

Every file path stays inside the open folder: the main process resolves it (`notes.resolve`) before the engine reads it.
DuckDB runs with external access switched off except for the files of that query.

## Steps

| Step | Example |
|---|---|
| `where` | `where Qty > 0 and not isnull(Region)` |
| `derive` | `derive Total = Qty * Price, Year = year(Date)` |
| `select` / `drop` | `select Region, Total` · `drop Notes` |
| `rename` | `rename Qty as Quantity, Price as Unit price` |
| `groupby` + `rollup` | `groupby Region \| rollup Revenue = sum(Total), Avg = Revenue / count()` |
| `orderby` | `orderby Region, -Revenue` (`-` for descending) |
| `join` | `join Regions on Region = Code left` (`inner`, `left`, `right`, `full`) |
| `append` | `append OtherQuery` (rows of another query with the same columns) |
| `pivot` | `pivot Month by Total` / `using count` — one column per key |
| `unpivot` | `unpivot Q1, Q2, Q3 as Quarter, Value` |
| `fill` | `fill down Region` / `fill up Region` |
| `dedupe` | `dedupe` (whole rows) / `dedupe Email` |
| `type` | `type Qty as number, Date as date` (`number`, `text`, `date`, `bool`) |
| `split` | `split Name by " " into First, Last` |
| `limit` | `limit 100` |
| `replace` | `replace Region "EU" with "Europe"` — whole values (case-insensitive for text); for parts of a text use `derive X = replace(X, "-", " ")` |
| `index` | `index Id` / `index Id from 0` — a numbered column first |
| `top` | `top 10 by -Revenue` — the first rows in that order (Keep top rows) |
| `merge` | `merge First, Last as Name using " "` — one column in place of several (empty parts skipped) |
| `split … into rows` | `split Tags by "," into rows` — one row per part, the other columns repeated |
| `transpose` | `transpose` — the first column's values become the column names |
| `transform` | `transform Name, City with trim` · `transform Price with round(2)` — a function applied to the column in place |
| `load` | `load to sheet "Summary" at B2` · `load to table Name` · `load to model` |

`load` says where a result goes when the person runs **Save and load** or **Data → Refresh all**. A refresh first
clears what the previous load of the same query wrote (the range is kept in the workbook settings as `loads`).

## Expressions

- Literals: `12`, `3.5`, `"text"`, `'text'`, `true`, `false`, `null`.
- Operators: `+ - * / % ^`, `== != <> < <= > >=`, `and or not`, `in (…)`, `between a and b`, `is null`, `is not null`.
  `+` joins text when either side is text that is not a number. Comparisons of text ignore case.
- Columns by name, `` `Name with spaces` ``, or `Table.column` inside models.
- `case when Qty >= 10 then "large" when Qty > 0 then "small" else "none" end` (the first true branch; no `else`: null).
- Functions: `lower upper trim len contains startswith endswith replace left right substr concat padleft part text number
  date round floor ceil abs sqrt ln exp mod power sign least greatest year month day quarter weekday weeknum today
  datediff adddays addmonths eomonth if coalesce isnull`; patterns (regular expressions, case-insensitive):
  `matches(Code, "^[a-z]{2}-")`, `extract(Code, "-(\d+)")` (the first group, or the whole match).
- Text in quotes: `\n` and `\t` are a line break and a tab, `\"` and `\\` the character; any other `\` stays as written,
  so patterns read as usual (`"\d+"`).
- Aggregates (in `rollup` and measures): `sum count avg mean average min max median stdev variance distinct first last
  product mode any`. A rollup value may combine aggregates: `Margin = (sum(Revenue) - sum(Cost)) / sum(Revenue)`.

## Data models

```fql
model Sales
  table Orders = query Clean
  table Regions = from sheet "Regions"
  relate Orders.Region -> Regions.Code
  measure Revenue = sum(Orders.Total)
  measure Count = count(Orders)
  measure `Avg order` = Revenue / Count

query ByName = from model Sales evaluate Revenue, `Avg order` by Regions.Name | orderby Name
```

- `table` takes any source and steps.
- `relate A.x -> B.y` is many-to-one: each row of A finds at most one row of B.
- A measure may use other measures; they are expanded, so `Revenue / Count` is computed per group, not row by row.
- `evaluate … by …` groups by columns of the first table or of any table reachable through relations.
- The model flattened along its relations is what a PivotTable with `source: model Sales` uses.

## Errors

Every error names the problem and where it is: `Expected a step (where, derive, …), found "wher". Did you mean where? (line 4, column 3)`, `No column named Totl`,
`The query A depends on itself`, `File not found: data/x.csv`, `A rollup value must be an aggregate such as sum(Total)`.
