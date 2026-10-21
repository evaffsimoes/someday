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

// Instagram serves a post's caption and image (Open Graph tags) to link-preview crawlers without a
// login, so the post is read the way a chat app builds its link preview.
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SCRAPE_TIMEOUT_MS = 6000;

function extractInstagramUrl(sharedText) {
  if (!sharedText) return null;
  const match = sharedText.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function postCodeFrom(url) {
  const match = String(url).match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/i);
  return match ? match[1] : null;
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metaContent(html, property) {
  const match = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

async function fetchText(url, userAgent) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept': 'text/html', 'Accept-Language': 'en-GB,en;q=0.9,pt;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS)
  });
  return { ok: res.ok, url: res.url, html: res.ok ? await res.text() : '' };
}

// Downloads the poster so Gemini can read it and the app can keep it; null if too big or not an image
async function fetchImageAsDataUrl(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|webp)$/i.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_POSTER_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

// Resolves to { text, posterImageDataUrl, isInstagram, readable }
async function scrapeInstagramMetadata(sharedText) {
  const instaUrl = extractInstagramUrl(sharedText);
  if (!instaUrl) return { text: sharedText, posterImageDataUrl: null, isInstagram: false, readable: false };

  try {
    // Share links (instagram.com/share/...) redirect to the post; follow them to get its code
    let code = postCodeFrom(instaUrl);
    if (!code) code = postCodeFrom((await fetchText(instaUrl, PREVIEW_UA)).url);
    if (!code) return { text: sharedText, posterImageDataUrl: null, isInstagram: true, readable: false };

    let caption = '';
    let posted = '';
    let imageUrl = '';

    const page = await fetchText(`https://www.instagram.com/p/${code}/`, PREVIEW_UA);
    if (page.ok) {
      // og:description looks like: 21K likes, 363 comments - nos_alive on October 19, 2026: "caption"
      const description = metaContent(page.html, 'og:description');
      const header = description.match(/^(.*?)\s-\s([\w.]+) on ([^:]+):\s*/);
      if (header) posted = `Posted by @${header[2]} on ${header[3]}`;
      caption = (header ? description.slice(header[0].length) : description).trim().replace(/^"|"\.?$/g, '').trim();
      if (!caption) caption = metaContent(page.html, 'og:title').replace(/^.*? on Instagram:\s*/, '').replace(/^"|"$/g, '');
      imageUrl = metaContent(page.html, 'og:image');
    }

    // Fallback: the public embed page has the caption and image too
    if (!caption || !imageUrl) {
      const embed = await fetchText(`https://www.instagram.com/p/${code}/embed/captioned/`, BROWSER_UA);
      if (embed.ok) {
        if (!caption) {
          const block = embed.html.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i);
          if (block) caption = decodeEntities(block[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        }
        if (!imageUrl) {
          const img = embed.html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i);
          if (img) imageUrl = decodeEntities(img[1]);
        }
      }
    }

    const posterImageDataUrl = imageUrl ? await fetchImageAsDataUrl(imageUrl) : null;
    const text = [posted, caption ? `Caption: ${caption}` : '', `Link: ${instaUrl}`].filter(Boolean).join('\n');
    return { text, posterImageDataUrl, isInstagram: true, readable: !!(caption || posterImageDataUrl) };
  } catch (_) {
    return { text: sharedText, posterImageDataUrl: null, isInstagram: true, readable: false };
  }
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

      const post = await scrapeInstagramMetadata(sharedUrlStr);
      // Only a bare link to a post we couldn't open: don't let the model guess from the URL
      const onlyALink = sharedUrlStr.replace(/https?:\/\/\S+/g, '').trim().length < 3;
      if (post.isInstagram && !post.readable && onlyALink) {
        return res.status(422).json({ error: 'Couldn\'t open this Instagram post (it may be private). Share a screenshot of the poster instead.' });
      }
      const posterImageDataUrl = post.posterImageDataUrl;
      if (posterImageDataUrl) extractedImageDataUrl = posterImageDataUrl;

      const parts = [];
      if (posterImageDataUrl) {
        const [meta, base64Data] = posterImageDataUrl.split(',');
        const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        parts.push({
          inlineData: { mimeType, data: base64Data }
        });
      }

      parts.push({
        text: `Today's date is ${today}. A user shared an Instagram event post.${posterImageDataUrl ? ' The post image (usually the event poster) is attached: read dates, times, venue and lineup from it.' : ''}
Post details:
${post.text}

Extract the music/event details in Portugal. Use the date the post was published to work out the year when it isn't written.

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
