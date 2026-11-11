// @vitest-environment node
//
// The plugin's key inventory - translations/todo-translation-keys.csv, and
// the workbook made from it - against the keys the plugin actually uses.
//
// The inventory holds KEYS ONLY. The texts, in every language, are in the
// centralized translation database and nowhere in this project: no English,
// no Portuguese, no fallback. This file is what keeps it that way.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INVENTORY_FILE,
  WORKBOOK_FILE,
  buildWorkbook,
  readInventory,
  readWorkbook,
} from '../translations/inventory.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(SRC, '..');
const ROOT = join(FRONTEND, '..');

/** A key the plugin's own UI asks sdk.i18n for. */
const UI_KEY = /^todo\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The same, where a source file writes one: quoted, or the value of a data-i18n attribute. */
const UI_KEY_IN_SOURCE = /(['"`])(todo\.[a-z0-9]+(?:-[a-z0-9]+)*)\1/g;
/** Any key at all: lower case, no spaces, nothing a text would hold. */
const ANY_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** The key the Core looks up for a label it draws: lower case, each run of spaces as one hyphen. */
const coreKeyOf = (label) => label.toLowerCase().replace(/\s+/g, '-');
/** A label written as a key: the Core looks it up exactly as it is written. */
const isKey = (label) => ANY_KEY.test(label) && coreKeyOf(label) === label;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** What the plugin ships: its sources and the standalone page, without the tests and their stand-ins. */
const shipped = [
  ...filesUnder(SRC).filter((file) => {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    return !rel.endsWith('.test.js') && !rel.startsWith('testing/');
  }),
  join(FRONTEND, 'index.html'),
];
const read = (file) => readFileSync(file, 'utf8');
const named = (file) => relative(ROOT, file).replace(/\\/g, '/');

const manifest = JSON.parse(read(join(ROOT, 'manifest.json')));
const groups = manifest.navigation.filter((entry) => Array.isArray(entry.children));
const pages = groups.flatMap((group) => group.children);

/** The labels the Core draws that are no tab names: group titles and contribution tabs. */
const drawnLabels = [
  ...groups.map((group) => group.label),
  ...manifest.contributes.filter((c) => typeof c.label === 'string').map((c) => c.label),
];

/** Every key the plugin's UI asks for, as written in what it ships. */
function uiKeys() {
  const keys = new Set();
  for (const file of shipped) {
    for (const [, , key] of read(file).matchAll(UI_KEY_IN_SOURCE)) keys.add(key);
  }
  return keys;
}

/** Every key the Core looks up for this plugin's metadata, where the label is written as a key. */
const labelKeys = () => new Set([...drawnLabels, ...pages.map((page) => page.label)].filter(isKey));

const referenced = () => new Set([...uiKeys(), ...labelKeys()]);

const inventory = readInventory();
const inventoryKeys = new Set(inventory);

describe('the inventory holds keys only', () => {
  it('is one column, named key, with one key on each line and nothing beside it', () => {
    const lines = read(INVENTORY_FILE).split(/\r?\n/).filter((line) => line !== '');
    expect(lines[0]).toBe('key');
    for (const line of lines.slice(1)) {
      expect(line, 'a line of the inventory is a key and nothing else').toMatch(ANY_KEY);
    }
    expect(inventory).toEqual(lines.slice(1));
  });

  it('holds no text in any language: no separator, no space, no capital, no quote', () => {
    const body = read(INVENTORY_FILE);
    expect(body).not.toMatch(/[,;\t"' =:]/);
    expect(body).not.toMatch(/[A-Z]/);
    expect(body).not.toMatch(/[^\x00-\x7F]/);
  });

  it('holds each key once, none blank', () => {
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory.every((key) => key.trim() !== '')).toBe(true);
    expect(inventoryKeys.size).toBe(inventory.length);
  });

  it('is sorted by key', () => {
    expect(inventory).toEqual([...inventory].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('holds keys of the plugin: todo.<key>, or the key of a label in its manifest', () => {
    const labels = labelKeys();
    for (const key of inventory) {
      expect(UI_KEY.test(key) || labels.has(key), `${key} is neither todo.<key> nor a label of the manifest`).toBe(true);
    }
  });

  it('is the only file of its kind: nothing beside it but the workbook and the tools', () => {
    expect(readdirSync(dirname(INVENTORY_FILE)).sort()).toEqual([
      'build-workbook.js',
      'inventory.js',
      'todo-translation-keys.csv',
      'todo-translation-keys.xlsx',
    ]);
  });
});

describe('the inventory and the code', () => {
  it('has every key the plugin asks for', () => {
    const missing = [...referenced()].filter((key) => !inventoryKeys.has(key));
    expect(missing, 'referenced in the code or the manifest, missing from the inventory').toEqual([]);
  });

  it('has no key the plugin no longer asks for', () => {
    const asked = referenced();
    const unused = inventory.filter((key) => !asked.has(key));
    expect(unused, 'in the inventory, referenced nowhere').toEqual([]);
  });

  it('every text the markup names is named by a key of the plugin', () => {
    for (const file of shipped) {
      for (const [, key] of read(file).matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)) {
        expect(key, `${named(file)}: data-i18n names "${key}"`).toMatch(UI_KEY);
      }
    }
  });

  it('keys are written out in full: none is built at run time', () => {
    for (const file of shipped) {
      const source = read(file);
      expect(source, named(file)).not.toMatch(/['"`]todo\.(?:['"`]|\$\{)/);
      expect(source, named(file)).not.toMatch(/['"`]todo\.[a-z0-9-]*\$\{/);
    }
  });
});

describe('the plugin ships no texts', () => {
  it('bundles no translation file and imports no inventory', () => {
    for (const file of shipped) {
      const rel = named(file);
      expect(rel, 'a file of texts in the plugin').not.toMatch(/\.(json|csv|xlsx|po|yaml|yml)$/);
      expect(rel, 'a locale folder in the plugin').not.toMatch(/locales?\//);
      expect(read(file), rel).not.toMatch(/translations\/|testing\//);
    }
  });

  it('puts no words of its own behind a key: no fallback for what sdk.i18n answers', () => {
    for (const file of shipped) {
      const source = read(file);
      // t('todo.add') || 'Add', t('todo.add') ?? 'Add', textOr(...), and the like.
      expect(source, named(file)).not.toMatch(/\bt\(\s*(['"`])[^'"`]*\1\s*\)\s*(?:\|\||\?\?)/);
      expect(source, named(file)).not.toMatch(/translate\(\s*(['"`])[^'"`]*\1\s*\)\s*(?:\|\||\?\?)/);
      expect(source, named(file)).not.toMatch(/\b(?:textOr|fallback|defaultText|defaultValue)\b/i);
    }
  });

  it('requests no translations', () => {
    for (const file of shipped) {
      expect(read(file), named(file)).not.toMatch(/translate\/|\/translate|language_id/);
    }
  });
});

describe('the workbook', () => {
  const rows = [['key'], ...inventory.map((key) => [key])];

  it('exists beside the inventory', () => {
    expect(existsSync(WORKBOOK_FILE), `${WORKBOOK_FILE}: run "npm run translation-keys"`).toBe(true);
  });

  it('holds exactly the inventory: one sheet, one column named key, one row per key', () => {
    const sheets = readWorkbook(readFileSync(WORKBOOK_FILE));
    expect(sheets.map(({ name }) => name)).toEqual(['keys']);
    for (const row of sheets[0].rows) expect(row.length).toBe(1);
    expect(sheets[0].rows).toEqual(rows);
  });

  it('is what the inventory builds, the same bytes every time', () => {
    expect(readWorkbook(buildWorkbook(rows))[0].rows).toEqual(rows);
    expect(readWorkbook(buildWorkbook(rows, { compress: true }))[0].rows).toEqual(rows);
    expect(buildWorkbook(rows).equals(buildWorkbook(rows))).toBe(true);
    expect(readFileSync(WORKBOOK_FILE).equals(buildWorkbook(rows))).toBe(true);
  });
});

describe('the manifest', () => {
  it('writes the labels the Core draws for a group and a contribution as keys, in the inventory', () => {
    expect(drawnLabels.length).toBeGreaterThan(0);
    for (const label of drawnLabels) {
      expect(isKey(label), `"${label}" is words, not a key`).toBe(true);
      expect(inventoryKeys.has(label), `${label} is not in the inventory`).toBe(true);
    }
  });

  it('declares that the plugin reads sdk.i18n', () => {
    expect(manifest.frontend.sdk).toContain('i18n');
  });

  // Not done, and not to be settled from this repository. In the Core's
  // contract the label of a page is one field with two uses: as it is, it is
  // the page's tab_name in the user's allowed_tabs - what grants the page -
  // and, lower-cased and hyphenated, it is the key of the text on screen.
  // Writing a key there renames the tab, and the tab's name is the Core's.
  it.todo('writes the labels of its pages as keys - blocked: a page label is also its tab_name in allowed_tabs');

  it('until then, asks nothing of the inventory for a page label that is still words', () => {
    for (const page of pages) {
      if (isKey(page.label)) expect(inventoryKeys.has(page.label), `${page.label} is not in the inventory`).toBe(true);
      else expect(inventoryKeys.has(coreKeyOf(page.label))).toBe(false);
    }
  });
});
