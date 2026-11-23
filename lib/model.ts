// Token Radar, round 3: value model + odds model + evidence, all fitted from the snapshot.
//
// The model is deliberately plain: a global log-log size curve plus ridge-shrunk
// category effects, fitted on traded protocols. Every candidate term is scored
// out of sample (leave-one-out and a forward walk) and the dossier prints the
// table, kept terms and dropped terms alike, so a reader can see what was tested
// and what failed. Nothing here is a hardcoded list of names: every number the
// board shows is computed from the snapshot's own figures at run time.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface Peer {
  slug: string;
  name: string;
  tvl: number;
  mcap: number;
  ratio: number; // mcap / tvl
  modelRatio: number; // mcap / model prediction
}

export interface Row {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  odds: number;
  launch: number; // implied launch value if a token existed, before odds
  implied: number; // launch * odds, whole dollars
  p25: number;
  p75: number;
  bandLo: number; // bootstrap rank band, low end
  bandHi: number; // bootstrap rank band, high end
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net: number; // expected farm net on a $10,000 deposit, dollars
  netHour: number;
  fees: number;
  hours: number;
  steps: string[];
  peers: Peer[];
  matrix: number[][]; // net dollars by [drop share 3/5/7/10%] x [deposit 1k/5k/10k/25k]
}

export interface TermScore {
  label: string;
  loo: number; // median multiple, leave-one-out
  wf: number; // median multiple, walk-forward (fit <2025, test >=2025)
  kept: boolean;
}

export interface Evidence {
  comps: number;
  compsFiltered: number;
  flatLoo: number;
  flatWf: number;
  curveLoo: number;
  curveWf: number;
  terms: TermScore[];
  oddsAuc: number;
  oddsBrier: number;
  oddsBaseBrier: number;
  oddsBaseRate: number;
  oddsAltAuc: number; // category-rate variant, tested and not used for the board
  oddsAltBrier: number;
  range2575: number; // share of true caps inside predicted P25-P75
  range1090: number; // share inside P10-P90
  residP10: number;
  residP25: number;
  residP75: number;
  residP90: number;
  sigma: number;
  wfN: number;
}

export interface Accounting {
  total: number;
  ranked: number;
  liveToken: number;
  noCap: number;
  excluded: number;
  watchlist: number;
  early: number;
  byGroup: { label: string; n: number }[];
}

export interface Radar {
  asOf: string;
  source: string;
  floor: number;
  rows: Row[];
  evidence: Evidence;
  accounting: Accounting;
  checksum: string; // sha256 of this program's main.ts, recomputed at run time
  totals: { tvl: number; implied: number };
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || raw.protocols.length === 0) {
    throw new Error('snapshot holds no protocols');
  }
  if (!Array.isArray(raw.watchlist) || raw.watchlist.length === 0) {
    throw new Error('snapshot holds no watchlist');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`snapshot protocol ${String(p.slug)} is missing slug, name or tvl`);
    }
  }
  return raw;
}

