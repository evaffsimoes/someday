/**
 * cue — Gemini AI Helper Integration
 */

function getApiEndpoint() {
  if (window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
    return 'https://someday-nu.vercel.app/api/gemini';
  }
  return '/api/gemini';
}

function parseGeminiJson(text) {
  if (!text) return {};
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (error) {}
  }
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (error) {
    return {};
  }
}