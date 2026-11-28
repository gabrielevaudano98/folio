// FQL — Folio Query Language: parser errors, transformations, joins, the data model.
import assert from 'node:assert/strict';
import { parse, inputsOf } from '../src/sheets/core/fql/parse.js';
import { run } from '../src/sheets/core/fql/run.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('fql');
const orders = [['Date', 'Region', 'Product', 'Qty', 'Price'], ['2026-01-05', 'EU', 'Notebook', 4, 3.5], ['2026-01-09', 'US', 'Pen', 12, 1.2], ['2026-02-02', 'EU', 'Folder', 6, 2.1], ['2026-02-10', 'EU', 'Pen', 0, 1.2], ['2026-03-01', null, 'Pen', 3, 1.2]];
const regions = [['Code', 'Name'], ['EU', 'Europe'], ['US', 'United States']];
const env = { sheets: { Orders: orders, Regions: regions }, files: { 'data/x.csv': { text: 'a,b\n1,x\n2,y\n3,x\n' } } };

const src = `
-- totals by region
let minQty = 1
query Clean =
  from sheet "Orders"
  | fill down Region
  | where Qty >= minQty
  | derive Total = Qty * Price, Month = month(Date)

query ByRegion =
  from query Clean
  | groupby Region
  | rollup Revenue = round(sum(Total), 2), Orders = count(), \`Avg qty\` = avg(Qty)
  | join Names on Region = Code left
  | orderby -Revenue
  | load to sheet "Summary" at B2

query Names = from sheet "Regions"
query Csv = from csv "data/x.csv" | where b == "x" | rollup s = sum(a)
query Wide = from query Clean | select Region, Month, Total | pivot Month by Total
query Long = from values([["k", "q1", "q2"], ["a", 1, 2]]) | unpivot q1, q2 as quarter, value

model Sales
  table Orders = query Clean
  table Regions = from sheet "Regions"
  relate Orders.Region -> Regions.Code
  measure Revenue = sum(Orders.Total)
  measure Count = count(Orders)
  measure \`Avg order\` = Revenue / Count

query ModelView = from model Sales evaluate Revenue, \`Avg order\` by Regions.Name | orderby Name
`;
const p = parse(src);
assert.equal(p.queries.length, 7); assert.equal(p.models[0].measures.length, 3); assert.deepEqual(inputsOf(p).files, [{ kind: 'csv', path: 'data/x.csv' }]); ok('a program parses: queries, a model with relations and measures, parameters');
const r = await run(src, env);
assert.deepEqual(r.results.ByRegion, [['Region', 'Revenue', 'Orders', 'Avg qty', 'Code', 'Name'], ['EU', 30.2, 3, 13 / 3, 'EU', 'Europe'], ['US', 14.4, 1, 12, 'US', 'United States']]); ok('fill down, filter, derive, group, rollup with expressions, left join, sort');
assert.deepEqual(r.loads, [{ query: 'ByRegion', to: 'sheet', sheet: 'Summary', cell: 'B2', name: undefined }]); ok('load to sheet says where results go');
assert.deepEqual(r.results.Csv, [['s'], [4]]); ok('CSV source with typed columns');
assert.deepEqual(r.results.Wide[0], ['Region', '1', '2', '3']); ok('pivot to wide');
assert.deepEqual(r.results.Long, [['k', 'quarter', 'value'], ['a', 'q1', 1], ['a', 'q2', 2]]); ok('unpivot to long');
assert.deepEqual(r.results.ModelView.map((row) => row.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))), [['Name', 'Revenue', 'Avg order'], ['Europe', 30.2, 10.066667], ['United States', 14.4, 14.4]]); ok('data model: measures that use measures, evaluated by a column of a related table');
const flat = await run(src, env, { flat: 'Sales' }); assert(flat.flat[0].includes('Regions.Name') && flat.flat.length === 5); ok('the model flattens along its relations for the pivot table');
for (const [bad, msg] of [['query A = from sheet "X" | wher x > 1', /Did you mean where\?.*line 1, column 28/], ['query A = from sheet "Orders" | rollup x = Qty', /aggregate/], ['query A = from query A', /depends on itself/], ['query A = from sheet "Orders" | select Nope', /No column named Nope/], ['query A = from csv "nope.csv"', /File not found/], ['model M\n  relate A.x -> B.y', /no table A/]]) {
  await assert.rejects(async () => run(bad, env), msg, bad);
}
ok('errors name the problem and where it is');
{
  // Power Query parity: conditional column, replace values, index, keep top rows, merge columns, split into rows,
  // transpose, transform a column, and functions that are also step names (replace) still work as functions
  const q = `
query Sized = from sheet "Orders"
  | where not isnull(Region)
  | derive Size = case when Qty >= 10 then "large" when Qty > 0 then "small" else "none" end, Tag = replace(Product, "o", "0")
  | replace Region "EU" with "Europe"
  | top 2 by -Qty
  | index Id from 10
  | select Id, Region, Product, Size, Tag
query Names = from values([["First", "Last", "Tags"], ["Ada", "Lovelace", "math, poetry"], ["Alan", null, "code"]])
  | merge First, Last as Name using " "
  | split Tags by "," into rows
  | transform Name with upper
  | transform Tags with padleft(8, "*")
query Flip = from values([["Metric", "Q1", "Q2"], ["Revenue", 10, 20], ["Cost", 4, 5]]) | transpose
query Fns = from values([["Code", "When"], ["AB-123", "2026-01-31"]])
  | derive n = extract(Code, "-(\\d+)"), ok = matches(Code, "^[a-z]{2}-"), next = addmonths(When, 1), eom = eomonth(When), wk = weeknum(When), p = part(Code, "-", 2), m = mod(-7, 3)
`;
  const x = (await run(q, env)).results;
  assert.deepEqual(x.Sized, [['Id', 'Region', 'Product', 'Size', 'Tag'], [10, 'US', 'Pen', 'large', 'Pen'], [11, 'Europe', 'Folder', 'small', 'F0lder']]);
  assert.deepEqual(x.Names, [['Name', 'Tags'], ['ADA LOVELACE', '****math'], ['ADA LOVELACE', '**poetry'], ['ALAN', '****code']]);
  assert.deepEqual(x.Flip, [['Metric', 'Revenue', 'Cost'], ['Q1', 10, 4], ['Q2', 20, 5]]);
  const f = x.Fns[1]; const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  assert.deepEqual([f[2], f[3], iso(f[4]), iso(f[5]), f[6], f[7], f[8]], ['123', true, '2026-02-28', '2026-01-31', 5, '123', 2]);
  ok('case when, replace, top, index, merge, split into rows, transpose, transform and the new functions');
  await assert.rejects(async () => run('query A = from sheet "Orders" | top 2 by Nope', env), /No column named Nope/);
  await assert.rejects(async () => run('query A = from sheet "Orders" | transform Qty with nosuch', env), /Unknown function nosuch/);
  await assert.rejects(async () => run('query A = from sheet "Orders" | merge Qty as X', env), /merge needs two columns/);
  ok('the new steps report mistakes with their place');
}
console.log(`\n${n} FQL checks passed`);