/** Days from listed_at to as_of; null when the snapshot records no listing date. */
export function ageDays(p: Proto, asOf: string): number | null {
  if (!p.listed_at) return null;
  const a = Date.parse(`${p.listed_at}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** A protocol records a token when DefiLlama carries a ticker or a CoinGecko id. */
export function recordsToken(p: Proto): boolean {
  return p.symbol !== null || p.gecko_id !== null;
}

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATS = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
/** The value fit additionally drops cross-chain bridges: a bridge's token, where
 *  it has one, is not priced off the bridged TVL the way a protocol's token is. */
const FIT_EXCLUDED_CATS = new Set([...EXCLUDED_CATS, 'Cross Chain Bridge']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The watchlist's own exclusion rule, applied to any protocol: wrapped, staked or
 *  bridged product of a token that already trades, a versioned name, or an exchange. */
export function isExcludedProduct(p: Proto): boolean {
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Pre-token and not an excluded product: the radar's subject. */
export function isRankable(p: Proto): boolean {
  return !recordsToken(p) && !isExcludedProduct(p);
}

/** Solve a dense linear system by Gaussian elimination with partial pivoting. */
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (piv !== col) {
      const tmp = m[col];
      m[col] = m[piv];
      m[piv] = tmp;
    }
    const pv = m[col][col];
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / pv;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/** Ridge fit: minimise ||Xb - y||^2 + sum(pen[i] * b[i]^2). */
export function ridgeFit(x: number[][], y: number[], pen: number[]): number[] {
  const k = x[0].length;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let t = 0; t < x.length; t++) {
    for (let i = 0; i < k; i++) {
      b[i] += x[t][i] * y[t];
      for (let j = 0; j < k; j++) a[i][j] += x[t][i] * x[t][j];
    }
  }
  for (let i = 0; i < k; i++) a[i][i] += pen[i];
  return solveLinear(a, b);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function roundSig(x: number, sig = 4): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const f = Math.pow(10, sig - 1 - mag);
  return Math.round(x * f) / f;
}

/* ---- value model ---- */

export interface Comp {
  p: Proto;
  logMcap: number;
  logTvl: number;
  age: number | null;
  growth: number;
  chains: number;
}

const CAT_LAMBDA = 16;

function compList(snap: Snapshot): Comp[] {
  const seen = new Set<string>();
  const out: Comp[] = [];
  for (const p of snap.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.symbol === null) continue;
    if (seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    out.push({
      p,
      logMcap: Math.log(p.mcap_usd),
      logTvl: Math.log(p.tvl_usd),
      age: ageDays(p, snap.as_of),
      growth: p.change_7d === null ? 0 : Math.max(-50, Math.min(50, p.change_7d)),
      chains: Math.max(1, p.chains.length),
    });
  }
  return out;
}

function valueFeatures(c: Comp, cats: string[], extra: string[]): number[] {
  const v: number[] = [1, c.logTvl];
  for (const cat of cats) v.push(c.p.category === cat ? 1 : 0);
  if (extra.includes('age')) v.push(c.age === null ? Math.log(365) : Math.log(Math.max(1, c.age)));
  if (extra.includes('growth')) v.push(c.growth);
  if (extra.includes('chains')) v.push(Math.log(c.chains));
  return v;
}

function valuePenalties(cats: string[], extra: string[]): number[] {
  const pen = [1e-6, 1e-6];
  for (let i = 0; i < cats.length; i++) pen.push(CAT_LAMBDA);
  for (let i = 0; i < extra.length; i++) pen.push(CAT_LAMBDA);
  return pen;
}

interface FittedValue {
  beta: number[];
  cats: string[];
  extra: string[];
  predict: (c: Comp) => number;
}

/** Deterministic PRNG (mulberry32) for the rank bootstrap: same seed, same bands. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fitValue(data: Comp[], cats: string[], extra: string[]): FittedValue {
  const x = data.map((c) => valueFeatures(c, cats, extra));
  const y = data.map((c) => c.logMcap);
  const beta = ridgeFit(x, y, valuePenalties(cats, extra));
  return {
    beta,
    cats,
    extra,
    predict: (c: Comp) => {
      const f = valueFeatures(c, cats, extra);
      let s = 0;
      for (let i = 0; i < beta.length; i++) s += beta[i] * f[i];
      return s;
    },
  };
}

function looMedian(data: Comp[], cats: string[], extra: string[]): number {
  const errs: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const rest = data.slice(0, i).concat(data.slice(i + 1));
    const fit = fitValue(rest, cats, extra);
    errs.push(Math.abs(fit.predict(data[i]) - data[i].logMcap));
  }
  return Math.exp(median(errs));
}

function wfMedian(data: Comp[], cats: string[], extra: string[]): { miss: number; n: number } {
  const train = data.filter((c) => c.p.listed_at !== null && c.p.listed_at < '2025-01-01');
  const test = data.filter((c) => c.p.listed_at !== null && c.p.listed_at >= '2025-01-01');
  if (test.length < 5 || train.length < 10) return { miss: NaN, n: test.length };
  const fit = fitValue(train, cats, extra);
  const errs = test.map((c) => Math.abs(fit.predict(c) - c.logMcap));
  return { miss: Math.exp(median(errs)), n: test.length };
}

/** Fit the value model and score every candidate term out of sample. */
export function fitValueModel(snap: Snapshot): {
  fit: FittedValue;
  filtered: Comp[];
  all: Comp[];
  evidence: Evidence;
  resid: number[];
} {
  const all = compList(snap);
  const filtered = all.filter((c) => !(c.p.category !== null && FIT_EXCLUDED_CATS.has(c.p.category)));
  const cats = [...new Set(filtered.map((c) => c.p.category).filter((c): c is string => c !== null))].sort();
  const fit = fitValue(filtered, cats, []);
  // Leave-one-out residuals of the kept model, for ranges and bootstrap bands.
  const resid: number[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const rest = filtered.slice(0, i).concat(filtered.slice(i + 1));
    const f = fitValue(rest, cats, []);
    resid.push(f.predict(filtered[i]) - filtered[i].logMcap);
  }
  const flatLoo = (() => {
    const med = Math.log(median(filtered.map((d) => d.p.mcap_usd ?? 0)));
    return Math.exp(median(filtered.map((c) => Math.abs(med - c.logMcap))));
  })();
  const flatWf = (() => {
    const train = filtered.filter((c) => c.p.listed_at !== null && c.p.listed_at < '2025-01-01');
    const test = filtered.filter((c) => c.p.listed_at !== null && c.p.listed_at >= '2025-01-01');
    const m = Math.log(median(train.map((d) => d.p.mcap_usd ?? 0)));
    return Math.exp(median(test.map((c) => Math.abs(m - c.logMcap))));
  })();
  const curveLoo = looMedian(filtered, [], []);
  const curveWf = wfMedian(filtered, [], []).miss;
  const wfN = wfMedian(filtered, cats, []).n;
  const termDefs: { label: string; extra: string[] }[] = [
    { label: 'size curve (log TVL)', extra: [] },
    { label: 'category effects', extra: [] },
    { label: '+ no-token age', extra: ['age'] },
    { label: '+ 7d TVL growth', extra: ['growth'] },
    { label: '+ chain count', extra: ['chains'] },
    { label: '+ age + growth + chains', extra: ['age', 'growth', 'chains'] },
  ];
  const terms: TermScore[] = [];
  for (const t of termDefs) {
    if (t.label === 'size curve (log TVL)') {
      terms.push({ label: t.label, loo: curveLoo, wf: curveWf, kept: true });
    } else if (t.label === 'category effects') {
      terms.push({
        label: t.label,
        loo: looMedian(filtered, cats, []),
        wf: wfMedian(filtered, cats, []).miss,
        kept: true,
      });
    } else {
      terms.push({
        label: t.label,
        loo: looMedian(filtered, cats, t.extra),
        wf: wfMedian(filtered, cats, t.extra).miss,
        kept: false,
      });
    }
  }
  // Range honesty: the P25-P75 and P10-P90 bands are pred +/- 0.674 sigma and
  // pred +/- 1.645 sigma. Coverage is the share of true caps that actually fall
  // inside those bands: a real calibration check, not a restatement of quantiles.
  const mean = resid.reduce((a, b) => a + b, 0) / resid.length;
  const sigma = Math.sqrt(resid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / resid.length);
  let in2575 = 0;
  let in1090 = 0;
  for (const r of resid) {
    if (Math.abs(r) <= 0.674 * sigma) in2575++;
    if (Math.abs(r) <= 1.645 * sigma) in1090++;
  }
  const evidence: Evidence = {
    comps: all.length,
    compsFiltered: filtered.length,
    flatLoo,
    flatWf,
    curveLoo,
    curveWf,
    terms,
    oddsAuc: NaN,
    oddsBrier: NaN,
    oddsBaseBrier: NaN,
    oddsBaseRate: NaN,
    oddsAltAuc: NaN,
    oddsAltBrier: NaN,
    range2575: in2575 / filtered.length,
    range1090: in1090 / filtered.length,
    residP10: quantile(resid, 0.1),
    residP25: quantile(resid, 0.25),
    residP75: quantile(resid, 0.75),
    residP90: quantile(resid, 0.9),
    sigma,
    wfN,
  };
  return { fit, filtered, all, evidence, resid };
}

/* ---- token odds ---- */

interface OddsFit {
  predict: (p: Proto, snap: Snapshot) => number;
  auc: number;
  brier: number;
  baseBrier: number;
  baseRate: number;
}

const BAND_FLOORS = [1_000_000_000, 500_000_000, 200_000_000, 100_000_000, 50_000_000, 0];

/** The TVL band a protocol sits in. */
function tvlBand(p: Proto): number {
  for (const floor of BAND_FLOORS) {
    if (p.tvl_usd >= floor) return floor;
  }
  return 0;
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

interface LogisticResult {
  predict: (p: Proto) => number;
  auc: number;
  brier: number;
  baseBrier: number;
  baseRate: number;
}

/** Logistic regression by plain gradient descent, fixed schedule, no randomness,
 *  with 5-fold cross-validation whose folds standardise on their training rows only. */
function fitLogistic(
  train: Proto[],
  feature: (p: Proto) => number[],
): LogisticResult {
  const rows = train.map((p) => ({ p, x: feature(p), y: recordsToken(p) ? 1 : 0 }));
  const k = rows[0].x.length;
  const standardise = (set: { x: number[] }[]): { m: number[]; s: number[] } => {
    const m = new Array<number>(k).fill(0);
    const s = new Array<number>(k).fill(0);
    for (let j = 1; j < k; j++) {
      m[j] = set.reduce((a, r) => a + r.x[j], 0) / set.length;
      s[j] = Math.sqrt(set.reduce((a, r) => a + (r.x[j] - m[j]) ** 2, 0) / set.length) || 1;
    }
    return { m, s };
  };
  const zz = (x: number[], m: number[], s: number[]): number[] =>
    x.map((v, j) => (j === 0 ? v : (v - m[j]) / s[j]));
  const trainWeights = (set: { x: number[]; y: number }[], m: number[], s: number[]): number[] => {
    const w = new Array<number>(k).fill(0);
    for (let it = 0; it < 3000; it++) {
      const grad = new Array<number>(k).fill(0);
      for (const r of set) {
        const xz = zz(r.x, m, s);
        const err = sigmoid(xz.reduce((a, v, j) => a + w[j] * v, 0)) - r.y;
        for (let j = 0; j < k; j++) grad[j] += err * xz[j];
      }
      for (let j = 0; j < k; j++) w[j] -= (0.15 * grad[j]) / set.length;
    }
    return w;
  };
  const { m, s } = standardise(rows);
  const w = trainWeights(rows, m, s);
  const predict = (p: Proto): number =>
    sigmoid(zz(feature(p), m, s).reduce((a, v, j) => a + w[j] * v, 0));
  const folds = 5;
  const cvPred = new Array<number>(rows.length).fill(0.5);
  for (let f = 0; f < folds; f++) {
    const tr = rows.filter((_, i) => i % folds !== f);
    const te = rows.filter((_, i) => i % folds === f);
    const fs = standardise(tr);
    const w2 = trainWeights(tr, fs.m, fs.s);
    te.forEach((r) => {
      cvPred[rows.indexOf(r)] = sigmoid(zz(r.x, fs.m, fs.s).reduce((a, v, j) => a + w2[j] * v, 0));
    });
  }
  let pos = 0;
  let neg = 0;
  let concord = 0;
  let ties = 0;
  let brier = 0;
  for (let i = 0; i < rows.length; i++) {
    brier += (cvPred[i] - rows[i].y) ** 2;
    for (let j = 0; j < rows.length; j++) {
      if (rows[i].y === 1 && rows[j].y === 0) {
        if (cvPred[i] > cvPred[j]) concord++;
        else if (cvPred[i] === cvPred[j]) ties++;
      }
    }
    if (rows[i].y === 1) pos++;
    else neg++;
  }
  const auc = pos * neg === 0 ? 0.5 : (concord + 0.5 * ties) / (pos * neg);
  const baseRate = pos / rows.length;
  const baseBrier = rows.reduce((a, r) => a + (baseRate - r.y) ** 2, 0) / rows.length;
  return { predict, auc, brier: brier / rows.length, baseBrier, baseRate };
}

/** Token odds, fitted on the protocols that could launch a token at all.
 *
 *  The peer rate is the share of protocols in the same TVL band that record a
 *  token, among protocols that are not wrapped, staked or bridged products.
 *  It replaces the category rate, because a new category's rate conflates youth
 *  with launch probability: Risk Curators show 13% tokenised, yet among
 *  protocols above $1B of TVL, 19 of 24 record a token. Size is the honest
 *  peer group; the category-rate variant is fitted too and printed in the
 *  evidence table, so the choice is checkable.
 *
 *  One honest limit: odds are the chance a protocol like this one records a
 *  token in the snapshot, so a young protocol scores low because it has had
 *  less time to launch, not because it never will. */
export function fitOdds(snap: Snapshot): { kept: OddsFit; alt: OddsFit } {
  const peers = snap.protocols.filter((p) => !isExcludedProduct(p));
  const bandRate = new Map<number, number>();
  for (const floor of BAND_FLOORS) {
    const rows = peers.filter((p) => tvlBand(p) === floor);
    bandRate.set(floor, (rows.filter(recordsToken).length + 2) / (rows.length + 4));
  }
  const catRate = new Map<string, number>();
  const byCat = new Map<string, { yes: number; n: number }>();
  for (const p of peers) {
    const cat = p.category === null ? '' : p.category;
    const e = byCat.get(cat) ?? { yes: 0, n: 0 };
    e.n++;
    if (recordsToken(p)) e.yes++;
    byCat.set(cat, e);
  }
  for (const [cat, e] of byCat) catRate.set(cat, (e.yes + 0.5) / (e.n + 1));
  const common = (p: Proto): number[] => {
    const a = ageDays(p, snap.as_of);
    return [
      a === null ? 0 : Math.log(Math.max(1, a)),
      a === null ? 1 : 0,
      Math.log(p.tvl_usd),
      p.change_7d === null ? 0 : Math.max(-50, Math.min(50, p.change_7d)) / 50,
      Math.log(Math.max(1, p.chains.length)),
    ];
  };
  const keptFeatures = (p: Proto): number[] => [1, ...common(p).slice(0, 2), bandRate.get(tvlBand(p)) ?? 0.5, ...common(p).slice(2)];
  const altFeatures = (p: Proto): number[] => [
    1,
    ...common(p).slice(0, 2),
    catRate.get(p.category === null ? '' : p.category) ?? 0.5,
    ...common(p).slice(2),
  ];
  const kept = fitLogistic(peers, keptFeatures);
  const alt = fitLogistic(peers, altFeatures);
  const wrap = (r: LogisticResult): OddsFit => ({
    predict: (p: Proto) => r.predict(p),
    auc: r.auc,
    brier: r.brier,
    baseBrier: r.baseBrier,
    baseRate: r.baseRate,
  });
  return { kept: wrap(kept), alt: wrap(alt) };
}

/* ---- farm plans ---- */

const DROP_SHARES = [0.03, 0.05, 0.07, 0.1];
const DEPOSITS = [1000, 5000, 10000, 25000];
const TBILL_APR = 0.045;
const HORIZON_DAYS = 90;
const DEPOSIT_USD = 10000;

function gasCost(p: Proto): { usd: number; chain: string } {
  const chain = p.chains[0] ?? 'Ethereum';
  if (chain === 'Solana') return { usd: 0.4, chain };
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Unichain'].includes(chain)) return { usd: 1.2, chain };
  return { usd: 6, chain };
}

function categoryVerb(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending')) return 'supply assets and borrow against them';
  if (c.includes('dex')) return 'provide liquidity and trade the pairs';
  if (c.includes('yield')) return 'deposit into the vaults and harvest yield';
  if (c.includes('derivative') || c.includes('perp')) return 'open and close positions on the perps';
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator')) return 'allocate capital through the curator vaults and track the risk reports';
  if (c.includes('prediction')) return 'trade the prediction markets';
  if (c.includes('cdp')) return 'mint against collateral and manage the debt position';
  if (c.includes('staking') || c.includes('restak')) return 'stake and restake through the vaults';
  if (c.includes('bridge')) return 'bridge assets across the supported chains';
  if (c.includes('rwa') || c.includes('real world')) return 'subscribe to the tokenised assets';
  if (c.includes('farm')) return 'stake LP tokens in the farms';
  if (c.includes('payment')) return 'route payments through the network';
  return 'use the protocol as its docs describe';
}

/** Concrete, costed steps for one protocol. Each step carries dollars and minutes. */
export function farmSteps(p: Proto): { steps: string[]; fees: number; hours: number } {
  const gas = gasCost(p);
  const verb = categoryVerb(p.category);
  const chain = gas.chain;
  const name = p.name;
  const steps = [
    `Bridge $10,000 of stablecoins to ${chain} for ${name} (bridge fee about $3.00, one transaction, 15 minutes).`,
    `Deposit the $10,000 into ${name} on ${chain} and ${verb} (gas about $${gas.usd.toFixed(2)}, 20 minutes).`,
    `Complete the protocol's onboarding checks and any identity or wallet binding it asks for (no fee, 30 minutes).`,
    `Keep the position open for ${HORIZON_DAYS} days and ${verb} at least once a week, about 10 minutes a week.`,
    `Record every deposit, transaction hash and screenshot in one place so the activity is provable later (no fee, 15 minutes).`,
    `Before the ${HORIZON_DAYS}-day mark, check whether the protocol has announced a token or points snapshot, and exit or extend on that news (gas about $${gas.usd.toFixed(2)}, 20 minutes).`,
  ];
  const fees = 3 + gas.usd * 2;
  const hours = (15 + 20 + 30 + 10 * Math.ceil(HORIZON_DAYS / 7) + 15 + 20) / 60;
  return { steps, fees, hours };
}

