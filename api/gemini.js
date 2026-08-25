const MAX_SHARED_TEXT_LENGTH = 10_000;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 4_000_000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_POSTER_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestLog = new Map();

function isRateLimited(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function readUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch (_) {
    return null;
  }
}

function isInstagramUrl(url) {
  return url && (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'));
}

async function readLimited(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Remote resource is too large');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('Remote resource is too large');
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Remote resource is too large');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
  }
  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  let extractedImageDataUrl = null;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    validatePayload(body);
    const today = new Date().toISOString().slice(0, 10);

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;

      let enrichedText = sharedUrlStr;

      // If it's a URL, fetch OG meta tags server-side
      const sharedUrl = readUrl(sharedUrlStr);
      if (isInstagramUrl(sharedUrl)) {
        try {
          const pageRes = await fetch(sharedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'text/html',
              'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(5000)
          });
          if (!pageRes.ok || !pageRes.headers.get('content-type')?.includes('text/html')) throw new Error('Instagram page could not be read');
          const html = new TextDecoder().decode(await readLimited(pageRes, MAX_PAGE_BYTES));

          const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) || [])[1] || '';
          const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) || [])[1] || '';
          const pageTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
          let ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || '';
          ogImage = ogImage.replace(/&amp;/g, '&');

          enrichedText = [ogTitle, ogDesc, pageTitle, sharedUrlStr].filter(Boolean).join(' | ');

          // Fetch the poster image and convert to base64
          if (ogImage) {
            try {
              const imageUrl = readUrl(ogImage);
              if (!imageUrl) throw new Error('Invalid poster URL');
              const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
              const imgMime = imgRes.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
              if (!imgRes.ok || !/^image\/(jpeg|png|webp)$/i.test(imgMime)) throw new Error('Poster is not a supported image');
              const imgBuf = await readLimited(imgRes, MAX_POSTER_BYTES);
              const imgB64 = Buffer.from(imgBuf).toString('base64');
              extractedImageDataUrl = `data:${imgMime};base64,${imgB64}`;
            } catch (_) { /* image fetch failed, skip */ }
          }
        } catch (fetchErr) {
          // Page fetch failed — fall back to raw text
          enrichedText = sharedUrlStr;
        }
      }

      const parts = [{
        text: `Today's date is ${today}. A user shared this Instagram event post. Here is all the available text from it: "${enrichedText}".
This is a music/entertainment event in Portugal. Extract the event details.

{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of artists/lineup, or a short note if lineup not found. No markdown."}

If the year is not mentioned, assume the next upcoming occurrence after today (${today}). For Portuguese month names: janeiro=01, fevereiro=02, março=03, abril=04, maio=05, junho=06, julho=07, agosto=08, setembro=09, outubro=10, novembro=11, dezembro=12.`
      }];
      body.contents = [{ parts }];

    } else if (body.contents?.[0]?.parts?.[0]) {
      body.contents[0].parts[0].text = `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object (no markdown) in this exact shape:
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of artists/lineup, or a short note if lineup not found. No markdown."}
If the year isn't shown, assume the next upcoming occurrence after today (${today}).`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (extractedImageDataUrl) data._extractedImage = extractedImageDataUrl;
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
