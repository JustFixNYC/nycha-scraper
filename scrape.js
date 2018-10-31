const fs = require('fs');
const pdf = require('pdf-parse');
const assert = require('assert');

console.log('reading pdf...');
let dataBuffer = fs.readFileSync('Block-and-Lot-Guide-08272018.pdf');

console.log('parsing pdf...');

// default render callback
function render_page(pageData) {
  //check documents https://mozilla.github.io/pdf.js/
  let render_options = {
      //replaces all occurrences of whitespace with standard spaces (0x20). The default value is `false`.
      normalizeWhitespace: false,
      //do not attempt to combine same line TextItem's. The default value is `false`.
      disableCombineTextItems: true
  }

  return pageData.getTextContent(render_options)
.then(function(textContent) {
  let lineItemsMap = new Map();
  for (let item of textContent.items) {
    const y = item.transform[5];
    const x = item.transform[4];
    const lineItem = { x, y, text: item.str };
    if (!lineItemsMap.has(y)) {
      lineItemsMap.set(y, []);
    }
    const lineItems = lineItemsMap.get(y);
    lineItems.push(lineItem);
  }

  let pageLineItems = [];

  Array.from(lineItemsMap.keys())
    // LOL, JS sorts them lexographically by default, so we need to provide
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

  const NUM_FOOTER_LINES = 3;
  const NUM_HEADER_LINES = 4;
  const BOROUGHS = [
    'BRONX',
    'BROOKLYN',
    'MANHATTAN',
    'QUEENS',
    'STATEN ISLAND'
  ];

  let [ _, pageNumber, borough ] = pageLineItems.slice(-NUM_FOOTER_LINES).map(i => i[0].text);

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
    [ 'BLOCK and LOT GUIDE' ],
    [ 'BLOCK',
      'LOT',
      'ADDRESS',
      'ZIP CODE',
      'DEVELOPMENT',
      'MANAGED BY',
      'CD#',
      'FACILITY' ]
  ], 'header rows must be what we expect');

  const coalescedPageLineItems = [];
  const firstRow = pageLineItems[0];

  assert.equal(firstRow.length, 8, 'First row of page should have 8 items');

  pageLineItems.forEach((items) => {
    assert(items.length <= 8, 'Rows should have no more than 8 columns');
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
      if (items.length < 8) {
        // TODO: Some of the items are empty, figure out what they are.
      }
      coalescedPageLineItems.push(items);
    }
    return;
  });

  return '';
});
}

let options = {
  pagerender: render_page
}

pdf(dataBuffer, options).then(function(data) {
  console.log("Done.");
});
