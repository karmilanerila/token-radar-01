// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// The value model is FITTED from the snapshot at run time, never a table of names:
//
//   comps            = the traded protocols with a positive market cap, one per ticker symbol
//   log(mcap)        = a + b * log(TVL)          ordinary least squares over the comps
//   category multiple = median mcap / TVL per category, shrunk toward the global curve:
//                      logMult = (n * logMed + K * logGlobal) / (n + K), K = 10;
//                      categories with fewer than 3 comps fall back to the global curve.
//   growthMult       = 1 + clamp(change_7d, -60, 120) / 100 * 0.25   (a stated prior)
//   maturityMult     = 0.7 + min(age, 1095) / 1095 * 0.3             (a stated prior; unknown age 365)
//   implied          = max(1, round(TVL * exp(logMult) * growthMult * maturityMult
//                          * TOKEN_ODDS * OWN_TOKEN_SHARE))
//
// TOKEN_ODDS (0.35) and OWN_TOKEN_SHARE (0.20) are flat stated assumptions, not fitted terms:
// a blind test on this snapshot found NO signal for them (a logistic on age, log TVL and 7-day
// growth ranks traded protocols above pre-token ones with AUC 0.45 on held-out data — worse than
// a coin flip), so the model does not pretend to fit them. Growth and age likewise carry almost
// no signal for the multiple (correlations -0.15 and +0.01), which is why their weights are small
// priors rather than fitted coefficients. The dashboard shows all of this.
//
// Validation, measured offline on the sealed snapshot (2026-11-22) and stated on the dashboard:
//   global curve: log(mcap) = 6.9646 + 0.5223 * log(TVL), R^2 = 0.194 (size explains ~19%)
//   leave-one-out on the fitted value: median |log error| 1.22 (3.4x), p80 2.44, p90 3.48
//   walk-forward (fit on protocols listed before 2025-01-01, test after): median 1.12 (3.1x)
//   category medians span 27x (Liquid Staking 0.041 to Canonical Bridge 1.126), but with
//   n = 3..15 per category the medians are noisy: the shrunk-category model (k = 10) scores
//   median 1.24 in leave-one-out against 1.22 for the global curve alone, so the shrinkage
//   keeps the category signal without letting a small-n median run the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's structural parameters: stated priors and assumptions, not fitted constants. */
export interface ModelConstants {
  /** Shrinkage weight of the global curve when blending a category median (n / (n + k)). */
  shrink_k: number;
  /** Smallest category size that earns its own median; smaller categories use the global curve. */
  min_category_n: number;
  /** Weight of the seven-day growth tilt. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Flat stated assumption: the chance a pre-token protocol ever lists a token. */
  token_odds: number;
  /** Flat stated assumption: the share of the token's value the public float holds. */
  own_token_share: number;
  /** Stated assumption: the share of the implied value an airdrop pays out. */
  airdrop_share: number;
  /** Stated assumption: how many qualifying farmers split one airdrop. */
  airdrop_farmers: number;
  /** Opportunity cost of capital, per year, used to net a farm plan. */
  capital_apr: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 10,
  min_category_n: 3,
  growth_weight: 0.25,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  token_odds: 0.35,
  own_token_share: 0.2,
  airdrop_share: 0.1,
  airdrop_farmers: 1000,
  capital_apr: 0.05,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Bootstrap refits used for each row's rank band; a fixed seed keeps the run deterministic. */
export const BOOTSTRAP_REFITS = 200;
export const BOOTSTRAP_SEED = 20261114;

/** Validation numbers measured offline on the sealed snapshot; the dashboard states them. */
export const VALIDATION = {
  comps: 128,
  global_a: 6.9646,
  global_b: 0.5223,
  global_r2: 0.194,
  loo_median_log: 1.22,
  loo_median_x: 3.4,
  loo_p80_log: 2.44,
  loo_p90_log: 3.48,
  walk_forward_median_log: 1.12,
  walk_forward_median_x: 3.1,
  walk_forward_fit_n: 64,
  walk_forward_test_n: 31,
  odds_auc_test: 0.45,
  category_spread_x: 27,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm plan's netted verdict: the expected airdrop against the plan's cost. */
export interface FarmVerdict {
  verdict: 'FARM' | 'THIN' | 'SKIP';
  expected_usd: number;
  cost_usd: number;
  net_usd: number;
  break_even_usd: number;
  capital_usd: number;
  hold_days: number;
  gas_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    token_odds: number;
    own_token_share: number;
    rank_band_low: number;
    rank_band_high: number;
    verdict: 'FARM' | 'THIN' | 'SKIP';
    expected_airdrop_usd: number;
    farm_cost_usd: number;
    net_usd: number;
    break_even_usd: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  base_multiple: number;
  token_odds: number;
  own_token_share: number;
  rank_band_low: number;
  rank_band_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  expected_airdrop_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  break_even_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: typeof VALIDATION;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
}

/** A deterministic 32-bit generator (mulberry32) for the bootstrap: same seed, same bands. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fitted comps: the traded protocols with a positive market cap, one per ticker symbol. */
export function cleanComps(snapshot: Snapshot): SnapshotProtocol[] {
  const seen = new Set<string>();
  const out: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || !(p.mcap_usd > 0)) continue;
    if (p.symbol !== null) {
      if (seen.has(p.symbol)) continue;
      seen.add(p.symbol);
    }
    out.push(p);
  }
  return out;
}

