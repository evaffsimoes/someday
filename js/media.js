/**
 * cue — Image handling: reading files, compressing uploads and keeping stored posters small.
 */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  if (!file?.type?.match(/^image\/(jpeg|png|webp|heic|heif)$/i) && !file?.name?.match(/\.(jpe?g|png|webp|heic|heif)$/i)) {
    throw new Error('Please choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('That image is too large. Please choose one under 12 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Failed to load image file.'));
      image.src = objectUrl;
    });

    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

    const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!compressed) throw new Error('Could not process that image.');

    const base64 = await fileToBase64(compressed);
    return { base64, mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  const hue = t => {
    t = (t + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255));
}

// Picks the most vivid colour in a poster and tunes it so it always reads as a glow on the
// dark UI (no washed-out yellows or invisible near-blacks). Resolves to "r, g, b", or ''
// when the image can't be read (e.g. a cross-origin URL) or has no real colour.
async function extractPosterColor(src) {
  if (!src) return '';
  try {
    const image = new Image();
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = src;
    });

    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Hue histogram weighted by saturation; greys, blacks and whites don't count
    const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.25 || l < 0.1 || l > 0.92) continue;
      const weight = s * (1 - Math.abs(l - 0.5));
      const bin = bins[Math.floor(h * 24) % 24];
      bin.weight += weight;
      bin.r += data[i] * weight;
      bin.g += data[i + 1] * weight;
      bin.b += data[i + 2] * weight;
    }
    const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
    if (best.weight < 1) return '';

    const [h, s, l] = rgbToHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight);
    const [r, g, b] = hslToRgb(h, Math.min(0.9, Math.max(0.55, s)), Math.min(0.58, Math.max(0.45, l)));
    return `${r}, ${g}, ${b}`;
  } catch (error) {
    return '';
  }
}

// Lights the page with an event colour: --glow is the main tone, --glow2 a neighbouring hue
function applyGlow(rgb) {
  const [r, g, b] = String(rgb || CATEGORY_COLORS.Concert).split(',').map(Number);
  const [h, s, l] = rgbToHsl(r, g, b);
  const second = hslToRgb((h + 0.1) % 1, s, l);
  const root = document.documentElement.style;
  root.setProperty('--glow', `${r}, ${g}, ${b}`);
  root.setProperty('--glow2', second.join(', '));
}

// Stored posters are kept small so events fit in device storage and cloud sync
const POSTER_MAX_DIMENSION = 800;
const POSTER_QUALITY = 0.72;
const POSTER_MAX_CHARS = 200 * 1024;

async function shrinkImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length <= POSTER_MAX_CHARS) {
    return dataUrl;
  }
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = dataUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, POSTER_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const shrunk = canvas.toDataURL('image/jpeg', POSTER_QUALITY);
    return shrunk.length < dataUrl.length ? shrunk : dataUrl;
  } catch (error) {
    return dataUrl;
  }
}

// Shrinks oversized posters in place; resolves to true when any event changed
async function shrinkEventImages(events) {
  let changed = false;
  for (const event of events || []) {
    const shrunk = await shrinkImageDataUrl(event.image);
    if (shrunk !== event.image) {
      event.image = shrunk;
      changed = true;
    }
  }
  return changed;
}