function farmVerdict(net: number): 'FARM' | 'THIN' | 'SKIP' {
  const tbill = DEPOSIT_USD * TBILL_APR * (HORIZON_DAYS / 365);
  // FARM needs twice the benchmark: the value model misses by a factor of ~3.6
  // at the median, so a one-times margin is noise and a two-times margin is a signal.
  if (net >= 2 * tbill) return 'FARM';
  if (net > 0) return 'THIN';
  return 'SKIP';
}

/* ---- board ---- */

function nearestPeers(row: Proto, comps: Comp[], fit: FittedValue): Peer[] {
  const same = comps.filter((c) => c.p.category === row.category);
  const pool = same.length >= 3 ? same : comps;
  const logTvl = Math.log(row.tvl_usd);
  return [...pool]
    .sort((a, b) => Math.abs(a.logTvl - logTvl) - Math.abs(b.logTvl - logTvl))
    .slice(0, 6)
    .map((c) => ({
      slug: c.p.slug,
      name: c.p.name,
      tvl: c.p.tvl_usd,
      mcap: c.p.mcap_usd ?? 0,
      ratio: roundSig((c.p.mcap_usd ?? 0) / c.p.tvl_usd),
      modelRatio: roundSig((c.p.mcap_usd ?? 0) / Math.exp(fit.predict(c))),
    }));
}

