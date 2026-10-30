// בדיקה חזותית: מצלם את כל המסכים ומשווה לצילומי הבסיס.
// הרצה: node tests/visual.js            → משווה ל-tests/baseline
//        node tests/visual.js --update   → מעדכן את צילומי הבסיס (אחרי שינוי עיצוב מכוון)
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const base = path.join(__dirname, 'baseline');
const update = process.argv.includes('--update');
const out = update ? base : fs.mkdtempSync(path.join(os.tmpdir(), 'vr-'));
if (update) fs.rmSync(base, { recursive: true, force: true });
execFileSync('node', [path.join(__dirname, 'shots.js'), out], { stdio: 'inherit' });
if (update) { console.log('צילומי הבסיס עודכנו ב-' + base); process.exit(0); }
try { execFileSync('python3', [path.join(__dirname, 'compare.py'), base, out], { stdio: 'inherit' }); }
catch (_) { console.log('\nיש הבדלים מול הבסיס. הצילומים החדשים: ' + out); process.exit(1); }
