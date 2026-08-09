/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Google Gemini + Unsplash + GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!GEMINI_API_KEY || !UNSPLASH_ACCESS_KEY) {
  console.error('Missing API keys');
  process.exit(1);
}

const CATEGORIES = [
  { id: 'news', name: 'Global News' },
  { id: 'sports', name: 'Sports' },
  { id: 'health', name: 'Health' },
  { id: 'finance', name: 'Finance' }
];

const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');
const GEMINI_MODEL = 'gemini-2.5-flash';

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 350)}`);
  return JSON.parse(text);
}

function getTopic(category) {
  const topics = {
    news: ['international diplomacy update', 'climate policy news', 'global technology regulation', 'major world summit'],
    sports: ['major tournament result', 'athlete record performance', 'world championship news', 'sports underdog story'],
    health: ['new medical study', 'vaccine research update', 'public health finding', 'wellness research'],
    finance: ['central bank decision', 'stock market movement', 'crypto regulation news', 'retirement savings trend']
  };
  const list = topics[category.id];
  return list[Math.floor(Math.random() * list.length)];
}

async function generateArticle(category, topic) {
  const prompt = `Write a short professional news article for MeridianMatters.

Topic: ${topic}
Category: ${category.name}

Return ONLY a JSON object with these exact keys:
- title (max 10 words)
- summary (max 25 words)
- content (exactly 2 short sentences)
- author (realistic name)

Keep the entire response under 400 characters. No markdown.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  console.log(`  Calling Gemini...`);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 500,
      responseMimeType: 'application/json'
    }
  };

  const data = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Gemini');

  // Clean and extract JSON
  text = text.replace(/```json|```/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found');

  const parsed = JSON.parse(text.substring(start, end + 1));

  if (!parsed.title || !parsed.summary || !parsed.content || !parsed.author) {
    throw new Error('Missing fields in response');
  }

  return parsed;
}

async function getImage(query) {
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });
    const photo = (data.results || [])[0];
    if (!photo) return { url: '', alt: query };
    return { url: photo.urls?.regular || '', alt: photo.alt_description || query };
  } catch {
    return { url: '', alt: query };
  }
}

function loadArticles() {
  try {
    return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch {
    return { lastUpdated: new Date().toISOString(), articles: [] };
  }
}

function saveArticles(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
}

async function main() {
  console.log('========================================');
  console.log('MeridianMatters Article Generator');
  console.log('Time:', new Date().toISOString());
  console.log('========================================');

  const data = loadArticles();
  const newArticles = [];

  for (const category of CATEGORIES) {
    try {
      console.log(`\n→ ${category.name}`);
      const topic = getTopic(category);
      console.log(`  Topic: ${topic}`);

      const generated = await generateArticle(category, topic);
      console.log(`  Title: ${generated.title}`);

      const image = await getImage(category.name + ' ' + generated.title.split(' ').slice(0, 3).join(' '));
      console.log(`  Image: ${image.url ? 'Yes' : 'No'}`);

      newArticles.push({
        id: `${category.id}-${Date.now().toString(36)}`,
        category: category.id,
        title: generated.title,
        summary: generated.summary,
        content: generated.content,
        author: generated.author,
        date: new Date().toISOString().split('T')[0],
        image: image.url,
        imageAlt: image.alt,
        tags: [category.id],
        featured: Math.random() > 0.5
      });

      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`✗ Failed: ${err.message}`);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles generated.');
    return;
  }

  data.articles = [...newArticles, ...data.articles].slice(0, 60);
  saveArticles(data);

  console.log(`\n✅ Added ${newArticles.length} new articles`);
  console.log('Total now:', data.articles.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
