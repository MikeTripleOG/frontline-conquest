// Builds dist/frontline-conquest.html: one self-contained file (works from file:// too)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const js = ['mapdata.js', 'sim.js', 'render.js', 'main.js'].map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')
  .replace(/^import[^;]*;\s*$/mg, '').replace(/^export (?=(const|function|class|let)\b)/mg, '')).join('\n');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
  .replace('<link rel="manifest" href="manifest.webmanifest">', '')
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', '')
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>(()=>{"use strict";\n${js}\n})();</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'frontline-conquest.html'), html);
console.log('bundle bytes', html.length);
