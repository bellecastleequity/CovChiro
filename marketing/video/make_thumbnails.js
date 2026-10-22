// Renders each thumbnail in thumbnails.html to thumbnails/<id>.jpg at its exact size.
//   node make_thumbnails.js
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.goto('file://' + path.join(__dirname, 'thumbnails.html')); await p.waitForTimeout(800);
  for (const id of await p.$$eval('.t', (els) => els.map((e) => e.id))) {
    await p.locator('#' + id).screenshot({ path: path.join(__dirname, 'thumbnails', id + '.jpg'), type: 'jpeg', quality: 92 });
    console.log('thumbnails/' + id + '.jpg');
  }
  await br.close();
})();
