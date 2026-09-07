const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n🚀 Running: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname });
  } catch (err) {
    console.error(`⚠️ Command failed: ${cmd}`);
  }
}

console.log('=== DEPLOYING TO ANDROID, GIT & VERCEL ===');

// 1. Generate / Copy assets to www/
console.log('\n1. Syncing assets to www/...');
const filesToCopy = [
  'index.html',
  'manifest.json',
  'sw.js',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'widget.html',
  'widget-calendar.html',
  'capacitor.config.json'
];

const wwwDir = path.join(__dirname, 'www');
if (!fs.existsSync(wwwDir)) {
  fs.mkdirSync(wwwDir, { recursive: true });
}

for (const file of filesToCopy) {
  const src = path.join(__dirname, file);
  const dest = path.join(wwwDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ Copied ${file} -> www/${file}`);
  }
}

// 2. Sync Android
console.log('\n2. Syncing to Android...');
run('npx cap copy android');

// 3. Git commit & push
console.log('\n3. Pushing to Git...');
const commitMsg = process.argv[2] || 'Feat: Update app, icons and widgets';
run('git add -A');
try {
  run(`git commit -m "${commitMsg}"`);
} catch (e) {
  console.log('No new git changes to commit.');
}
run('git push origin main');

// 4. Vercel deploy
console.log('\n4. Deploying to Vercel...');
run('npx vercel --prod --yes');

console.log('\n✅ DEPLOYMENT COMPLETE! All 3 targets updated (Android, Git, Vercel).');
