// Build a "Languages Used" SVG card from every repo the token can access,
// using the same data as GET /repos/{owner}/{repo}/languages (bytes per language).
// Repo names are never printed or written anywhere (this repo's Actions logs are public).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const TOKEN = process.env.GH_TOKEN;
const AFFILIATION = process.env.AFFILIATION || "owner,collaborator,organization_member";
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === "true";
const INCLUDE_ARCHIVED = process.env.INCLUDE_ARCHIVED !== "false";
const TOP_N = Number(process.env.TOP_N || 10);
const OUT = process.env.OUT || "dist/languages-all.svg";
const TITLE = process.env.TITLE || "Languages Used (All Repos)";

const toRegex = (glob) =>
  new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
const parseList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const EXCLUDE_REPOS = parseList(process.env.EXCLUDE_REPOS).map(toRegex);
const EXCLUDE_LANGS = parseList(process.env.EXCLUDE_LANGS).map((l) => l.toLowerCase());

const COLORS = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Vue: "#41b883", Go: "#00add8",
  Python: "#3572a5", HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c", Less: "#1d365d",
  Shell: "#89e051", PowerShell: "#012456", Dockerfile: "#384d54", Makefile: "#427819",
  PLpgSQL: "#336790", TSQL: "#e38c00", Java: "#b07219", Kotlin: "#a97bff", "C#": "#178600",
  PHP: "#4f5d95", Blade: "#f7523f", Ruby: "#701516", Rust: "#dea584", C: "#555555",
  "C++": "#f34b7d", Swift: "#f05138", Dart: "#00b4ab", Zig: "#ec915c", Svelte: "#ff3e00",
  Astro: "#ff5a03", MDX: "#fcb32c", Lua: "#000080", HCL: "#844fba", Nix: "#7e7eff",
};
const OTHER_COLOR = "#8b949e";

async function gh(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.ok) return { data: await res.json(), link: res.headers.get("link") };
    if (res.status >= 500 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    throw new Error(`GitHub API ${res.status}`);
  }
}

async function listRepos() {
  const repos = [];
  let url = `https://api.github.com/user/repos?affiliation=${AFFILIATION}&per_page=100`;
  while (url) {
    const { data, link } = await gh(url);
    repos.push(...data);
    const next = link && link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return repos;
}

async function collectTotals() {
  const repos = (await listRepos()).filter(
    (r) =>
      (INCLUDE_FORKS || !r.fork) &&
      (INCLUDE_ARCHIVED || !r.archived) &&
      !EXCLUDE_REPOS.some((re) => re.test(r.full_name)),
  );
  const totals = {};
  let failed = 0;
  for (const repo of repos) {
    try {
      const { data } = await gh(repo.languages_url);
      for (const [lang, bytes] of Object.entries(data)) {
        if (EXCLUDE_LANGS.includes(lang.toLowerCase())) continue;
        totals[lang] = (totals[lang] || 0) + bytes;
      }
    } catch {
      failed++;
    }
  }
  console.log(`Counted ${repos.length - failed} repos (${failed} skipped).`);
  return totals;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(totals) {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  let items = Object.entries(totals)
    .map(([name, bytes]) => ({ name, pct: (bytes / sum) * 100, color: COLORS[name] || OTHER_COLOR }))
    .sort((a, b) => b.pct - a.pct);
  if (items.length > TOP_N) {
    const rest = items.slice(TOP_N - 1).reduce((a, b) => a + b.pct, 0);
    items = [...items.slice(0, TOP_N - 1), { name: "Other", pct: rest, color: OTHER_COLOR }];
  }

  const W = 400, PAD = 20, BAR_Y = 48, ROW_H = 22, COL_W = (W - PAD * 2) / 2;
  const rows = Math.ceil(items.length / 2);
  const H = BAR_Y + 30 + rows * ROW_H + 8;
  const barW = W - PAD * 2;

  let x = PAD;
  const segments = items.map((it) => {
    const w = Math.max((it.pct / 100) * barW, 0);
    const seg = `<rect x="${x.toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="8" fill="${it.color}"/>`;
    x += w;
    return seg;
  }).join("");

  const legend = items.map((it, i) => {
    const lx = PAD + (i % 2) * COL_W;
    const ly = BAR_Y + 34 + Math.floor(i / 2) * ROW_H;
    return `<g transform="translate(${lx},${ly})">` +
      `<circle cx="5" cy="-4" r="5" fill="${it.color}"/>` +
      `<text x="16" y="0" class="name">${esc(it.name)}</text>` +
      `<text x="${COL_W - 14}" y="0" class="pct" text-anchor="end">${it.pct.toFixed(2)}%</text></g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
  .title { font: 600 16px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
  .name { font: 600 12px 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
  .pct { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: #8b949e; }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="#0d1117" stroke="#30363d"/>
<text x="${PAD}" y="32" class="title">${esc(TITLE)}</text>
<clipPath id="bar"><rect x="${PAD}" y="${BAR_Y}" width="${barW}" height="8" rx="4"/></clipPath>
<g clip-path="url(#bar)"><rect x="${PAD}" y="${BAR_Y}" width="${barW}" height="8" fill="#30363d"/>${segments}</g>
${legend}
</svg>`;
}

const totals = process.env.DEMO
  ? { TypeScript: 7324, Vue: 2017, Go: 1800, HTML: 446, JavaScript: 175, CSS: 18, Shell: 2, PLpgSQL: 2, Dockerfile: 1, Python: 0.4, Zig: 14 }
  : (() => { if (!TOKEN) throw new Error("GH_TOKEN is not set"); return null; })() ?? (await collectTotals());

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(totals));
console.log(`Wrote ${OUT}`);