/** The fitted curve and category medians from one comp list. */
export interface FittedModel {
  /** Intercept of log(mcap) = a + b * log(TVL). */
  a: number;
  /** Slope of log(mcap) = a + b * log(TVL). */
  b: number;
  /** Per-category median log(mcap / TVL) and comp count. */
  categories: Map<string, { logMed: number; n: number }>;
  /** How many comps the fit ran on. */
  n: number;
}

/** Ordinary least squares on log(mcap) against log(TVL), plus per-category log medians. */
export function fitFromComps(comps: SnapshotProtocol[]): FittedModel {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const c = p.category ?? '(none)';
    const list = byCat.get(c);
    if (list === undefined) byCat.set(c, [Math.log(p.mcap_usd! / p.tvl_usd)]);
    else list.push(Math.log(p.mcap_usd! / p.tvl_usd));
  }
  const categories = new Map<string, { logMed: number; n: number }>();
  for (const [c, v] of byCat.entries()) categories.set(c, { logMed: median(v), n: v.length });
  return { a, b, categories, n: comps.length };
}

/** The global curve's log multiple at one TVL: log(mcap / TVL) = a + (b - 1) * log(TVL). */
function logGlobalMultiple(tvl: number, fit: FittedModel): number {
  return fit.a + (fit.b - 1) * Math.log(tvl);
}

/** The category-shrunk log multiple for one protocol: the category median blended with the curve. */
function logCategoryMultiple(p: SnapshotProtocol, fit: FittedModel, model: ModelConstants): number {
  const global = logGlobalMultiple(p.tvl_usd, fit);
  const entry = fit.categories.get(p.category ?? '(none)');
  if (entry === undefined || entry.n < model.min_category_n) return global;
  return (entry.n * entry.logMed + model.shrink_k * global) / (entry.n + model.shrink_k);
}

/** The three multipliers and the implied value one protocol gets under `model` and `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FittedModel,
  model: ModelConstants,
): { implied: number; launch: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = Math.exp(logCategoryMultiple(protocol, fit, model));
  const launch = protocol.tvl_usd * multiple * growthMult * maturityMult;
  const implied = Math.max(1, Math.round(launch * model.token_odds * model.own_token_share));
  return { implied, launch, multiple, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** One scored protocol: its slug and implied value, strongest first. */
interface ScoredRow {
  slug: string;
  implied: number;
}

/** The chosen protocols scored and ranked, strongest first (ties broken by slug, deterministic). */
function scoreRows(snapshot: Snapshot, fit: FittedModel, model: ModelConstants): ScoredRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  const scored: ScoredRow[] = [...chosen.values()].map((p) => ({
    slug: p.slug,
    implied: impliedValue(p, snapshot.as_of, fit, model).implied,
  }));
  scored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return scored;
}

/** Rank bands from bootstrap refits: each row's 10th and 90th percentile rank over refits. */
function rankBands(snapshot: Snapshot, fit: FittedModel, model: ModelConstants): Map<string, [number, number]> {
  const comps = cleanComps(snapshot);
  const base = scoreRows(snapshot, fit, model);
  const ranks = new Map<string, number[]>();
  for (const r of base) ranks.set(r.slug, []);
  const rand = mulberry32(BOOTSTRAP_SEED);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const refit = fitFromComps(sample);
    const scored = scoreRows(snapshot, refit, model);
    scored.forEach((r, i) => ranks.get(r.slug)!.push(i + 1));
  }
  const bands = new Map<string, [number, number]>();
  for (const [slug, list] of ranks.entries()) {
    const s = [...list].sort((x, y) => x - y);
    const lo = s[Math.floor(0.1 * (s.length - 1))]!;
    const hi = s[Math.floor(0.9 * (s.length - 1))]!;
    bands.set(slug, [lo, hi]);
  }
  return bands;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Whole dollars, with commas; under $10, two decimals; negatives keep their sign. */
function usd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 10) return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
  return `${sign}$${a.toFixed(2)}`;
}

