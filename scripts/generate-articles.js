/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Groq + Unsplash + GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY secret');
  process.exit(1);
}

const CATEGORIES = [
  { id: 'news', name: 'Global News' },
  { id: 'sports', name: 'Sports' },
  { id: 'health', name: 'Health' },
  { id: 'finance', name: 'Finance' }
];

const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  }
  return JSON.parse(text);
}

function getTopic(category) {
  const topics = {
    news: [
      'international diplomacy development',
      'climate policy or environment news',
      'global technology regulation',
      'major world summit or agreement'
    ],
    sports: [
      'major tournament or match result',
      'athlete record or standout performance',
      'world championship update',
      'sports underdog or surprising victory'
    ],
    health: [
      'new medical research or study',
      'vaccine or treatment development',
      'public health recommendation',
      'wellness or lifestyle finding'
    ],
    finance: [
      'central bank or interest rate decision',
      'stock market or economic movement',
      'cryptocurrency regulation update',
      'retirement or personal finance trend'
    ]
  };
  const list = topics[category.id];
  return list[Math.floor(Math.random() * list.length)];
}

async function generateArticle(category, topic) {
  const prompt = `You are a professional journalist for the magazine MeridianMatters.

Write a short news article about: ${topic}
Category: ${category.name}

Return ONLY a valid JSON object with these exact keys and nothing else:
{
  "title": "catchy headline max 12 words",
  "summary": "one or two sentences max 35 words",
  "content": "two short paragraphs, informative and neutral",
  "author": "realistic journalist name"
}`;

  console.log('  Calling Groq...');

  const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You always reply with pure valid JSON only. No markdown, no explanation.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 600,
      response_format: { type: 'json_object' }
    })
  });

  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response from Groq');

  let cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');

  const parsed = JSON.parse(cleaned.substring(start, end + 1));

  if (!parsed.title || !parsed.summary || !parsed.content || !parsed.author) {
    throw new Error('Missing required fields');
  }

  return parsed;
}

async function getImage(query) {
  if (!UNSPLASH_ACCESS_KEY) return { url: '', alt: query };

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });
    const photo = (data.results || [])[0];
    if (!photo) return { url: '', alt: query };
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
    return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch {
    return { lastUpdated: new Date().toISOString(), articles: [] };
  }
}

function saveArticles(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
  console.log('  Saved articles.json');
}

async function main() {
  console.log('========================================');
  console.log('MeridianMatters Article Generator (Groq)');
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
      console.log(`  Author: ${generated.author}`);

      const image = await getImage(`${category.name} ${generated.title.split(' ').slice(0, 3).join(' ')}`);
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

      // Small delay between requests
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.error(`✗ Failed for ${category.name}: ${err.message}`);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles were generated.');
    return;
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