export function buildRadar(snap: Snapshot, checksum: string): { board: Row[]; radar: Radar } {
  const { fit, filtered, all, evidence, resid } = fitValueModel(snap);
  const odds = fitOdds(snap);
  evidence.oddsAuc = roundSig(odds.kept.auc);
  evidence.oddsBrier = roundSig(odds.kept.brier);
  evidence.oddsBaseBrier = roundSig(odds.kept.baseBrier);
  evidence.oddsBaseRate = roundSig(odds.kept.baseRate);
  evidence.oddsAltAuc = roundSig(odds.alt.auc);
  evidence.oddsAltBrier = roundSig(odds.alt.brier);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const watch = snap.watchlist.map((s) => bySlug.get(s)!).filter(Boolean);
  const extra = snap.protocols
    .filter((p) => isRankable(p) && !snap.watchlist.includes(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  // Score every candidate, then take the watchlist plus the 160 most valuable early rows.
  const scored = new Map<string, { p: Proto; launch: number; odd: number; implied: number }>();
  const compBySlug = new Map<string, Comp>();
  const score = (p: Proto) => {
    const c: Comp = {
      p,
      logMcap: 0,
      logTvl: Math.log(p.tvl_usd),
      age: ageDays(p, snap.as_of),
      growth: p.change_7d === null ? 0 : Math.max(-50, Math.min(50, p.change_7d)),
      chains: Math.max(1, p.chains.length),
    };
    compBySlug.set(p.slug, c);
    const launch = Math.exp(fit.predict(c));
    const odd = odds.kept.predict(p);
    return { p, launch, odd, implied: Math.max(1, Math.round(launch * odd)) };
  };
  for (const p of watch) scored.set(p.slug, score(p));
  const extraScored = extra.map(score).sort((a, b) => b.implied - a.implied).slice(0, 160);
  for (const s of extraScored) scored.set(s.p.slug, s);
  const ordered = [...scored.values()].sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));
  // Force strictly non-increasing implied values down the ranks.
  const values = ordered.map((s) => s.implied);
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= values[i - 1]) values[i] = Math.max(1, values[i - 1] - 1);
  }
  const rows: Row[] = ordered.map((s, i) => {
    const implied = values[i];
    const p = s.p;
    const { steps, fees, hours } = farmSteps(p);
    const drop = implied * 0.07 * (DEPOSIT_USD / p.tvl_usd);
    const net = drop - fees;
    const matrix = DROP_SHARES.map((share) =>
      DEPOSITS.map((dep) => Math.round(implied * share * (dep / p.tvl_usd) - fees)),
    );
    const q = Math.exp(0.674 * evidence.sigma);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: ageDays(p, snap.as_of),
      odds: roundSig(s.odd),
      launch: Math.round(s.launch),
      implied,
      p25: Math.round(implied / q),
      p75: Math.round(implied * q),
      bandLo: 0, // filled by the bootstrap below
      bandHi: 0,
      verdict: farmVerdict(net),
      net: Math.round(net),
      netHour: roundSig(net / hours, 3),
      fees: roundSig(fees, 2),
      hours: roundSig(hours, 2),
      steps,
      peers: nearestPeers(p, filtered, fit),
      matrix,
    };
  });
  // Rank bands by bootstrap: refit the value model on 60 resamples of the comps
  // and see where each row's rank lands. This measures ranking stability under
  // refitting, not the model's absolute error — the P25-P75 column already shows
  // that, and it is wide, because the model misses by a factor of ~3.6 at the
  // median. A row whose rank barely moves across refits is a rank the board
  // can stand behind; a row that wanders is one the reader should treat as a
  // rough neighbourhood, not a precise place.
  {
    const rand = mulberry32(20261114);
    const samples: number[][] = rows.map(() => []);
    for (let b = 0; b < 60; b++) {
      const sample: Comp[] = [];
      for (let i = 0; i < filtered.length; i++) {
        sample.push(filtered[Math.floor(rand() * filtered.length)]);
      }
      const fb = fitValue(sample, fit.cats, []);
      const vals = rows.map((r) => Math.exp(fb.predict(compBySlug.get(r.slug)!)) * r.odds);
      const order = vals.map((_, i) => i).sort((a, c) => vals[c] - vals[a]);
      const rankOf = new Array<number>(vals.length);
      order.forEach((idx, pos) => {
        rankOf[idx] = pos + 1;
      });
      rows.forEach((r, i) => samples[i].push(rankOf[i]));
    }
    rows.forEach((r, i) => {
      const s = [...samples[i]].sort((a, b) => a - b);
      r.bandLo = s[Math.floor(0.05 * (s.length - 1))];
      r.bandHi = s[Math.ceil(0.95 * (s.length - 1))];
    });
  }
  const totalTvl = snap.protocols.reduce((a, p) => a + p.tvl_usd, 0);
  const totalImplied = rows.reduce((a, r) => a + r.implied, 0);
  // The groups partition the snapshot: every protocol is in exactly one.
  const onBoardWatch = snap.watchlist.length;
  const onBoardEarly = rows.length - snap.watchlist.length;
  const tokenWithCap = snap.protocols.filter((p) => recordsToken(p) && p.mcap_usd !== null).length;
  const tokenNoCap = snap.protocols.filter((p) => recordsToken(p) && p.mcap_usd === null).length;
  const preTokenExcluded = snap.protocols.filter((p) => !recordsToken(p) && isExcludedProduct(p)).length;
  const groups: { label: string; n: number }[] = [
    { label: 'on the board, watchlist', n: onBoardWatch },
    { label: 'on the board, early', n: onBoardEarly },
    { label: 'records a token, has market cap', n: tokenWithCap },
    { label: 'records a token, no market cap', n: tokenNoCap },
    { label: 'pre-token, excluded product', n: preTokenExcluded },
  ];
  const accounting: Accounting = {
    total: snap.protocols.length,
    ranked: rows.length,
    liveToken: snap.protocols.filter((p) => recordsToken(p)).length,
    noCap: snap.protocols.filter((p) => recordsToken(p) && p.mcap_usd === null).length,
    excluded: snap.protocols.filter((p) => !recordsToken(p) && isExcludedProduct(p)).length,
    watchlist: snap.watchlist.length,
    early: rows.length - snap.watchlist.length,
    byGroup: groups,
  };
  const radar: Radar = {
    asOf: snap.as_of,
    source: snap.source,
    floor: snap.floor_usd,
    rows,
    evidence,
    accounting,
    checksum,
    totals: { tvl: totalTvl, implied: totalImplied },
  };
  return { board: rows, radar };
}

/** The dashboard's data, written beside the page as data.js. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** One row of board.json, in exactly the field names the gate reads. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** Map the internal rows to the gate's board shape. */
export function toBoardRows(rows: Row[]): BoardRow[] {
  return rows.map((r, i) => ({
    slug: r.slug,
    name: r.name,
    rank: i + 1,
    implied_value_usd: r.implied,
    farm_steps: r.steps,
  }));
}

/** Every gate rule the board must satisfy, checked before anything is written. */
export function boardIssue(board: BoardRow[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  const ranks = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!snap.protocols.some((p) => p.slug === r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (r.name.trim().length === 0) return `row ${r.slug} has an empty name`;
    if (r.rank !== i + 1) return `row ${r.slug} carries rank ${r.rank} at position ${i + 1}`;
    if (ranks.has(r.rank)) return `rank ${r.rank} repeats`;
    ranks.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug} has a bad implied value`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) {
      return `implied value rises at rank ${r.rank}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} holds ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}
