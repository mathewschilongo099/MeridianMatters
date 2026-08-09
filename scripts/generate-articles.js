/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Groq + Unsplash + GitHub Actions
 * Articles must be minimum 1000 words
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  return JSON.parse(text);
}

function getTopic(category) {
  const topics = {
    news: [
      'international diplomacy development',
      'climate policy or environment news',
      'global technology regulation',
      'major world summit or agreement',
      'geopolitical tension or peace process'
    ],
    sports: [
      'major tournament or match result',
      'athlete record or standout performance',
      'world championship update',
      'sports underdog or surprising victory',
      'transfer news or coaching change'
    ],
    health: [
      'new medical research or study',
      'vaccine or treatment development',
      'public health recommendation',
      'wellness or lifestyle finding',
      'mental health breakthrough'
    ],
    finance: [
      'central bank or interest rate decision',
      'stock market or economic movement',
      'cryptocurrency regulation update',
      'retirement or personal finance trend',
      'major company earnings report'
    ]
  };
  const list = topics[category.id];
  return list[Math.floor(Math.random() * list.length)];
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

async function generateArticle(category, topic) {
  const prompt = `You are a senior professional journalist writing for the high-quality online magazine MeridianMatters.

Write a full, in-depth news article about: ${topic}
Category: ${category.name}

STRICT REQUIREMENTS:
- title: Catchy professional headline (maximum 14 words)
- summary: 1-2 sentences (maximum 45 words) that work as a teaser
- content: A complete long-form article of AT LEAST 1000 words. Write 8 to 12 well-developed paragraphs. Make it informative, neutral, professional, and detailed. Include context, implications, expert-style analysis, and background. Do not write short paragraphs.
- author: A realistic journalist name (example: "A. Rivera", "Dr. L. Chen", "M. Torres")

The content field must contain at least 1000 words. This is mandatory.

Return ONLY valid JSON with exactly these keys: title, summary, content, author.
Do not wrap the JSON in markdown. Do not add any text outside the JSON object.`;

  console.log('  Calling Groq (long article mode)...');

  const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a professional journalist. You only output valid JSON. Never use markdown code fences. Always write long, detailed articles when requested.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4500,
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

  const wordCount = countWords(parsed.content);
  console.log(`  Word count: ${wordCount}`);

  if (wordCount < 800) {
    console.warn('  Warning: Article is shorter than requested (target 1000+ words)');
  }

  return parsed;
}

async function getImage(query) {
  if (!UNSPLASH_ACCESS_KEY) return { url: '', alt: query };
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });
    const results = data.results || [];
    if (results.length === 0) return { url: '', alt: query };
    const photo = results[Math.floor(Math.random() * Math.min(4, results.length))];
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
  console.log('MeridianMatters Article Generator');
  console.log('Mode: Long-form (target 1000+ words)');
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

      const image = await getImage(`${category.name} ${generated.title.split(' ').slice(0, 4).join(' ')}`);
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
        featured: Math.random() > 0.45
      });

      // Longer delay because we are generating big articles
      await new Promise(r => setTimeout(r, 2500));
    } catch (err) {
      console.error(`✗ Failed for ${category.name}: ${err.message}`);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles were generated.');
    return;
  }

  data.articles = [...newArticles, ...data.articles].slice(0, 50);
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
