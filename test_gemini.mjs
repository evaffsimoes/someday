async function testModel(model) {
  const url = `https://someday-nu.vercel.app/api/gemini`;
  console.log(`Testing API via Vercel for model configuration...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sharedUrl: 'https://www.instagram.com/p/C7X3xZ4oX_X/'
    })
  });
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testModel();
