const MAX_SHARED_TEXT_LENGTH = 10_000;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 4_000_000;
const MAX_POSTER_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestLog = new Map();

function isRateLimited(event) {
  const forwarded = event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || 'unknown';
  const ip = forwarded.split(',')[0].trim();
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function extractInstagramUrl(sharedText) {
  if (!sharedText) return null;
  const match = sharedText.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/i);
  return match ? match[0] : null;
}

async function scrapeInstagramMetadata(sharedText) {
  let enrichedText = sharedText;
  let posterImageDataUrl = null;

  const instaUrl = extractInstagramUrl(sharedText);
  if (!instaUrl) return { enrichedText, posterImageDataUrl };

  const matchCode = instaUrl.match(/(?:p|reel|tv)\/([\w-]+)/i);
  const code = matchCode ? matchCode[1] : null;

  if (code) {
    // 1. Try Instagram official embed captioned page (unauthenticated public HTML)
    const embedUrl = `https://www.instagram.com/p/${code}/embed/captioned/`;
    try {
      const res = await fetch(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const html = await res.text();
        const captionMatch = html.match(/<div[^>]*class=["']Caption["'][^>]*>(.*?)<\/div>/s) || html.match(/<div[^>]*class=["']CaptionText["'][^>]*>(.*?)<\/div>/s);
        let captionText = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        const titleMatch = html.match(/<div[^>]*class=["']Header["'][^>]*>(.*?)<\/div>/s);
        let headerText = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        const imgMatch = html.match(/<img[^>]*class=["']EmbeddedMediaImage["'][^>]*src=["']([^"']+)["']/i) || html.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["']EmbeddedMediaImage["']/i);
        let imgUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

        if (captionText || headerText) {
          enrichedText = [headerText, captionText, sharedText].filter(Boolean).join(' | ');
        }

        if (imgUrl) {
          try {
            const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
            if (imgRes.ok) {
              const mime = imgRes.headers.get('content-type')?.split(';')[0].toLowerCase() || 'image/jpeg';
              const buf = Buffer.from(await imgRes.arrayBuffer());
              if (buf.byteLength <= MAX_POSTER_BYTES) {
                posterImageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
              }
            }
          } catch (_) {}
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
  if (inlineData && (!/^image\/(jpeg|png|webp)$/i.test(inlineData.mimeType || '') || typeof inlineData.data !== 'string' || inlineData.data.length > MAX_INLINE_IMAGE_BASE64_LENGTH)) {
    throw new Error('Use a JPEG, PNG, or WebP image smaller than 3 MB');
  }
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY is missing' })
    };
  }
  if (isRateLimited(event)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Too many requests. Please try again in a minute.' })
    };
  }

  let extractedImageDataUrl = null;

  try {
    const body = JSON.parse(event.body);
    validatePayload(body);
    const today = new Date().toISOString().slice(0, 10);

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;

      const { enrichedText, posterImageDataUrl } = await scrapeInstagramMetadata(sharedUrlStr);
      if (posterImageDataUrl) extractedImageDataUrl = posterImageDataUrl;

      const parts = [];
      if (posterImageDataUrl) {
        const [meta, base64Data] = posterImageDataUrl.split(',');
        const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        parts.push({ inlineData: { mimeType, data: base64Data } });
      }

      parts.push({
        text: `Today's date is ${today}. A user shared this Instagram event post link or caption: "${enrichedText}".
Extract the music/event details in Portugal.
Respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Party" or "Other", "description": string (short 1-sentence note)}.`
      });

      body.contents = [{ parts }];
    } else if (body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]) {
      body.contents[0].parts[0].text = `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "location": string, "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Party" or "Other", "description": "short 1-sentence note"}. If the year isn't shown, assume the next upcoming occurrence after today.`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (extractedImageDataUrl) data._extractedImage = extractedImageDataUrl;

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
