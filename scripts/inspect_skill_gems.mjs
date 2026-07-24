import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath =
  process.argv[2] ??
  "C:/Users/hanpe/Desktop/poe-trans-data/data/poe1/output/poe1_skill_gem_names_trilingual.xlsx";

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 12,
  tableMaxCellChars: 120,
});

console.log(summary.ndjson);
