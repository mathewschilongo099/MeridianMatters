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
  { id: 'news', name: 'Global News', query: 'world news OR international affairs OR geopolitics' },
  { id: 'sports', name: 'Sports', query: 'sports OR football OR basketball OR tennis OR athletics' },
  { id: 'health', name: 'Health', query: 'health OR medicine OR medical research OR wellness' },
  { id: 'finance', name: 'Finance', query: 'finance OR economy OR markets OR stocks OR business' }
];

const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');

// Use a currently available free model
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
  const prompt = `You are a professional journalist writing for a high-quality online magazine called MeridianMatters.

Write a realistic, professional news-style article about this topic in the ${category.name} category:
Topic idea: ${topic}

Requirements:
- Catchy, professional headline (maximum 12 words)
- Short summary (1-2 sentences, maximum 40 words)
- Full article body (3-5 short paragraphs, informative, neutral and professional tone)
- Author name (invent a realistic journalist name like "A. Rivera" or "Dr. L. Chen")

Return ONLY valid JSON in this exact format. Do not wrap it in markdown or add any extra text:
{
  "title": "Your headline here",
  "summary": "Your short summary here",
  "content": "Full article text here with paragraphs separated by newlines",
  "author": "Author Name"
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  console.log(`  Calling Gemini (${GEMINI_MODEL})...`);

  const data = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1200
      }
    })
  });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    console.error('  Gemini returned empty response:', JSON.stringify(data).substring(0, 300));
    throw new Error('Empty response from Gemini');
  }

  // Clean possible markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Sometimes the model adds extra text before/after JSON
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.title || !parsed.summary || !parsed.content || !parsed.author) {
      throw new Error('Missing required fields in JSON');
    }
    return parsed;
  } catch (e) {
    console.error('  Failed to parse Gemini JSON. Raw text:', cleaned.substring(0, 400));
    throw new Error('Invalid JSON from Gemini: ' + e.message);
  }
}

async function getUnsplashImage(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`;

  console.log(`  Searching Unsplash for: ${query}`);

  try {
    const data = await fetchJSON(url, {
      headers: {
        Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    });

    const results = data.results || [];
    if (results.length === 0) {
      console.log('  No Unsplash results found');
      return { url: '', alt: query };
    }

    const photo = results[Math.floor(Math.random() * Math.min(results.length, 5))];
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
  console.log('  Saved articles.json');
}

function createId(category) {
  const ts = Date.now().toString(36);
  return `${category}-${ts}`;
}

async function generateOneArticle(category) {
  console.log(`\n→ Generating article for: ${category.name}`);

  const topic = await getTrendingTopic(category);
  console.log(`  Topic seed: ${topic}`);

  const generated = await generateArticleWithGemini(category, topic);
  console.log(`  Title: ${generated.title}`);
  console.log(`  Author: ${generated.author}`);

  const imageQuery = `${category.name} ${generated.title.split(' ').slice(0, 4).join(' ')}`;
  const image = await getUnsplashImage(imageQuery);
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
    featured: Math.random() > 0.55
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
      // Be nice to free API rate limits
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`✗ Failed for ${category.name}:`, err.message);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles were generated.');
    process.exit(0);
  }

  // Newest first, keep last 60 articles
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
