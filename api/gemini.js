export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const today = new Date().toISOString().slice(0, 10);

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;

      // If it's a URL, try to fetch its OG/meta tags server-side
      let enrichedText = sharedUrlStr;
      let extractedImageDataUrl = null;
      if (sharedUrlStr.startsWith('http')) {
        try {
          const pageRes = await fetch(sharedUrlStr, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'text/html',
              'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(5000)
          });
          const html = await pageRes.text();
          // Extract OG title, description, and any visible text content
          const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) || [])[1] || '';
          const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) || [])[1] || '';
          const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
          const ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || '';
          enrichedText = [ogTitle, ogDesc, title, sharedUrlStr].filter(Boolean).join(' | ');

          // Fetch the image and convert to base64 so it can be stored offline
          if (ogImage) {
            try {
              const imgRes = await fetch(ogImage, { signal: AbortSignal.timeout(5000) });
              const imgBuf = await imgRes.arrayBuffer();
              const imgB64 = Buffer.from(imgBuf).toString('base64');
              const imgMime = imgRes.headers.get('content-type') || 'image/jpeg';
              extractedImageDataUrl = `data:${imgMime};base64,${imgB64}`;
            } catch (_) { }
          }
        } catch (fetchErr) {
          // If fetch fails, fall back to using the raw URL string
          enrichedText = sharedUrlStr;
        }
      }

      const parts = [
        {
          text: `Today's date is ${today}. A user shared this Instagram event post. Here is all the available text from it: "${enrichedText}".
This is a music/entertainment event in Portugal. Extract the event details.

Respond ONLY with a JSON object in this exact shape (no markdown, no extra text):
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "short 1-sentence note or empty string"}

If the year is not mentioned, assume the next upcoming occurrence after today (${today}). For Portuguese month names: janeiro=01, fevereiro=02, março=03, abril=04, maio=05, junho=06, julho=07, agosto=08, setembro=09, outubro=10, novembro=11, dezembro=12.`
        }
      ];
      body.contents = [{ parts }];

    } else if (body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]) {
      body.contents[0].parts[0].text = `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object (no markdown) in this exact shape:
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "short 1-sentence note or empty string"}
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
