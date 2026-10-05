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
