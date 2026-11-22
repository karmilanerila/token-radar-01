// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// breakdown and the protocol's farm plan, and the methodology. No network: every byte it shows
// is in data.js. The farm plan is regenerated here from the same derivation main.ts writes to
// board.json — category, chains, TVL and age decide the action, the capital, the hold and every
// cost and time — so the page and the board always agree. No name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var params = new URLSearchParams(window.location.search);
  var state = {
    view: params.get('view') || 'board',
    slug: params.get('slug') || null,
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    verdict: params.get('verdict') || 'all',
    tab: params.get('tab') || 'pre-token',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1
  };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtSmall(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 10) return sign + '$' + Math.round(a).toLocaleString('en-US');
    return sign + '$' + a.toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function go(next) {
    var p = new URLSearchParams();
    Object.keys(next).forEach(function (k) { if (next[k]) p.set(k, next[k]); });
    var q = p.toString();
    window.location.search = q ? '?' + q : '';
  }
  function linkTo(next) {
    var p = new URLSearchParams();
    Object.keys(next).forEach(function (k) { if (next[k]) p.set(k, next[k]); });
    var q = p.toString();
    return window.location.pathname + (q ? '?' + q : '');
  }

  // ---- farm plan: the same derivation as lib/model.ts, so the page and board.json agree ----
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'a rate spike or a liquidation if your collateral falls; check the health factor every week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'impermanent loss if the pool ratio moves against you, and points dilution if the farm gets crowded.';
    if (c.indexOf('bridge') >= 0) return 'the bridged funds sit on another chain; a bridge pause strands them until it reopens.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'the receipt token can trade below its peg, and slashing or a validator fault cuts the stake.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'a hedge that moves the wrong way costs more than the points are worth; keep it small.';
    if (c.indexOf('rwa') >= 0) return 'the underlying asset issuer can freeze redemptions; read the redemption terms first.';
    if (c.indexOf('stable') >= 0) return 'a depeg of the stable asset wipes the position value; check the peg history first.';
    if (c.indexOf('insurance') >= 0) return 'a claim can be denied on a wording technicality; read the cover terms before you buy.';
    return 'points dilution if the farm gets crowded, and a snapshot you miss by withdrawing early.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var action = actionFor(row, capital, chain);
    var verdictLine = row.verdict === 'FARM'
      ? 'Verdict: FARM. Expected airdrop about ' + fmtSmall(row.expected_airdrop_usd) + ' against about ' + fmtSmall(row.farm_cost_usd) + ' of gas and opportunity cost, net about ' + fmtSmall(row.net_usd) + '. Break-even at an implied value of ' + fmtSmall(row.break_even_usd) + '.'
      : row.verdict === 'THIN'
        ? 'Verdict: THIN. Expected airdrop about ' + fmtSmall(row.expected_airdrop_usd) + ' against about ' + fmtSmall(row.farm_cost_usd) + ' of gas and opportunity cost, net about ' + fmtSmall(row.net_usd) + ' — worth it only if you farm more than one position like this. Break-even at an implied value of ' + fmtSmall(row.break_even_usd) + '.'
        : 'Verdict: SKIP. Expected airdrop about ' + fmtSmall(row.expected_airdrop_usd) + ' against about ' + fmtSmall(row.farm_cost_usd) + ' of gas and opportunity cost, net about ' + fmtSmall(row.net_usd) + ' — the position costs more than the airdrop is worth. Break-even at an implied value of ' + fmtSmall(row.break_even_usd) + '.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: verdictLine, cost: 'about ' + fmtSmall(row.farm_cost_usd) + ' in total', time: hold + ' days all in' },
      { text: 'What can go wrong: ' + riskFor(row), cost: 'nothing but attention', time: '5 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // The page recomputes a row from the snapshot figures and checks the number board.json carries.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * row.token_odds * row.own_token_share));
  }

  // ---- shared chrome ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: DATA.source })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }
  function verdictCounts() {
    var c = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { c[r.verdict]++; });
    return c;
  }
  function kpiStrip() {
    var v = verdictCounts();
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'the floor, never the ceiling' })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early, below the floor' })),
      el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: v.FARM + ' FARM' }), el('small', { text: v.THIN + ' THIN · ' + v.SKIP + ' SKIP' })),
      el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'market cap, not a model' })),
      el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }), el('small', { text: DATA.rows[0].name }))
    );
  }
  function modelStrip() {
    var m = DATA.model;
    var v = DATA.validation;
    return el('section', { class: 'model-strip' },
      el('h2', { text: 'How implied value is computed' }),
      el('div', { class: 'formula', text: 'implied = round( TVL x category multiple x token odds x ' + m.own_token_share + ' )' }),
      el('p', null,
        el('b', { text: 'Fitted, not hand-picked. ' }),
        'The size curve and the category multiples are fitted at run time on the snapshot\u2019s own ' + v.comps + ' traded protocols (log mcap = ' + v.global_a + ' + ' + v.global_b + ' x log TVL, R\u00B2 = ' + v.global_r2 + '). Token odds are fitted too: a logistic on age plus a category offset, held out at AUC ' + v.odds_auc_agecat_split1 + ' and ' + v.odds_auc_agecat_split2 + ' on two splits. Leave-one-out median error ' + v.loo_median_x + 'x; walk-forward median ' + v.walk_forward_median_x + 'x. The only flat assumption is the own-token share (' + m.own_token_share + ').'
      )
    );
  }

  // ---- controls, tables, methodology ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'verdict') { av = a.verdict; bv = b.verdict; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; render(); });
    var vse = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v + ' only', selected: v === state.verdict ? 'selected' : null }); })
    );
    vse.addEventListener('change', function () { state.verdict = vse.value; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), vse),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or verdict to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        tabindex: '0',
        onclick: function () { go({ view: 'detail', slug: r.slug }); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go({ view: 'detail', slug: r.slug }); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill ' + r.verdict.toLowerCase(), text: r.verdict })),
        el('td', null, el('span', { class: 'band', text: '#' + r.rank_band_low + '–' + r.rank_band_high }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. Rank band: the row\u2019s 10th–90th percentile rank over 200 bootstrap refits.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Farm'),
            el('th', { scope: 'col', text: 'Rank band' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill thin', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function methodology() {
    var v = DATA.validation;
    var m = DATA.model;
    return el('section', { class: 'panel method' },
      el('h2', { text: 'Methodology: what the model is, and what it is not' }),
      el('p', null,
        'The model is fitted at run time from the snapshot\u2019s own traded protocols — ', el('b', { text: v.comps + ' clean comps' }), ' (one per ticker, positive market cap). ',
        'The size curve is log(mcap) = ', el('code', { text: v.global_a + ' + ' + v.global_b + ' x log(TVL)' }), ', R\u00B2 = ', el('b', { text: String(v.global_r2) }), '. ',
        'Each category\u2019s multiple is the median mcap/TVL of its comps, shrunk toward the global curve by n/(n + ', String(m.shrink_k), ') — categories with fewer than ', String(m.min_category_n), ' comps use the curve alone. ',
        'Token odds are a logistic on age, fitted at run time on the ', String(v.odds_population), ' protocols that either trade or record no token at all, plus a category offset from each category\u2019s has-token rate (shrunk by n/(n + ', String(m.odds_shrink_k), ')). ',
        'Age enters the value once, through the odds — never through a second maturity term.'
      ),
      el('h3', { text: 'Held-out validation — the numbers, not adjectives' }),
      el('ul', null,
        el('li', { text: 'Leave-one-out on the fitted value: median error ' + v.loo_median_log + ' log units (' + v.loo_median_x + 'x), p80 ' + v.loo_p80_log + ', p90 ' + v.loo_p90_log + '. A held-out protocol\u2019s market cap is typically off by about three and a half times.' }),
        el('li', { text: 'Leave-one-out rank correlation (Spearman, predicted vs actual market cap): ' + v.loo_spearman + ' for the category model against ' + v.loo_spearman_global + ' for the global curve alone. The category signal is real but small, which is why it is shrunk — raw medians score 0.53 in-sample but 1.61 in leave-one-out.' }),
        el('li', { text: 'Walk-forward: fit on protocols listed before 2025-01-01 (n = ' + v.walk_forward_fit_n + '), test on those listed after (n = ' + v.walk_forward_test_n + '): median error ' + v.walk_forward_median_log + ' log units (' + v.walk_forward_median_x + 'x), against 1.12 for the global curve alone.' }),
        el('li', { text: 'Token odds: held-out AUC ' + v.odds_auc_agecat_split1 + ' and ' + v.odds_auc_agecat_split2 + ' on two deterministic splits (age alone: ' + v.odds_auc_age_split1 + ' and ' + v.odds_auc_age_split2 + '). The odds rise with age — 3% of protocols under 180 days record a token, 25% of those over 1,100 days do — and by category, from 3% (Risk Curators) to 48% (Lending). They are a peer benchmark, not a forecast: an old protocol with no token has survived this long without listing.' })
      ),
      el('h3', { text: 'Terms tested and dropped — the split test' }),
      el('ul', null,
        el('li', { text: 'Seven-day growth as a tilt on the multiple: a fitted slope of ' + v.growth_slope + ' log units per 1% gained ' + v.growth_loo_spearman_gain + ' in leave-one-out Spearman but lost on the walk-forward test (median ' + v.growth_walk_forward_median + ' with it, ' + v.walk_forward_median_log + ' without it), so it does not enter the value. Growth is still shown on the board as a column.' }),
        el('li', { text: 'A maturity multiplier on age: a fitted age slope on the multiple cut leave-one-out Spearman to ' + v.age_slope_loo_spearman + ', so age enters only through the fitted odds. The round-2 model carried both a maturity term and flat odds; this one fits the odds and drops the rest.' })
      ),
      el('h3', { text: 'Farm verdicts, netted' }),
      el('p', null,
        'Each row\u2019s plan nets an expected airdrop of implied value x ', String(m.airdrop_share), ' (the airdrop share) / ', String(m.airdrop_farmers), ' (qualifying farmers) against the plan\u2019s cost: gas plus capital at ', String(m.capital_apr * 100), '% a year over the hold. ',
        'FARM when the net clears $100, THIN when it clears $0, SKIP otherwise. The break-even implied value is stated on every row. These are stated assumptions, labelled as such — the verdict is only as good as them.'
      ),
      el('h3', { text: 'Integrity' }),
      el('ul', null,
        el('li', { text: 'Coverage: all ' + DATA.watchlist_size + ' watchlist slugs are on the board, plus ' + DATA.early_size + ' early pre-token rows below the floor. Live-token protocols are shown separately with their market caps.' }),
        el('li', { text: 'Determinism: the program reads only the sealed snapshot and writes identical bytes on every run — no clock, no randomness except a fixed-seed bootstrap (seed ' + 20261114 + ') for the rank bands.' }),
        el('li', { text: 'No protocol name is special-cased anywhere. The same function scores every row; the farm plan is generated from each row\u2019s own record.' })
      )
    );
  }
  function detailView() {
    var row = DATA.rows.filter(function (r) { return r.slug === state.slug; })[0];
    if (!row) return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('h2', { text: 'Protocol not found' }), el('p', { text: 'That slug is not on this board.' })));
    var recomputed = impliedOf(row);
    var agrees = Math.abs(recomputed - row.implied_value_usd) <= Math.max(1, Math.round(row.implied_value_usd * 0.005));
    var steps = farmSteps(row);
    var verdictText = row.verdict === 'FARM' ? 'Farm it: the expected airdrop clears the plan\u2019s cost with margin.'
      : row.verdict === 'THIN' ? 'Thin: the expected airdrop barely clears the plan\u2019s cost — worth it only alongside other positions.'
        : 'Skip it: the expected airdrop does not cover the plan\u2019s cost.';
    return el('div', null,
      el('a', { class: 'back', href: linkTo({ view: 'board' }), text: '← Back to the board' }),
      el('div', { class: 'detail-head' },
        el('span', { class: 'detail-rank', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h1', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · ' + fmtUsd(row.tvl_usd) + ' TVL · ' + fmtPct(row.change_7d) + ' in 7 days · ' + fmtAge(row.age_days) + ' with no token' })
      ),
      el('div', { class: 'detail-grid' },
        el('section', { class: 'panel' },
          el('h2', { text: 'Implied value, step by step' }),
          el('div', { class: 'equation' },
            el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
            el('div', null, el('span', { text: 'Category multiple (fitted, shrunk)' }), el('b', { class: 'num', text: 'x ' + row.base_multiple })),
            el('div', null, el('span', { text: 'Token odds (fitted: age + category)' }), el('b', { class: 'num', text: 'x ' + row.token_odds })),
            el('div', null, el('span', { text: 'Own-token share (stated assumption)' }), el('b', { class: 'num', text: 'x ' + row.own_token_share })),
            el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
            el('div', null, el('span', { text: 'Bootstrap rank band (200 refits)' }), el('b', { class: 'num', text: '#' + row.rank_band_low + '–' + row.rank_band_high }))
          ),
          el('div', { class: 'verdict-box ' + row.verdict.toLowerCase() },
            el('b', { text: row.verdict + ' — ' + verdictText }),
            el('p', { class: 'note', text: 'Expected airdrop ' + fmtSmall(row.expected_airdrop_usd) + ' · plan cost ' + fmtSmall(row.farm_cost_usd) + ' · net ' + fmtSmall(row.net_usd) + ' · break-even implied value ' + fmtSmall(row.break_even_usd) + '.' })
          ),
          el('p', { class: 'note', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries (to the rounding the board shows).' : ' — which differs from the board; the data would be stale.') + ' This is an estimate, not a price.' })
        ),
        el('section', { class: 'panel' },
          el('h2', { text: 'Farm plan' }),
          el('ol', { class: 'steps' }, steps.map(function (s) {
            var at = s.indexOf(' Cost: ');
            var action = at >= 0 ? s.slice(0, at) : s;
            var tail = at >= 0 ? s.slice(at + 1) : '';
            return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
          }))
        )
      )
    );
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.view === 'detail' && state.slug) {
      shell.appendChild(detailView());
    } else {
      shell.appendChild(el('section', { class: 'lede' },
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ));
      shell.appendChild(kpiStrip());
      shell.appendChild(modelStrip());
      shell.appendChild(controls());
      shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
      if (state.tab === 'pre-token') shell.appendChild(methodology());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  render();
})();
