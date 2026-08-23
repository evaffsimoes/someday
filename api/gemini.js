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

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;
      const parts = [
        { text: `Today's date is ${new Date().toISOString().slice(0,10)}. A user shared this event post link or caption from Instagram: "${sharedUrlStr}".
Extract the music/event details. The events are primarily music concerts, festivals, or parties in Portugal.

Respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Other", "description": string (short 1-sentence note)}.` }
      ];
      body.contents = [{ parts }];
    } else if (body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]) {
      body.contents[0].parts[0].text = `Today's date is ${new Date().toISOString().slice(0,10)}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Other", "description": string (short 1-sentence note)}. If the year isn't shown, assume the next upcoming occurrence after today.`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
