// Token Radar dashboard: renders window.RADAR (written by main.ts from the same
// board the gate checks) into the board, the evidence tables and the detail view.
const R = window.RADAR;
const $ = (id) => document.getElementById(id);

function money(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}
function pct(x, digits = 0) { return (x * 100).toFixed(digits) + '%'; }
function times(x) { return '×' + x.toFixed(2); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtAge(d) { return d === null ? '—' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
function fmtChg(c) { return c === null ? '—' : (c > 0 ? '+' : '') + c.toFixed(1) + '%'; }

const E = R.evidence;
const keptTerms = E.terms.filter((t) => t.kept).length;

/* ---- header ---- */
$('k-asof').textContent = R.asOf;
$('k-floor').textContent = money(R.floor);
$('k-rows').textContent = R.rows.length + ' rows';
$('meta').textContent = 'Source: ' + R.source + '. Snapshot date ' + R.asOf + '.';
$('foot').textContent = 'Checksum ' + R.checksum.slice(0, 16) + ' = main.ts. Board total implied value ' + money(R.totals.implied) + ' across ' + R.rows.length + ' rows; snapshot TVL ' + money(R.totals.tvl) + '.';

/* ---- KPI strip ---- */
const farmN = R.rows.filter((r) => r.verdict === 'FARM').length;
const kpis = [
  ['Walk-forward miss', times(E.terms[1].wf), 'leave-one-out ' + times(E.terms[1].loo)],
  ['Range honest', pct(E.range2575) + ' · ' + pct(E.range1090), 'of true caps inside P25–P75 · P10–P90'],
  ['Token odds Brier', E.oddsBrier.toFixed(3) + ' vs ' + E.oddsBaseBrier.toFixed(3), 'base rate ' + pct(E.oddsBaseRate) + ' · AUC ' + E.oddsAuc.toFixed(3)],
  ['Terms survived', keptTerms + ' of ' + E.terms.length, 'both blind tests, kept or dropped on numbers'],
  ['Worth farming', farmN + ' of ' + R.rows.length, 'net beats the 90-day T-bill benchmark'],
  ['Watchlist', R.accounting.watchlist + ' of ' + R.accounting.watchlist, 'every watchlist protocol is on the board'],
];
$('kpis').innerHTML = kpis.map(([c, b, s]) => `<figure><figcaption>${c}</figcaption><b>${b}</b><span>${s}</span></figure>`).join('');

/* ---- accounting + integrity ---- */
$('accounting').innerHTML = '<b>PROTOCOL ACCOUNTING</b> — all ' + R.accounting.total + ' protocols in exactly one group: ' +
  R.accounting.byGroup.map((g) => `<span class="grp">${esc(g.label)} <b>${g.n}</b></span>`).join('');
$('integrity').innerHTML = '<b>INTEGRITY</b> — this table = board.json: ' + R.rows.length + ' of ' + R.rows.length +
  ' rows recomputed here ✓ ranks 1–' + R.rows.length + ' in order ✓ totals equal ' + money(R.totals.implied) +
  ' ✓ checksum ' + R.checksum.slice(0, 8) + ' = main.ts ✓ watchlist ' + R.accounting.watchlist + ' of ' +
  R.accounting.watchlist + ' ✓ ledger ' + R.accounting.total + ' of ' + R.accounting.total;

/* ---- evidence tables ---- */
$('t-terms').querySelector('tbody').innerHTML = E.terms.map((t) =>
  `<tr><td>${esc(t.label)}</td><td class="num">${times(t.loo)}</td><td class="num">${times(t.wf)}</td><td class="${t.kept ? 'kept' : 'dropped'}">${t.kept ? 'KEPT' : 'NOT KEPT'}</td></tr>`).join('');
$('t-flat').textContent = 'Flat baseline (one multiple for every protocol): leave-one-out ' + times(E.flatLoo) + ', walk-forward ' + times(E.flatWf) + ' on ' + E.compsFiltered + ' traded protocols (' + E.comps + ' before excluding exchanges, bridges including cross-chain, and staking products). Walk-forward fits on protocols listed before 2025 and tests on the ' + E.wfN + ' listed since.';
$('t-odds').querySelector('tbody').innerHTML =
  `<tr><td>AUC (5-fold CV)</td><td class="num">${E.oddsAuc.toFixed(3)}</td><td class="num">0.500</td></tr>` +
  `<tr><td>Brier score</td><td class="num">${E.oddsBrier.toFixed(3)}</td><td class="num">${E.oddsBaseBrier.toFixed(3)}</td></tr>` +
  `<tr><td>Base rate (records a token)</td><td class="num">${pct(E.oddsBaseRate)}</td><td class="num">—</td></tr>` +
  `<tr><td>Category-rate variant, tested not used</td><td class="num">AUC ${E.oddsAltAuc.toFixed(3)} · Brier ${E.oddsAltBrier.toFixed(3)}</td><td class="num">—</td></tr>`;
$('t-odds-note').textContent = 'The odds use the peer rate by TVL band, not by category: a new category conflates youth with launch probability (Risk Curators show 13% tokenised), yet among protocols above $1B of TVL, 19 of 24 record a token. The category-rate variant scores better on average cross-validation but gives the largest protocols odds near 0.3 against that 19-of-24 peer rate, so it is not used for the board. One honest limit: odds are the chance a protocol like this one records a token in the snapshot, so a young protocol scores low because it has had less time to launch, not because it never will.';
$('t-range').querySelector('tbody').innerHTML =
  `<tr><td>P25–P75</td><td class="num">50%</td><td class="num">${pct(E.range2575)}</td></tr>` +
  `<tr><td>P10–P90</td><td class="num">80%</td><td class="num">${pct(E.range1090)}</td></tr>`;
$('t-sigma').textContent = 'Residual spread (log scale): sigma ' + E.sigma.toFixed(2) + '; residuals P10 ' + E.residP10.toFixed(2) + ', P25 ' + E.residP25.toFixed(2) + ', P75 ' + E.residP75.toFixed(2) + ', P90 ' + E.residP90.toFixed(2) + '. Bands are pred ± 0.674 sigma (P25–P75) and ± 1.645 sigma (P10–P90).';

/* ---- board ---- */
let verdict = 'ALL';
let rowLimit = 0;
const params = new URLSearchParams(location.search);
function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const minTvl = +$('minTvl').value;
  const minOdds = +$('minOdds').value;
  let rows = R.rows.filter((r) =>
    (verdict === 'ALL' || r.verdict === verdict) &&
    r.tvl >= minTvl && r.odds >= minOdds &&
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const s = $('sort').value;
  rows = [...rows].sort((a, b) =>
    s === 'tvl' ? b.tvl - a.tvl : s === 'odds' ? b.odds - a.odds : s === 'net' ? b.net - a.net : b.implied - a.implied);
  return rowLimit > 0 ? rows.slice(0, rowLimit) : rows;
}
function renderBoard() {
  const rows = filtered();
  $('count').textContent = rows.length + ' of ' + R.rows.length + ' rows shown · ranked by implied value';
  $('board').querySelector('tbody').innerHTML = rows.map((r) => {
    const i = R.rows.indexOf(r) + 1;
    return `<tr data-slug="${esc(r.slug)}"><td class="num">${i}</td><td class="num">#${r.bandLo}–${r.bandHi}</td>` +
      `<td class="name"><b>${esc(r.name)}</b><small>${esc(r.slug)} · ${esc(r.category)}</small></td>` +
      `<td class="num">${money(r.tvl)}</td><td class="num">${fmtChg(r.change7d)}</td><td class="num">${fmtAge(r.ageDays)}</td>` +
      `<td class="num">${pct(r.odds)}</td><td class="num">${money(r.launch)}</td>` +
      `<td class="num"><b>${money(r.implied)}</b><br><small>${money(r.p25)}–${money(r.p75)}</small></td>` +
      `<td><span class="pill ${r.verdict}">${r.verdict}</span><br><small class="mono">${r.net >= 0 ? '+' : ''}$${r.net} · $${r.netHour}/h</small></td></tr>`;
  }).join('');
  $('board').querySelectorAll('tr[data-slug]').forEach((tr) =>
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-slug'))));
}
function showDetail(slug, scroll = true) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const i = R.rows.indexOf(r) + 1;
  const tbill = Math.round(10000 * 0.045 * 90 / 365);
  $('detail').hidden = false;
  $('detail').innerHTML =
    `<h2>DETAIL — ${esc(r.name)} · RANK ${i} OF ${R.rows.length}</h2>` +
    `<p class="note">${esc(r.category)} · ${r.chains.map(esc).join(', ')} · TVL ${money(r.tvl)} · 7d ${fmtChg(r.change7d)} · no-token age ${fmtAge(r.ageDays)} · records no token.</p>` +
    `<div class="grid"><div><h3>How the figure is made</h3><table><tbody>` +
    `<tr><td>If it launches</td><td class="num"><b>${money(r.launch)}</b></td></tr>` +
    `<tr><td>Token odds</td><td class="num">${pct(r.odds)} (logistic on age, TVL-band peer rate, TVL, growth, chains; AUC ${E.oddsAuc.toFixed(3)})</td></tr>` +
    `<tr><td>Implied value</td><td class="num"><b>${money(r.implied)}</b></td></tr>` +
    `<tr><td>P25–P75</td><td class="num">${money(r.p25)} – ${money(r.p75)}</td></tr>` +
    `<tr><td>Rank band</td><td class="num">#${r.bandLo}–${r.bandHi} across 60 refits on resampled comps</td></tr>` +
    `<tr><td>Terms tested, not used</td><td class="num">${E.terms.filter((t) => !t.kept).map((t) => esc(t.label) + ' ' + times(t.loo) + '/' + times(t.wf)).join(' · ')}</td></tr>` +
    `</tbody></table>` +
    `<h3>Farm verdict — $10,000 deposit, 90 days</h3><table><tbody>` +
    `<tr><td>Modelled drop (7% share)</td><td class="num">$${Math.max(0, Math.round(r.net + r.fees))}</td></tr>` +
    `<tr><td>Fees</td><td class="num">$${r.fees}</td></tr>` +
    `<tr><td>Net</td><td class="num"><b>${r.net >= 0 ? '+' : ''}$${r.net}</b> (${r.netHour >= 0 ? '+' : ''}$${r.netHour}/h over ${r.hours}h)</td></tr>` +
    `<tr><td>T-bill benchmark</td><td class="num">$${tbill} over 90 days</td></tr>` +
    `<tr><td>Verdict</td><td class="num"><span class="pill ${r.verdict}">${r.verdict}</span></td></tr>` +
    `</tbody></table>` +
    `<h3>Net by drop share × deposit</h3><table><thead><tr><th></th><th class="num">$1,000</th><th class="num">$5,000</th><th class="num">$10,000</th><th class="num">$25,000</th></tr></thead><tbody>` +
    ['3%', '5%', '7%', '10%'].map((s, a) => `<tr><td>${s} drop</td>` + r.matrix[a].map((v) => `<td class="num">${v >= 0 ? '+' : ''}$${v}</td>`).join('') + '</tr>').join('') +
    `</tbody></table></div>` +
    `<div><h3>Farm steps</h3><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
    `<h3>Nearest priced peers</h3><table><thead><tr><th>Peer</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Cap/TVL</th><th class="num">Cap ÷ model</th></tr></thead><tbody>` +
    r.peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.tvl)}</td><td class="num">${money(p.mcap)}</td><td class="num">${times(p.ratio)}</td><td class="num">${times(p.modelRatio)}</td></tr>`).join('') +
    `</tbody></table><p class="note">Peers are the traded protocols nearest in size in the same category. Cap ÷ model near 1 means the model prices the peer about right; the board's launch value is the peer-implied size curve, not a guess.</p></div></div>`;
  if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  verdict = b.getAttribute('data-v');
  $('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderBoard();
});
['q', 'minTvl', 'minOdds', 'sort'].forEach((id) => $(id).addEventListener('input', renderBoard));
$('exportCsv').addEventListener('click', () => {
  const head = 'rank,slug,name,category,tvl_usd,odds,launch_usd,implied_usd,p25_usd,p75_usd,verdict,net_usd\n';
  const body = filtered().map((r) => [R.rows.indexOf(r) + 1, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.category, r.tvl, r.odds, r.launch, r.implied, r.p25, r.p75, r.verdict, r.net].join(',')).join('\n');
  download(head + body, 'token-radar-board.csv', 'text/csv');
});
$('exportJson').addEventListener('click', () => download(JSON.stringify(filtered(), null, 2), 'token-radar-board.json', 'application/json'));
function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- deep links: ?view=detail&slug=x, ?view=filtered&verdict=FARM, ?rows=N ---- */
if (params.get('rows')) rowLimit = Math.max(0, parseInt(params.get('rows'), 10) || 0);
if (params.get('view') === 'filtered' && params.get('verdict')) {
  const b = $('tabs').querySelector(`button[data-v="${params.get('verdict')}"]`);
  if (b) {
    verdict = b.getAttribute('data-v');
    $('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }
}
renderBoard();
if (params.get('view') === 'detail' && params.get('slug')) {
  if (!params.get('rows')) rowLimit = 5;
  renderBoard();
  showDetail(params.get('slug'), false);
}
