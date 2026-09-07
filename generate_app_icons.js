const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Define SVG with cue + ✦ gem (clean, no circle glow background behind star)
const svgContent = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <!-- Clean dark squircle background -->
  <rect width="512" height="512" rx="112" fill="#000000"/>
  
  <!-- Logo Group -->
  <g>
    <!-- "cue" text -->
    <text x="95" y="310" 
          font-family="Outfit, Inter, 'Helvetica Neue', Arial, sans-serif" 
          font-weight="800" 
          font-size="165" 
          letter-spacing="-10" 
          fill="#f5f5f5">cue</text>

    <!-- Pure Star Gem ✦ with exact #a855f7 color (no circle behind) -->
    <path d="M 398,175 Q 398,215 438,215 Q 398,215 398,255 Q 398,215 358,215 Q 398,215 398,175 Z" fill="#a855f7"/>
  </g>
</svg>
`;

async function generate() {
  const svgBuffer = Buffer.from(svgContent);

  // 1. Generate root icons
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(__dirname, 'icon-512.png'));
  await sharp(svgBuffer).resize(192, 192).png().toFile(path.join(__dirname, 'icon-192.png'));
  await sharp(svgBuffer).resize(64, 64).toFile(path.join(__dirname, 'favicon.ico'));

  // 2. Generate www icons
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(__dirname, 'www', 'icon-512.png'));
  await sharp(svgBuffer).resize(192, 192).png().toFile(path.join(__dirname, 'www', 'icon-192.png'));
  await sharp(svgBuffer).resize(64, 64).toFile(path.join(__dirname, 'www', 'favicon.ico'));

  // 3. Update Android mipmap icons
  const resDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
  const mipmapFolders = [
    { name: 'mipmap-mdpi', size: 48 },
    { name: 'mipmap-hdpi', size: 72 },
    { name: 'mipmap-xhdpi', size: 96 },
    { name: 'mipmap-xxhdpi', size: 144 },
    { name: 'mipmap-xxxhdpi', size: 192 }
  ];

  for (const folder of mipmapFolders) {
    const targetDir = path.join(resDir, folder.name);
    if (fs.existsSync(targetDir)) {
      await sharp(svgBuffer).resize(folder.size, folder.size).png().toFile(path.join(targetDir, 'ic_launcher.png'));
      await sharp(svgBuffer).resize(folder.size, folder.size).png().toFile(path.join(targetDir, 'ic_launcher_round.png'));
      await sharp(svgBuffer).resize(folder.size, folder.size).png().toFile(path.join(targetDir, 'ic_launcher_foreground.png'));
    }
  }
  console.log('App icons updated successfully without background circle glow.');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
