const fs = require('fs');
const assert = require('assert');
const pdf = require('pdf-parse');
 const { generate } = require('csv-generate/sync');

/**
 * The base name of the PDF file we read, and the CSV
 * file we write to.
 */
const BASE_NAME = 'Block-and-Lot-Guide-01012024';

/** The boroughs, as they appear in the PDF. */
const BOROUGHS = [
  'BRONX',
  'BROOKLYN',
  'MANHATTAN',
  'QUEENS',
  'STATEN ISLAND'
];

/** The header row for each page. */
const HEADER_ROW = [
  'BLOCK',
  'LOT',
  'ADDRESS',
  'ZIP CODE',
  'DEVELOPMENT',
  'MANAGED BY',
  'CD#',
  'FACILITY'
];

/** The number of columns in the table on each page. */
const NUM_COLS = HEADER_ROW.length;

/** The names of the columns we output in our CSV. */
const OUR_HEADER_ROW = ['BOROUGH', ...HEADER_ROW];

/**
 * The number of lines on each page that represent the
 * "footer", e.g. the page number, notes, etc.
 */
const NUM_FOOTER_LINES = 3;

/**
 * The number of lines on each page that represent the
 * "header", e.g. the header row, heading text, etc.
 */
const NUM_HEADER_LINES = 4;

/**
 * A list of all the "bad" rows we've encountered that
 * we don't know what to do with.
 * 
 * This is a global because pdf-parse's API is weird.
 */
const g_badRows = [];

/**
 * A list of all the rows in our output CSV.
 * 
 * This is a global because pdf-parse's API is weird.
 */
const g_allRows = [OUR_HEADER_ROW];

/**
 * Build a mapping from y-coordinates to all the items at
 * each y-coordinate.
 */
function buildLineItemsMap(items) {
  let lineItemsMap = new Map();

  for (let item of items) {
    const y = item.transform[5];
    const x = item.transform[4];
    const lineItem = { x, y, text: item.str };
    if (!lineItemsMap.has(y)) {
      lineItemsMap.set(y, []);
    }
    const lineItems = lineItemsMap.get(y);
    lineItems.push(lineItem);
  }

  return lineItemsMap;
}

/**
 * Build a list of all the lines on the page.
 * 
 * Each line is a list of text fragments, ordered by
 * their x-coordinate (i.e., from left-to-right).
 */
function buildPageLineItems(lineItemsMap) {
  const pageLineItems = [];

  Array.from(lineItemsMap.keys())
    // LOL, even though we're sorting a list of numbers, JS sorts them
    // lexographically by default, so we need to provide
    // our own comparison function.
    .sort((a, b) => a - b)
    .reverse()
    .forEach(y => {
      const lineItems = lineItemsMap.get(y);
      lineItems.sort((a, b) => {
        if (a.x < b.x) return -1;
        if (a.x > b.x) return 1;
        return 0;
      });
      pageLineItems.push(lineItems);
    });

  return pageLineItems;
}

/**
 * Some "lines" on a page are actually just the continuation of a cell from
 * the previous row. Ths coalesces the lines so that every line actually
 * represents a table row.
 */
function coalescePageLineItems(pageLineItems) {
  const coalescedPageLineItems = [];

  pageLineItems.forEach((items) => {
    assert(items.length <= NUM_COLS, `Rows should have no more than ${NUM_COLS} columns`);
    const firstItemAsNumber = parseInt(items[0].text);
    if (isNaN(firstItemAsNumber)) {
      // This is a continuation row.
      const prevItems = coalescedPageLineItems[coalescedPageLineItems.length - 1];
      items.forEach(item => {
        for (let i = 0; i < prevItems.length; i++) {
          const prevItem = prevItems[i];
          if (prevItem.x === item.x) {
            prevItem.text += item.text;
            return;
          }
        }
        throw new Error(`Unable to coalesce ${JSON.stringify(item.text)} into previous row`);
      });
    } else {
      // This is the beginning of a new row.
      if (items.length < NUM_COLS) {
        if (items.length === NUM_COLS - 1 && !isNaN(parseInt(items[NUM_COLS - 2].text))) {
          // It's just a normal column with the last column being blank.
          items.push({ x: 0, y: 0, text: '' });
        } else {
          const rowText = items.map(item => item.text).join(' ');
          console.log(`WARNING: Not sure what to do with: ${rowText}`);
          g_badRows.push(items);
          assert(!/MANAGEMENT/i.test(rowText), 'sparse row should not be a management office');
        }
      }
      coalescedPageLineItems.push(items);
    }
  });

  return coalescedPageLineItems;
}

/**
 * Parse the page given to us by pdf-parse.
 */
function parsePage(textContent) {
  let pageLineItems = buildPageLineItems(buildLineItemsMap(textContent.items));

  let [ _, pageNumber, borough ] = pageLineItems
    .slice(-NUM_FOOTER_LINES)
    .map(i => i[0].text);

  console.log(`Processing page ${pageNumber} (${borough})`);

  assert(BOROUGHS.indexOf(borough) !== -1, 'borough must be a borough');

  pageLineItems = pageLineItems.slice(0, -NUM_FOOTER_LINES);

  const headerLines = pageLineItems.slice(0, NUM_HEADER_LINES).map(items => items.map(item => item.text));

  pageLineItems = pageLineItems.slice(NUM_HEADER_LINES);

  pageNumber = parseInt(pageNumber);

  assert(!isNaN(pageNumber), 'page number must be a number');

  assert.deepEqual(headerLines, [
    [ 'NYCHA PROPERTY DIRECTORY ' ],
    [ borough ],
    [ 'BLOCK and LOT GUIDE as of 1/1/2024' ],
    HEADER_ROW,
  ], 'header rows must be what we expect');

  const fullRows = coalescePageLineItems(pageLineItems)
    .filter(items => items.length === NUM_COLS)
    .map(items => [borough, ...items.map(item => item.text)]);

  g_allRows.push.apply(g_allRows, fullRows);
}

/** Render the page given to us by pdf-parse. */
function renderPage(pageData) {
  //check documents https://mozilla.github.io/pdf.js/
  return pageData.getTextContent({
    // Replaces all occurrences of whitespace with standard spaces (0x20). The default value is `false`.
    normalizeWhitespace: false,
    // Do not attempt to combine same line TextItem's. The default value is `false`.
    disableCombineTextItems: true
  }).then(parsePage).catch(e => {
    // Apparently whatever uses us doesn't do anything with exceptions, so
    // we'll log and terminate ourselves.
    console.log(e);
    process.exit(1);
  });
}

if (module.parent === null) {
  console.log('Reading PDF...');
  const dataBuffer = fs.readFileSync(`${BASE_NAME}.pdf`);

  console.log('Parsing PDF...');
  pdf(dataBuffer, {
    pagerender: renderPage
  }).then(function(data) {
    console.log(`Found ${g_allRows.length - 1} good rows and ${g_badRows.length} bad ones.`);
    const csv = generate(g_allRows);
    // console.log('Generate csv function has finished.')
    const outfile = `${BASE_NAME}.csv`;

    fs.writeFileSync(outfile, csv); 
    console.log(`Wrote ${outfile}.`);

    // testing writing out to a txt file below
    // var file = fs.createWriteStream(`${BASE_NAME}.txt`);
    // file.on('error', function(err) { /* error handling */ });
    // g_allRows.forEach(function(v) { file.write(v.join(', ') + '\n'); });
    // file.end();
  });
}
