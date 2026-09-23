// Controleert dat het <script>-blok in index.html geldig JavaScript is.
// Eerste stap in .github/workflows/test.yml, zodat een kapotte upload meteen
// zichtbaar is in de Actions-tab, nog voor de functionele tests draaien.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if (!match) {
    console.error('Geen <script>-blok gevonden in index.html');
    process.exit(1);
}
new vm.Script(match[1], { filename: 'index.html<script>' });
console.log('Syntax OK');
