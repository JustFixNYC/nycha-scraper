const fs = require('fs');
const pdf = require('pdf-parse');

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

  const pageLineItems = [];

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
      if (lineItems.length === 1 && pageLineItems.length > 0) {
        const thisItem = lineItems[0];
        const prevLineItems = pageLineItems[pageLineItems.length - 1];
        const lastItemOfPrevLine = prevLineItems[prevLineItems.length - 1];

        if (thisItem.x === lastItemOfPrevLine.x) {
          lastItemOfPrevLine.text += thisItem.text;
          return;
        }
      }
      pageLineItems.push(lineItems);
    });

  pageLineItems.forEach(lineItems => console.log(lineItems.map(i => i.text)));

  // TODO: Remove this line.
  process.exit(1);

  return text;
});
}

let options = {
  pagerender: render_page
}

pdf(dataBuffer, options).then(function(data) {

	// number of pages
	console.log(data.numpages);
	// number of rendered pages
	console.log(data.numrender);
	// PDF info
	console.log(data.info);
	// PDF metadata
	console.log(data.metadata); 
	// PDF.js version
	// check https://mozilla.github.io/pdf.js/getting_started/
	console.log(data.version);
	// PDF text
	console.log(data.text.slice(0, 1000)); 
        
});
