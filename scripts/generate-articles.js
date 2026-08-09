/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Google Gemini + Unsplash + GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!GEMINI_API_KEY || !UNSPLASH_ACCESS_KEY) {
  console.error('Missing API keys. Make sure GEMINI_API_KEY and UNSPLASH_ACCESS_KEY secrets are set.');
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON response: ' + text.substring(0, 200));
  }
}

async function getTrendingTopic(category) {
  const topics = {
    news: [
      'latest major international diplomatic development',
      'global climate or environment policy update',
      'significant geopolitical event this week',
      'technology regulation or digital privacy news',
      'major international summit or agreement'
    ],
    sports: [
      'major football or soccer tournament result',
      'notable athlete performance or injury update',
      'Olympic or world championship news',
      'surprising sports underdog victory',
      'transfer news or coaching change in major league'
    ],
    health: [
      'new medical research or vaccine development',
      'public health recommendation or study',
      'mental health or wellness breakthrough',
      'nutrition or lifestyle science finding',
      'breakthrough in disease treatment or prevention'
    ],
    finance: [
      'stock market or central bank decision',
      'cryptocurrency or fintech regulation',
      'personal finance or retirement trend',
      'global economic indicator update',
      'major company earnings or market movement'
    ]
  };

  const list = topics[category.id] || topics.news;
  return list[Math.floor(Math.random() * list.length)];
}

async function generateArticleWithGemini(category, topic) {
  const prompt = `You are a professional journalist for MeridianMatters magazine.

Write a short professional news article about: ${topic}
Category: ${category.name}

STRICT RULES:
- Headline: max 12 words
- Summary: max 35 words
- Content: exactly 2 short paragraphs (total under 120 words)
- Author: invent a realistic name (e.g. "A. Rivera" or "Dr. L. Chen")

Return ONLY this pure JSON object. No markdown, no code fences, no extra text before or after:
{"title":"...","summary":"...","content":"...","author":"..."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  console.log(`  Calling Gemini (${GEMINI_MODEL})...`);

  const data = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800
      }
    })
  });

  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    console.error('  Empty response from Gemini:', JSON.stringify(data).substring(0, 300));
    throw new Error('Empty response from Gemini');
  }

  // Aggressive cleaning
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Extract the JSON object even if there is extra text
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    console.error('  No JSON object found. Raw:', text.substring(0, 400));
    throw new Error('No JSON object found in response');
  }

  const jsonStr = text.substring(start, end + 1);

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.title || !parsed.summary || !parsed.content || !parsed.author) {
      throw new Error('Missing required fields');
    }
    // Ensure content is not too long
    if (parsed.content.length > 600) {
      parsed.content = parsed.content.substring(0, 580) + '...';
    }
    return parsed;
  } catch (e) {
    console.error('  JSON parse failed. Extracted:', jsonStr.substring(0, 400));
    throw new Error('Invalid JSON from Gemini: ' + e.message);
  }
}

async function getUnsplashImage(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;

  console.log(`  Searching Unsplash...`);

  try {
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });

    const results = data.results || [];
    if (results.length === 0) return { url: '', alt: query };

    const photo = results[Math.floor(Math.random() * results.length)];
    return {
      url: photo.urls?.regular || photo.urls?.small || '',
      alt: photo.alt_description || query
    };
  } catch (err) {
    console.error('  Unsplash error:', err.message);
    return { url: '', alt: query };
  }
}

function loadArticles() {
  try {
    const raw = fs.readFileSync(ARTICLES_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { lastUpdated: new Date().toISOString(), articles: [] };
  }
}

function saveArticles(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
  console.log('  Saved articles.json successfully');
}

function createId(category) {
  return `${category}-${Date.now().toString(36)}`;
}

async function generateOneArticle(category) {
  console.log(`\n→ Generating article for: ${category.name}`);

  const topic = await getTrendingTopic(category);
  console.log(`  Topic seed: ${topic}`);

  const generated = await generateArticleWithGemini(category, topic);
  console.log(`  Title: ${generated.title}`);
  console.log(`  Author: ${generated.author}`);

  const image = await getUnsplashImage(`${category.name} ${generated.title.split(' ').slice(0, 3).join(' ')}`);
  console.log(`  Image: ${image.url ? 'Found' : 'None'}`);

  const today = new Date().toISOString().split('T')[0];

  return {
    id: createId(category.id),
    category: category.id,
    title: generated.title,
    summary: generated.summary,
    content: generated.content,
    author: generated.author,
    date: today,
    image: image.url,
    imageAlt: image.alt,
    tags: [category.id],
    featured: Math.random() > 0.5
  };
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
      const article = await generateOneArticle(category);
      newArticles.push(article);
      await new Promise(r => setTimeout(r, 1800));
    } catch (err) {
      console.error(`✗ Failed for ${category.name}:`, err.message);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles were generated.');
    process.exit(0);
  }

  data.articles = [...newArticles, ...data.articles].slice(0, 60);
  saveArticles(data);

  console.log('\n========================================');
  console.log(`✅ Successfully added ${newArticles.length} new articles`);
  console.log('Total articles now:', data.articles.length);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
