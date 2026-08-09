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

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function getTrendingTopic(category) {
  // Simple free approach: use a curated list of trending-style prompts
  // + current date for freshness. In production you can expand with RSS.
  const topics = {
    news: [
      'latest major international diplomatic development',
      'global climate or environment policy update',
      'significant geopolitical event this week',
      'technology regulation or digital privacy news'
    ],
    sports: [
      'major football or soccer tournament result',
      'notable athlete performance or injury update',
      'Olympic or world championship news',
      'surprising sports underdog victory'
    ],
    health: [
      'new medical research or vaccine development',
      'public health recommendation or study',
      'mental health or wellness breakthrough',
      'nutrition or lifestyle science finding'
    ],
    finance: [
      'stock market or central bank decision',
      'cryptocurrency or fintech regulation',
      'personal finance or retirement trend',
      'global economic indicator update'
    ]
  };

  const list = topics[category.id] || topics.news;
  const topic = list[Math.floor(Math.random() * list.length)];
  return topic;
}

async function generateArticleWithGemini(category, topic) {
  const prompt = `You are a professional journalist writing for a high-quality online magazine called MeridianMatters.

Write a realistic, professional news article about this topic in the ${category.name} category:
Topic: ${topic}

Requirements:
- Catchy, professional headline (max 12 words)
- Short summary (1-2 sentences, max 40 words)
- Full article body (3-5 paragraphs, informative and neutral tone)
- Author name (invent a realistic journalist name)
- Use current real-world knowledge up to your training data, make it feel timely

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "title": "...",
  "summary": "...",
  "content": "...",
  "author": "..."
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const data = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 1024
      }
    })
  });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Clean possible markdown code fences
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse Gemini response:', cleaned.substring(0, 300));
    throw new Error('Invalid JSON from Gemini');
  }
}

async function getUnsplashImage(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;

  const data = await fetchJSON(url, {
    headers: {
      Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`
    }
  });

  const results = data.results || [];
  if (results.length === 0) return { url: '', alt: query };

  const photo = results[Math.floor(Math.random() * results.length)];
  return {
    url: photo.urls?.regular || photo.urls?.small || '',
    alt: photo.alt_description || query
  };
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
}

function createId(category) {
  const ts = Date.now().toString(36);
  return `${category}-${ts}`;
}

async function generateOneArticle(category) {
  console.log(`\n→ Generating article for: ${category.name}`);

  const topic = await getTrendingTopic(category);
  console.log(`  Topic: ${topic}`);

  const generated = await generateArticleWithGemini(category, topic);
  console.log(`  Title: ${generated.title}`);

  const image = await getUnsplashImage(`${category.name} ${generated.title}`);
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
    featured: Math.random() > 0.6
  };
}

async function main() {
  console.log('Starting MeridianMatters article generation...');
  console.log('Time:', new Date().toISOString());

  const data = loadArticles();
  const newArticles = [];

  // Generate 1 article per category (total 4 per run)
  // Running twice a day ≈ 8 articles/day
  for (const category of CATEGORIES) {
    try {
      const article = await generateOneArticle(category);
      newArticles.push(article);
      // Small delay to be kind to free APIs
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`Failed for ${category.name}:`, err.message);
    }
  }

  if (newArticles.length === 0) {
    console.log('No new articles generated.');
    return;
  }

  // Prepend new articles and keep a reasonable history (last 60)
  data.articles = [...newArticles, ...data.articles].slice(0, 60);
  saveArticles(data);

  console.log(`\n✅ Successfully added ${newArticles.length} new articles.`);
  console.log('Total articles now:', data.articles.length);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
