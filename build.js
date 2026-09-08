const fs = require('fs');

// La inyección de la API key (más abajo) deja `js/config.js` modificado en el
// working tree sin comitear a propósito — esa clave real nunca debe llegar al
// repo. Pero eso mismo hace que `git pull --rebase` de "Commit version bump"
// (deploy.yml) se niegue a correr por haber cambios sin stagear. Por eso la
// inyección se corre como paso aparte, después de ese commit, con
// `node build.js --inject-key`: así el working tree queda limpio (igual al
// commit) justo cuando corren los git pull/push del bump de versión.
if (process.argv[2] === '--inject-key') {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (apiKey) {
    let config = fs.readFileSync('js/config.js', 'utf8');
    config = config.replace('%%GEMINI_API_KEY%%', apiKey);
    fs.writeFileSync('js/config.js', config);
    console.log('Gemini API key injected.');
  } else {
    console.warn('Warning: GEMINI_API_KEY not set — placeholder left in config.js');
  }
  process.exit(0);
}

// Increment version once (from app.html)
const versionRe = /(<div class="hdr-drop-version">v)(\d+)(<\/div>)/;
let nextVersion;
let appHtml = fs.readFileSync('app.html', 'utf8');
appHtml = appHtml.replace(versionRe, (_, pre, num, post) => {
  nextVersion = String(parseInt(num, 10) + 1).padStart(3, '0');
  console.log(`Version bumped: v${num} → v${nextVersion}`);
  return `${pre}${nextVersion}${post}`;
});
fs.writeFileSync('app.html', appHtml);

// Bump SW cache version so mobile devices detect the update
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/vimeco-sdg-v[\w.]+/, 'vimeco-sdg-v' + Date.now());
fs.writeFileSync('sw.js', sw);
console.log('SW version updated for this deploy.');
