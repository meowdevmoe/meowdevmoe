// Builds the profile's stats cards from the real StrinovaHub repositories (self-hosted Forgejo),
// since almost none of that work is visible on GitHub. Writes assets/{activity,languages}-{light,dark}.svg.
//   node scripts/stats.mjs [weeks=12]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const REPOS = ['/srv/strinovahub/code', '/home/meowdev/sites/sh-alpha/test2', '/home/meowdev/bots/shdc-v2'];
const CODE = '/srv/strinovahub/code';
const WEEKS = Number(process.argv[2] || 12);
const out = new URL('../assets/', import.meta.url).pathname;

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });

// commits per day across repos, de-duplicated by hash
const seen = new Set();
const perDay = new Map();
for (const repo of REPOS) {
  for (const line of git(repo, ['log', '--all', '--format=%H %ad', '--date=short']).trim().split('\n')) {
    const [hash, day] = line.split(' ');
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
}

// window: WEEKS full weeks ending today, columns are weeks (Sun..Sat like GitHub)
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const end = new Date(today);
const start = new Date(today);
start.setUTCDate(start.getUTCDate() - start.getUTCDay() - (WEEKS - 1) * 7);
const days = [];
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const key = d.toISOString().slice(0, 10);
  days.push({ key, n: perDay.get(key) || 0, dow: d.getUTCDay() });
}
const commits = days.reduce((a, d) => a + d.n, 0);
const active = days.filter((d) => d.n > 0).length;
let longest = 0, run = 0;
for (const d of days) { run = d.n ? run + 1 : 0; longest = Math.max(longest, run); }

// lines of code by language, tracked files only
const LANG = { rs: 'Rust', ts: 'TypeScript', tsx: 'TypeScript', cs: 'C#', cpp: 'C++', cc: 'C++', hpp: 'C++', h: 'C++', sql: 'SQL' };
const COLOR = { Rust: '#dea584', TypeScript: '#3178c6', 'C#': '#178600', 'C++': '#f34b7d', SQL: '#e38c00' };
const loc = {};
for (const f of git(CODE, ['ls-files']).split('\n')) {
  if (!f || /(^|\/)(node_modules|dist|target|vendor|archive)\/|locales\/|\.min\./.test(f)) continue;
  const lang = LANG[f.split('.').pop()];
  if (!lang) continue;
  try { loc[lang] = (loc[lang] || 0) + readFileSync(`${CODE}/${f}`, 'utf8').split('\n').length; } catch {}
}
const total = Object.values(loc).reduce((a, b) => a + b, 0);
const langs = Object.entries(loc).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, pct: (n * 100) / total }));

const THEMES = {
  light: { bg: '#ffffff', border: '#d1d9e0', title: '#1f2328', text: '#59636e', empty: '#eff2f5', g: ['#aceebb', '#4ac26b', '#2da44e', '#116329'] },
  dark: { bg: '#0d1117', border: '#3d444d', title: '#f0f6fc', text: '#9198a1', empty: '#151b23', g: ['#033a16', '#196c2e', '#2ea043', '#56d364'] },
};
const FONT = `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif"`;
const fmt = (n) => n.toLocaleString('en-US');
const level = (n) => (n === 0 ? -1 : n < 4 ? 0 : n < 10 ? 1 : n < 20 ? 2 : 3);

for (const [name, t] of Object.entries(THEMES)) {
  // activity card: grid on the left, four numbers on the right
  const CELL = 13, GAP = 4, X0 = 24, Y0 = 62;
  let cells = '';
  days.forEach((d, i) => {
    const col = Math.floor(i / 7), row = d.dow;
    const l = level(d.n);
    cells += `<rect x="${X0 + col * (CELL + GAP)}" y="${Y0 + row * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="3" fill="${l < 0 ? t.empty : t.g[l]}"><title>${d.key}: ${d.n} commits</title></rect>`;
  });
  const gridW = WEEKS * (CELL + GAP) - GAP;
  const stats = [
    [fmt(commits), `commits, last ${WEEKS} weeks`],
    [String(active), 'active days'],
    [`${longest} days`, 'longest streak'],
    ['16', 'services in production'],
  ];
  const SX = X0 + gridW + 48, COLW = (840 - SX - 24) / 2;
  const nums = stats.map(([v, l], i) => {
    const x = SX + (i % 2) * COLW, y = 74 + Math.floor(i / 2) * 58;
    return `<text x="${x}" y="${y}" fill="${t.title}" font-size="24" font-weight="600">${v}</text><text x="${x}" y="${y + 20}" fill="${t.text}" font-size="13">${l}</text>`;
  }).join('');
  const legend = ['Less', ...t.g.map(() => ''), 'More'];
  const LX = X0, LY = Y0 + 7 * (CELL + GAP) + 10;
  const legendSvg = `<text x="${LX}" y="${LY + 10}" fill="${t.text}" font-size="11">Less</text>` +
    [t.empty, ...t.g].map((c, i) => `<rect x="${LX + 30 + i * 15}" y="${LY}" width="11" height="11" rx="2.5" fill="${c}"/>`).join('') +
    `<text x="${LX + 30 + 5 * 15 + 4}" y="${LY + 10}" fill="${t.text}" font-size="11">More</text>`;
  void legend;
  const H = LY + 30;
  writeFileSync(`${out}activity-${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${H}" viewBox="0 0 840 ${H}" ${FONT}>
<rect x=".5" y=".5" width="839" height="${H - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>
<text x="24" y="34" fill="${t.title}" font-size="16" font-weight="600">StrinovaHub activity</text>
<text x="190" y="34" fill="${t.text}" font-size="13">commits across the platform's repositories on our self-hosted Forgejo</text>
${cells}${legendSvg}${nums}
</svg>
`);

  // languages card: one stacked bar plus a legend
  const BX = 24, BY = 56, BW = 792;
  let x = BX, bar = '', leg = '';
  langs.forEach((l, i) => {
    const w = (l.pct / 100) * BW;
    bar += `<rect x="${x.toFixed(1)}" y="${BY}" width="${Math.max(w, 2).toFixed(1)}" height="10" fill="${COLOR[l.name] || '#8b949e'}"/>`;
    x += w;
    const lx = BX + (i % 3) * 264, ly = BY + 36 + Math.floor(i / 3) * 24;
    leg += `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${COLOR[l.name] || '#8b949e'}"/><text x="${lx + 16}" y="${ly}" font-size="13"><tspan fill="${t.title}" font-weight="600">${l.name}</tspan><tspan dx="6" fill="${t.text}">${l.pct.toFixed(1)}%</tspan></text>`;
  });
  const LH = BY + 36 + Math.ceil(langs.length / 3) * 24 + 4;
  writeFileSync(`${out}languages-${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${LH}" viewBox="0 0 840 ${LH}" ${FONT}>
<defs><clipPath id="r"><rect x="${BX}" y="${BY}" width="${BW}" height="10" rx="5"/></clipPath></defs>
<rect x=".5" y=".5" width="839" height="${LH - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>
<text x="24" y="34" fill="${t.title}" font-size="16" font-weight="600">Languages</text>
<text x="112" y="34" fill="${t.text}" font-size="13">share of the StrinovaHub codebase</text>
<g clip-path="url(#r)">${bar}</g>${leg}
</svg>
`);
}
console.log({ commits, active, longest, total, langs: langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) });
