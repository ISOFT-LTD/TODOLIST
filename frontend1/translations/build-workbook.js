// Builds todo-translation-keys.xlsx from todo-translation-keys.csv.
//
//   npm run translation-keys          (from frontend/)
//
// The CSV is the inventory: keys only. The workbook is the same keys in one
// column, for preparing the import into the translation database. It holds
// no text in any language. A test fails when the two drift apart.

import { writeFileSync } from 'node:fs';
import { WORKBOOK_FILE, buildWorkbook, readInventory } from './inventory.js';

const keys = readInventory();
writeFileSync(WORKBOOK_FILE, buildWorkbook([['key'], ...keys.map((key) => [key])]));
console.log(`${WORKBOOK_FILE}: ${keys.length} keys`);
