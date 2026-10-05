const MAX_SHARED_TEXT_LENGTH = 10_000;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 4_000_000;
const MAX_POSTER_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestLog = new Map();

// Public Firebase web API key (same as js/config.js); only used to validate sign-in tokens
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDaP-4tCRmwXrdo4l3zAJIz257TG9s_15A';
const TOKEN_CACHE_MS = 5 * 60_000;
const verifiedTokens = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const recent = (requestLog.get(userId) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(userId, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

// Resolves to the signed-in Firebase user ({ uid, email }) or null
async function verifyFirebaseUser(req) {
  const header = req.headers.authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!idToken) return null;

  const cached = verifiedTokens.get(idToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const account = (await response.json())?.users?.[0];
    if (!account?.localId) return null;

    const user = { uid: account.localId, email: (account.email || '').toLowerCase() };
    verifiedTokens.set(idToken, { user, expiresAt: Date.now() + TOKEN_CACHE_MS });
    return user;
  } catch (_) {
    return null;
  }
}

// Optional allow-list: set ALLOWED_EMAILS in Vercel (comma-separated) to restrict who can use the endpoint
function isEmailAllowed(email) {
  const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(email);
}

function extractInstagramUrl(sharedText) {
  if (!sharedText) return null;
  const match = sharedText.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|share\/p)\/[\w.-]+/i);
  return match ? match[0] : null;
}

async function scrapeInstagramMetadata(sharedText) {
  let enrichedText = sharedText;
  let posterImageDataUrl = null;

  const instaUrl = extractInstagramUrl(sharedText);
  if (!instaUrl) return { enrichedText, posterImageDataUrl };

  const matchCode = instaUrl.match(/(?:p|reel|reels|tv|share\/p)\/([\w.-]+)/i);
  const code = matchCode ? matchCode[1] : null;

  if (code) {
    const cleanUrl = `https://www.instagram.com/p/${code}/`;
    const targetUrls = [
      `https://api.instagram.com/oembed/?url=${encodeURIComponent(cleanUrl)}`,
      `https://ddinstagram.com/p/${code}`
    ];

    try {
      const results = await Promise.allSettled(
        targetUrls.map(async fetchUrl => {
          const isJsonApi = fetchUrl.includes('api.instagram.com');
          const res = await fetch(fetchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
              'Accept': isJsonApi ? 'application/json' : 'text/html'
            },
            signal: AbortSignal.timeout(1200)
          });
          if (!res.ok) return null;

          if (isJsonApi) {
            const oembedData = await res.json();
            return {
              text: [oembedData.author_name ? `Post by @${oembedData.author_name}` : '', oembedData.title, sharedText].filter(Boolean).join(' | '),
              img: oembedData.thumbnail_url || null
            };
          } else {
            const html = await res.text();
            const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            let imgUrl = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            return {
              text: [ogTitle, ogDesc, sharedText].filter(Boolean).join(' | '),
              img: imgUrl ? imgUrl.replace(/&amp;/g, '&') : null
            };
          }
        })
      );

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) {
          if (res.value.text && enrichedText === sharedText) enrichedText = res.value.text;
          if (res.value.img && !posterImageDataUrl) posterImageDataUrl = res.value.img;
        }
      }
    } catch (_) {}
  }

  return { enrichedText, posterImageDataUrl };
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') throw new Error('A JSON request body is required');
  if (body.sharedUrl && (typeof body.sharedUrl !== 'string' || body.sharedUrl.length > MAX_SHARED_TEXT_LENGTH)) {
    throw new Error('Shared text is invalid or too long');
  }
  const inlineData = body.contents?.[0]?.parts?.find(part => part.inlineData)?.inlineData;
  if (inlineData) {
    if (!/^image\/(jpeg|png|webp)$/i.test(inlineData.mimeType || '') || typeof inlineData.data !== 'string' || inlineData.data.length > MAX_INLINE_IMAGE_BASE64_LENGTH) {
      throw new Error('Use a JPEG, PNG, or WebP image smaller than 3 MB');
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
  }

  const user = await verifyFirebaseUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in with Google to import events automatically.' });
  }
  if (!isEmailAllowed(user.email)) {
    return res.status(403).json({ error: 'This account is not allowed to import events automatically.' });
  }
  if (isRateLimited(user.uid)) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  let extractedImageDataUrl = null;

  try {
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    validatePayload(input);
    const today = new Date().toISOString().slice(0, 10);

    // The Gemini request is always built here; nothing else from the client is forwarded
    const body = {};

    if (input.sharedUrl) {
      const sharedUrlStr = input.sharedUrl;

      const { enrichedText, posterImageDataUrl } = await scrapeInstagramMetadata(sharedUrlStr);
      if (posterImageDataUrl) extractedImageDataUrl = posterImageDataUrl;

      const parts = [];
      if (posterImageDataUrl && posterImageDataUrl.startsWith('data:image')) {
        const [meta, base64Data] = posterImageDataUrl.split(',');
        const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        parts.push({
          inlineData: { mimeType, data: base64Data }
        });
      }

      parts.push({
        text: `Today's date is ${today}. A user shared this Instagram event post link or caption: "${enrichedText}".
Extract the music/event details in Portugal.

Respond ONLY with a JSON object in this exact shape (no markdown):
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of extra artists/lineup, or an empty string '' if no extra notes or lineup are found. Do NOT write generic placeholder text."}

If the year is not mentioned, assume the next upcoming occurrence after today (${today}).`
      });

      body.contents = [{ parts }];

    } else {
      const inlineData = input.contents?.[0]?.parts?.find(part => part.inlineData)?.inlineData;
      if (!inlineData) {
        return res.status(400).json({ error: 'Send an image or a shared link.' });
      }
      body.contents = [{
        parts: [
          {
            text: `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object (no markdown) in this exact shape:
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of extra artists/lineup, or an empty string '' if no extra notes or lineup are found. Do NOT write generic placeholder text."}
If the year isn't shown, assume the next upcoming occurrence after today (${today}).`
          },
          { inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } }
        ]
      }];
    }

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
    let data = null;
    let lastErr = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        });

        const resData = await response.json();
        if (response.ok && resData?.candidates?.[0]?.content) {
          data = resData;
          break;
        } else {
          lastErr = resData?.error?.message || `HTTP ${response.status}`;
        }
      } catch (err) {
        lastErr = err.message;
      }
    }

    if (!data) {
      if (lastErr && (lastErr.includes('API key') || lastErr.includes('not found') || lastErr.includes('PERMISSION_DENIED') || lastErr.includes('403'))) {
        return res.status(400).json({
          error: `The Gemini API key in Vercel (GEMINI_API_KEY) needs to be updated. Obtain a new free key at https://aistudio.google.com/app/apikey and update the GEMINI_API_KEY variable in Vercel settings.`
        });
      }
      return res.status(503).json({ error: `Gemini API Error: ${lastErr || 'Service Unavailable'}` });
    }

    if (extractedImageDataUrl) data._extractedImage = extractedImageDataUrl;
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
