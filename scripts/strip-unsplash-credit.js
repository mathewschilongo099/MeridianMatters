// One-time cleanup: removes " / Unsplash" from existing articles.json
// credit fields (both the top-level imageCredit and each inline image's
// credit). Run once, then delete this file.
const fs = require('fs');
const path = require('path');

const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');

const data = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));

let changed = 0;

for (const article of data.articles || []) {
  if (article.imageCredit && article.imageCredit.includes(' / Unsplash')) {
    article.imageCredit = article.imageCredit.replace(' / Unsplash', '');
    changed++;
  }
  for (const img of article.images || []) {
    if (img.credit && img.credit.includes(' / Unsplash')) {
      img.credit = img.credit.replace(' / Unsplash', '');
      changed++;
    }
  }
}

fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
console.log(`Updated ${changed} credit field(s) in data/articles.json`);
