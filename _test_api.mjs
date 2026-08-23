fetch('https://someday-nu.vercel.app/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sharedUrl: 'https://www.instagram.com/p/DbTdIMNIv8r/?igsi=MXFlOHMxbjRqNjQ3MA==' })
}).then(r => r.json()).then(data => {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('RESULT:', text);
}).catch(e => console.error('ERROR:', e.message));