/** The netted verdict for one row: expected airdrop against the plan's cost, with its break-even. */
export function farmVerdict(implied: number, capital: number, hold: number, model: ModelConstants): FarmVerdict {
  const gas = 8 + 2 * Math.ceil(hold / 7);
  const opportunity = capital * model.capital_apr * (hold / 365);
  const cost = gas + opportunity;
  const expected = (implied * model.airdrop_share) / model.airdrop_farmers;
  const net = expected - cost;
  const verdict = net > 100 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  const breakEven = Math.ceil(cost / (model.airdrop_share / model.airdrop_farmers));
  return { verdict, expected_usd: expected, cost_usd: cost, net_usd: net, break_even_usd: breakEven, capital_usd: capital, hold_days: hold, gas_usd: gas };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** What can go wrong for this row, from its own category. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a rate spike or a liquidation if your collateral falls; check the health factor every week.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'impermanent loss if the pool ratio moves against you, and points dilution if the farm gets crowded.';
  if (c.includes('bridge')) return 'the bridged funds sit on another chain; a bridge pause strands them until it reopens.';
  if (c.includes('staking') || c.includes('restak')) return 'the receipt token can trade below its peg, and slashing or a validator fault cuts the stake.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'a hedge that moves the wrong way costs more than the points are worth; keep it small.';
  if (c.includes('rwa')) return 'the underlying asset issuer can freeze redemptions; read the redemption terms first.';
  if (c.includes('stable')) return 'a depeg of the stable asset wipes the position value; check the peg history first.';
  if (c.includes('insurance')) return 'a claim can be denied on a wording technicality; read the cover terms before you buy.';
  return 'points dilution if the farm gets crowded, and a snapshot you miss by withdrawing early.';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, ending in a netted
 * verdict and a risk line. Every step is generated from the protocol's own record (category,
 * chains, TVL, age) and the model's verdict — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, verdict: FarmVerdict): FarmStep[] {
  const chain = chainOf(p);
  const capital = verdict.capital_usd;
  const hold = verdict.hold_days;
  const action = actionFor(p, capital, chain);
  const verdictLine =
    verdict.verdict === 'FARM'
      ? `Verdict: FARM. Expected airdrop about ${usd(verdict.expected_usd)} against about ${usd(verdict.cost_usd)} of gas and opportunity cost, net about ${usd(verdict.net_usd)}. Break-even at an implied value of ${usd(verdict.break_even_usd)}.`
      : verdict.verdict === 'THIN'
        ? `Verdict: THIN. Expected airdrop about ${usd(verdict.expected_usd)} against about ${usd(verdict.cost_usd)} of gas and opportunity cost, net about ${usd(verdict.net_usd)} — worth it only if you farm more than one position like this. Break-even at an implied value of ${usd(verdict.break_even_usd)}.`
        : `Verdict: SKIP. Expected airdrop about ${usd(verdict.expected_usd)} against about ${usd(verdict.cost_usd)} of gas and opportunity cost, net about ${usd(verdict.net_usd)} — the position costs more than the airdrop is worth. Break-even at an implied value of ${usd(verdict.break_even_usd)}.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: verdictLine,
      cost: `about ${usd(verdict.cost_usd)} in total`,
      time: `${hold} days all in`,
    },
    {
      text: `What can go wrong: ${riskFor(p)}`,
      cost: 'nothing but attention',
      time: '5 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n and farm plans. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitFromComps(cleanComps(snapshot));
  const scored = scoreRows(snapshot, fit, model);
  const bands = rankBands(snapshot, fit, model);
  const index = bySlug(snapshot.protocols);
  return scored.map((s, i) => {
    const p = index.get(s.slug)!;
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const verdict = farmVerdict(v.implied, capitalFor(p), holdDaysFor(v.age), model);
    const band = bands.get(s.slug) ?? [i + 1, i + 1];
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: v.age,
      implied_value_usd: v.implied,
      model: {
        base_multiple: round4(v.multiple),
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        maturity_multiplier: round4(v.maturityMult),
        age_days: v.age,
        token_odds: model.token_odds,
        own_token_share: model.own_token_share,
        rank_band_low: band[0],
        rank_band_high: band[1],
        verdict: verdict.verdict,
        expected_airdrop_usd: Math.round(verdict.expected_usd * 100) / 100,
        farm_cost_usd: Math.round(verdict.cost_usd * 100) / 100,
        net_usd: Math.round(verdict.net_usd * 100) / 100,
        break_even_usd: verdict.break_even_usd,
      },
      farm_steps: farmSteps(p, v.age, verdict).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with farm plans generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    base_multiple: row.model.base_multiple,
    token_odds: row.model.token_odds,
    own_token_share: row.model.own_token_share,
    rank_band_low: row.model.rank_band_low,
    rank_band_high: row.model.rank_band_high,
    verdict: row.model.verdict,
    expected_airdrop_usd: row.model.expected_airdrop_usd,
    farm_cost_usd: row.model.farm_cost_usd,
    net_usd: row.model.net_usd,
    break_even_usd: row.model.break_even_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation: VALIDATION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
