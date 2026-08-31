const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const regex = /<script(?:\s[^>]*?)?>([\s\S]*?)<\/script>/gi;
let match;
while ((match = regex.exec(content)) !== null) {
    try {
        new Function(match[1]);
        console.log('Script block Syntax OK');
    } catch (e) {
        console.error('Syntax Error in block:', e);
    }
}
