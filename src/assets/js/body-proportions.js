/* Body Proportions Calculator — bodyshapecalculator.net
   Runs entirely in the browser. Nothing is uploaded or stored. */
(function () {
  'use strict';
  var root = document.getElementById('bp-app');
  if (!root) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var IN = 2.54;

  var FIELDS = [
    { k: 'height',    core: true,  label: 'Height',                 min: 48, max: 96,  tip: 'Standing straight against a wall, barefoot.' },
    { k: 'waist',     core: true,  label: 'Waist',                  min: 18, max: 80,  tip: 'Narrowest part of the torso, usually just above the navel.' },
    { k: 'hips',      core: true,  label: 'Hips',                   min: 24, max: 90,  tip: 'Fullest part of the hips and buttocks, feet together.' },
    { k: 'bust',      core: false, label: 'Bust',  labelM: 'Chest', min: 24, max: 80,  tip: 'Fullest part of the bust (women) or chest (men), tape level across the back.' },
    { k: 'shoulders', core: false, label: 'Shoulder circumference', min: 30, max: 80,  tip: 'Around the widest point of the shoulders, over the deltoids, arms relaxed.' },
    { k: 'inseam',    core: false, label: 'Inseam',                 min: 18, max: 48,  tip: 'Crotch to floor along the inside of the leg, barefoot.' },
    { k: 'span',      core: false, label: 'Arm span',               min: 48, max: 100, tip: 'Fingertip to fingertip with arms stretched out to the sides.' },
    { k: 'head',      core: false, label: 'Head height',            min: 6,  max: 14,  tip: 'From the chin to the top of the head.' }
  ];
  var state = { sex: 'f', units: 'in', v: {} };
  FIELDS.forEach(function (f) { state.v[f.k] = ''; });
  var el = {};
  var SHAPES = {
    hourglass: ['Hourglass', '/hourglass-body-shape/'], top_hourglass: ['Top Hourglass', '/hourglass-body-shape/'],
    bottom_hourglass: ['Bottom Hourglass', '/hourglass-body-shape/'], triangle: ['Pear (Triangle)', '/pear-body-shape/'],
    apple: ['Apple', '/apple-body-shape/'], inverted_triangle: ['Inverted Triangle', '/inverted-triangle-body-shape/'],
    rectangle: ['Rectangle', '/'], trapezoid: ['Trapezoid', '/male-body-type-calculator/'],
    m_inverted: ['Inverted Triangle', '/male-body-type-calculator/'], m_triangle: ['Triangle', '/male-body-type-calculator/'],
    oval: ['Oval', '/male-body-type-calculator/'], m_rectangle: ['Rectangle', '/male-body-type-calculator/']
  };
  // Same rules (inches) as the site's body type calculators
  function shapeF(B, W, H) {
    var bh = B - H, hb = H - B, bw = B - W, hw = H - W;
    if (bh <= 1 && hb < 3.6 && (bw >= 9 || hw >= 10)) return 'hourglass';
    if (hb >= 3.6 && hb < 10 && hw >= 9) return 'bottom_hourglass';
    if (bh > 1 && bh < 10 && bw >= 9) return 'top_hourglass';
    if (Math.abs(B - H) < 3.6 && W >= B - 2 && W >= H - 2) return 'apple';
    if (hb >= 3.6 && hw < 9) return 'triangle';
    if (bh >= 3.6 && bw < 9) return 'inverted_triangle';
    return 'rectangle';
  }
  function shapeM(C, W, H) {
    var ch = C - H, hc = H - C, cw = C - W;
    if (ch >= 3 && cw >= 7) return 'trapezoid';
    if (ch >= 3) return 'm_inverted';
    if (hc >= 3) return 'm_triangle';
    if (Math.abs(ch) < 3 && W >= C - 2 && W >= H - 2) return 'oval';
    return 'm_rectangle';
  }

  /* ---------- helpers ---------- */
  function unitLbl() { return state.units === 'in' ? 'in' : 'cm'; }
  function num(v, d) { return String(+v.toFixed(d == null ? 1 : d)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inches(k) {                      // value in inches or null
    var raw = state.v[k]; if (raw === '' || raw == null) return null;
    var n = parseFloat(raw); if (!isFinite(n)) return null;
    var v = state.units === 'in' ? n : n / IN;
    var f = FIELDS.filter(function (x) { return x.k === k; })[0];
    if (v < f.min - 0.001 || v > f.max + 0.001) return null;
    return v;
  }
  function fmtLen(inch) { return state.units === 'in' ? num(inch, 1) + ' in' : num(inch * IN, 1) + ' cm'; }
  function feetIn(inch) { var t = Math.round(inch), f = Math.floor(t / 12); return f + '\u2032' + (t - f * 12) + '\u2033'; }
  function pct(v, a, b) { return Math.max(0, Math.min(100, (v - a) / (b - a) * 100)); }

  /* ---------- gauge ---------- */
  function gauge(min, max, zones, value, ticks, fmt) {
    var z = zones.map(function (q) {
      return '<span class="bp-z bp-z-' + q.c + '" style="left:' + pct(q.a, min, max) + '%;width:' + (pct(q.b, min, max) - pct(q.a, min, max)) + '%"></span>';
    }).join('');
    var t = (ticks || []).map(function (q) {
      return '<span class="bp-tick" style="left:' + pct(q.at, min, max) + '%"><i></i><em>' + esc(q.label) + '</em></span>';
    }).join('');
    return '<div class="bp-gauge" role="img" aria-label="Your value ' + esc(fmt(value)) + ' on a scale from ' + esc(fmt(min)) + ' to ' + esc(fmt(max)) + '">' +
      '<div class="bp-zones">' + z + '</div>' + t + '<span class="bp-marker" style="left:' + pct(value, min, max) + '%"></span></div>' +
      '<div class="bp-scale"><span>' + esc(fmt(min)) + '</span><span>' + esc(fmt(max)) + '</span></div>';
  }
  function card(title, value, tag, tagCls, gaugeHtml, note, formula) {
    return '<article class="bp-card"><header><h3>' + esc(title) + '</h3>' + (tag ? '<span class="bp-tag bp-tag-' + (tagCls || 'n') + '">' + esc(tag) + '</span>' : '') + '</header>' +
      '<div class="bp-val">' + value + '</div>' + (gaugeHtml || '') +
      (note ? '<p class="bp-note">' + note + '</p>' : '') + (formula ? '<p class="bp-formula">' + formula + '</p>' : '') + '</article>';
  }

  /* ---------- calculation ---------- */
  function compute() {
    var H = inches('height'), W = inches('waist'), P = inches('hips'), B = inches('bust'), S = inches('shoulders'),
        L = inches('inseam'), A = inches('span'), D = inches('head'), male = state.sex === 'm';
    var groups = [], sum = {}, chips = [];

    var health = '';
    if (W && P) {
      var whr = W / P, thr = male ? 0.90 : 0.85, above = whr > thr;
      health += card('Waist-to-hip ratio (WHR)', whr.toFixed(2), above ? 'Above WHO reference' : 'At or below WHO reference', above ? 'mid' : 'ok',
        gauge(0.60, 1.10, [{ a: 0.60, b: thr, c: 'ok' }, { a: thr, b: 1.10, c: 'mid' }], whr, [{ at: thr, label: thr.toFixed(2) }], function (x) { return x.toFixed(2); }),
        'WHO: a WHR above ' + thr.toFixed(2) + ' for ' + (male ? 'men' : 'women') + ' indicates abdominal obesity. It is one indicator, not a diagnosis.',
        'waist \u00f7 hips = ' + num(W, 1) + ' \u00f7 ' + num(P, 1));
      sum.hips = Math.round(whr * 100); chips.push(['WHR', whr.toFixed(2)]);
    }
    if (W && H) {
      var whtr = W / H, band = whtr < 0.40 ? ['Below 0.40', 'lo'] : whtr < 0.50 ? ['Healthy range', 'ok'] : whtr < 0.60 ? ['Increased', 'mid'] : ['High', 'hi'];
      health += card('Waist-to-height ratio (WHtR)', whtr.toFixed(2), band[0], band[1],
        gauge(0.30, 0.70, [{ a: 0.30, b: 0.40, c: 'lo' }, { a: 0.40, b: 0.50, c: 'ok' }, { a: 0.50, b: 0.60, c: 'mid' }, { a: 0.60, b: 0.70, c: 'hi' }], whtr, [{ at: 0.5, label: '0.50' }], function (x) { return x.toFixed(2); }),
        'The rule of thumb: keep your waist under half your height (below 0.50). Bands: 0.40\u20130.49 healthy, 0.50\u20130.59 increased, 0.60+ high.',
        'waist \u00f7 height = ' + num(W, 1) + ' \u00f7 ' + num(H, 1));
      sum.height = Math.round(whtr * 100); chips.push(['WHtR', whtr.toFixed(2)]);
    }
    if (health) groups.push(['Health ratios', health]);

    var shape = '';
    var bl = male ? 'Chest' : 'Bust';
    if (B && W) {
      var r = B / W, diff = B - W;
      shape += card(bl + '-to-waist ratio', r.toFixed(2), '', '',
        gauge(1.0, 1.8, [{ a: 1.0, b: 1.8, c: 'n' }], r, [], function (x) { return x.toFixed(1); }),
        'Your ' + bl.toLowerCase() + ' is ' + num(Math.abs(diff), 1) + ' ' + unitLbl() + ' ' + (diff >= 0 ? 'larger' : 'smaller') + ' than your waist. A bigger number means a bigger step in from ' + bl.toLowerCase() + ' to waist. There is no \u201ccorrect\u201d value.',
        bl.toLowerCase() + ' \u00f7 waist = ' + num(B, 1) + ' \u00f7 ' + num(W, 1));
    }
    if (B && P) {
      var bh = B / P, bal = Math.abs(bh - 1) <= 0.05, tag = bal ? 'Balanced (within 5%)' : (bh > 1 ? bl + ' larger' : 'Hips larger');
      shape += card(bl + '-to-hip ratio', bh.toFixed(2), tag, bal ? 'ok' : 'n',
        gauge(0.80, 1.30, [{ a: 0.95, b: 1.05, c: 'ok' }], bh, [{ at: 1.0, label: '1.00' }], function (x) { return x.toFixed(2); }),
        'Near 1.00 means your ' + bl.toLowerCase() + ' and hips are close in size, the foundation of hourglass, apple and rectangle shapes.',
        bl.toLowerCase() + ' \u00f7 hips = ' + num(B, 1) + ' \u00f7 ' + num(P, 1));
    }
    if (B && W && P) {
      var key = male ? shapeM(B, W, P) : shapeF(B, W, P), sh = SHAPES[key];
      shape += card('Body shape', '<span class="bp-shape">' + esc(sh[0]) + '</span>', '', '', '',
        'Named with the same rules as our ' + (male ? '<a href="/male-body-type-calculator/">male body type calculator</a>' : '<a href="/">body type calculator</a>') + '. <a href="' + sh[1] + '">Read the ' + esc(sh[0]) + ' guide \u2192</a>', '');
      chips.push(['Shape', sh[0]]);
    }
    if (S && W) {
      var ad = S / W, gr = 1.618;
      shape += card('Shoulder-to-waist ratio (Adonis index)', ad.toFixed(2), Math.round(ad / gr * 100) + '% of 1.618', 'n',
        gauge(1.1, 1.8, [{ a: 1.1, b: 1.8, c: 'n' }], ad, [{ at: gr, label: '1.618' }], function (x) { return x.toFixed(1); }),
        'A popular fitness reference: shoulders 1.618\u00d7 the waist (the golden ratio). It has no health significance; treat it as a curiosity, not a goal.',
        'shoulders \u00f7 waist = ' + num(S, 1) + ' \u00f7 ' + num(W, 1));
    }
    if (shape) groups.push(['Shape ratios', shape]);

    var len = '';
    if (L && H) {
      var lr = L / H, lt = lr < 0.43 ? ['Shorter legs than typical', 'n'] : lr > 0.48 ? ['Longer legs than typical', 'n'] : ['Typical range', 'ok'];
      len += card('Leg length (inseam \u00f7 height)', Math.round(lr * 1000) / 10 + '%', lt[0], lt[1],
        gauge(0.38, 0.54, [{ a: 0.43, b: 0.48, c: 'ok' }], lr, [{ at: 0.45, label: '45%' }], function (x) { return Math.round(x * 100) + '%'; }),
        'Inseam is commonly around 45% of height (roughly 43\u201348%). Your upper body (height minus inseam) is ' + Math.round((1 - lr) * 100) + '% of your height. Both are normal across a wide range.',
        'inseam \u00f7 height = ' + num(L, 1) + ' \u00f7 ' + num(H, 1));
      sum.legs = Math.round(lr * 100); chips.push(['Legs', Math.round(lr * 100) + '%']);
    }
    if (A && H) {
      var ar = A / H, at = ar < 0.95 ? ['Span shorter than height', 'n'] : ar > 1.05 ? ['Span longer than height', 'n'] : ['Close to 1.00', 'ok'];
      len += card('Arm span-to-height ratio', ar.toFixed(2), at[0], at[1],
        gauge(0.90, 1.10, [{ a: 0.95, b: 1.05, c: 'ok' }], ar, [{ at: 1.0, label: '1.00' }], function (x) { return x.toFixed(2); }),
        'Leonardo\u2019s Vitruvian Man has arm span equal to height. In real adults the ratio is usually within a few percent of 1.00.',
        'arm span \u00f7 height = ' + num(A, 1) + ' \u00f7 ' + num(H, 1));
    }
    if (D && H) {
      var hd = H / D, ht = hd < 7 ? ['Under 7 heads', 'n'] : hd > 8 ? ['Over 8 heads', 'n'] : ['Between 7 and 8 heads', 'ok'];
      len += card('Heads tall', num(hd, 1) + ' heads', ht[0], ht[1],
        gauge(6, 9, [{ a: 7, b: 8, c: 'ok' }], hd, [{ at: 7.5, label: '7.5' }], function (x) { return num(x, 0); }),
        'Artists commonly draw realistic adults about 7.5 heads tall and idealized figures 8 heads tall. See the head-unit chart below.',
        'height \u00f7 head height = ' + num(H, 1) + ' \u00f7 ' + num(D, 1));
      chips.push(['Heads', num(hd, 1)]);
    }
    if (len) groups.push(['Body-length ratios', len]);
    return { groups: groups, sum: sum, chips: chips };
  }

  /* ---------- render ---------- */
  function render() {
    var res = compute();
    if (!res.groups.length) {
      el.results.innerHTML = '<div class="bp-empty"><h3>Enter your measurements to see your ratios</h3><p>Start with <strong>height</strong>, <strong>waist</strong> and <strong>hips</strong>. Each optional field unlocks another ratio: bust or chest (bust-to-waist, body shape), shoulders (Adonis index), inseam (leg length), arm span and head height.</p><p><button type="button" class="bp-btn" data-act="example">Load an example</button></p></div>';
      el.strip.innerHTML = '<span class="bp-strip-empty">Enter height, waist and hips to see your ratios</span>';
    } else {
      var h = '';
      var sm = res.sum, parts = [];
      if (sm.hips || sm.height) parts.push('Your waist is ' + [sm.hips ? sm.hips + '% of your hip size' : '', sm.height ? sm.height + '% of your height' : ''].filter(Boolean).join(' and '));
      if (sm.legs) parts.push('your legs are ' + sm.legs + '% of your height');
      if (parts.length) h += '<p class="bp-summary" aria-live="polite"><strong>In short:</strong> ' + esc(parts.join('; ')) + '.</p>';
      res.groups.forEach(function (g) { h += '<p class="bp-group">' + esc(g[0]) + '</p><div class="bp-cards">' + g[1] + '</div>'; });
      el.results.innerHTML = h;
      el.strip.innerHTML = res.chips.slice(0, 3).map(function (c) { return '<span class="bp-chip"><i>' + esc(c[0]) + '</i><b>' + esc(c[1]) + '</b></span>'; }).join('');
    }
    // 3D link + share link
    var lnk = threeDLink();
    el.three.setAttribute('href', lnk || '/body-visualizer/');
    el.three.classList.toggle('is-off', !lnk);
    syncHash();
  }

  function threeDLink() {
    var H = inches('height'); if (!H) return null;
    function cm(k) { var v = inches(k); return v == null ? '' : num(v * IN, 1); }
    var a = [num(H * IN, 1), '', cm('bust'), cm('waist'), cm('hips'), '', cm('inseam'), '', '', ''].join(',');
    return '/body-visualizer/#v=1&sx=' + state.sex + '&sb=' + state.sex + '&u=' + (state.units === 'in' ? 'i' : 'm') + '&md=single&c=0&ang=0&a=' + a;
  }

  /* ---------- inputs ---------- */
  function buildInputs() {
    FIELDS.forEach(function (f) {
      var host = f.core ? el.core : el.more;
      var d = document.createElement('div'); d.className = 'bp-field';
      d.innerHTML = '<div class="bp-ftop"><label for="bp-i-' + f.k + '"></label><button type="button" class="bp-tipbtn" aria-expanded="false" aria-controls="bp-t-' + f.k + '">?</button>' +
        '<div class="bp-iw"><input id="bp-i-' + f.k + '" type="number" inputmode="decimal" step="any" autocomplete="off" placeholder="\u2014"><span class="bp-unit"></span></div></div>' +
        '<p class="bp-tip" id="bp-t-' + f.k + '" hidden></p><p class="bp-err" hidden></p><p class="bp-help"></p>';
      host.appendChild(d);
      var r = f.ui = { root: d, lbl: $('label', d), inp: $('input', d), unit: $('.bp-unit', d), tip: $('.bp-tip', d), btn: $('.bp-tipbtn', d), err: $('.bp-err', d), help: $('.bp-help', d) };
      r.btn.addEventListener('click', function () { var o = r.btn.getAttribute('aria-expanded') === 'true'; r.btn.setAttribute('aria-expanded', o ? 'false' : 'true'); r.tip.hidden = o; });
      r.inp.addEventListener('input', function () { state.v[f.k] = r.inp.value; validate(f); render(); });
    });
  }
  function validate(f) {
    var raw = state.v[f.k], r = f.ui;
    if (raw === '' || raw == null) { r.err.hidden = true; r.inp.removeAttribute('aria-invalid'); }
    else {
      var n = parseFloat(raw), ok = isFinite(n) && inches(f.k) != null;
      r.err.hidden = ok; r.inp.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok) {
        var lo = state.units === 'in' ? f.min : Math.ceil(f.min * IN), hi = state.units === 'in' ? f.max : Math.floor(f.max * IN);
        r.err.textContent = 'Enter a value between ' + lo + ' and ' + hi + ' ' + unitLbl() + '.';
      }
    }
    if (f.k === 'height') { var hv = inches('height'); r.help.textContent = hv && state.units === 'in' ? feetIn(hv) : ''; }
  }
  function syncLabels() {
    FIELDS.forEach(function (f) {
      var r = f.ui;
      r.lbl.textContent = (state.sex === 'm' && f.labelM) ? f.labelM : f.label;
      r.unit.textContent = unitLbl();
      r.tip.textContent = f.tip;
      r.btn.setAttribute('aria-label', 'How to measure: ' + r.lbl.textContent);
      if (document.activeElement !== r.inp) r.inp.value = state.v[f.k];
      validate(f);
    });
    $$('#bp-sex button').forEach(function (b) { var on = b.getAttribute('data-sex') === state.sex; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $$('#bp-units button').forEach(function (b) { var on = b.getAttribute('data-units') === state.units; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function setUnits(u) {
    if (u === state.units) return;
    FIELDS.forEach(function (f) {
      var raw = state.v[f.k]; if (raw === '' || !isFinite(parseFloat(raw))) return;
      var n = parseFloat(raw); state.v[f.k] = u === 'cm' ? num(n * IN, 1) : num(n / IN, 1);
    });
    state.units = u; syncLabels(); render();
  }
  var EXAMPLE = {
    f: { height: 66, waist: 29, hips: 38, bust: 35, shoulders: 38, inseam: 30, span: 66, head: 9 },
    m: { height: 70, waist: 33, hips: 39, bust: 41, shoulders: 47, inseam: 32, span: 71, head: 9.5 }
  };
  function loadExample() {
    var ex = EXAMPLE[state.sex];
    FIELDS.forEach(function (f) { var v = ex[f.k]; state.v[f.k] = state.units === 'in' ? num(v, 1) : num(v * IN, 1); });
    syncLabels(); render();
  }
  function clearAll() { FIELDS.forEach(function (f) { state.v[f.k] = ''; }); syncLabels(); render(); }

  /* ---------- share link ---------- */
  var KEYS = { height: 'h', waist: 'w', hips: 'p', bust: 'b', shoulders: 's', inseam: 'i', span: 'a', head: 'd' };
  function serialize() {
    var p = ['v=1', 'sx=' + state.sex, 'u=' + state.units];
    FIELDS.forEach(function (f) { var v = state.v[f.k]; if (v !== '' && isFinite(parseFloat(v))) p.push(KEYS[f.k] + '=' + parseFloat(v)); });
    return p.join('&');
  }
  var hashTimer;
  function syncHash() { clearTimeout(hashTimer); hashTimer = setTimeout(function () { try { history.replaceState(null, '', '#' + serialize()); } catch (e) {} }, 500); }
  function deserialize(hash) {
    if (!hash || hash.charAt(0) !== '#') return;
    var q = {}; hash.slice(1).split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (q.v !== '1') return;
    state.sex = q.sx === 'm' ? 'm' : 'f'; state.units = q.u === 'cm' ? 'cm' : 'in';
    FIELDS.forEach(function (f) { var n = parseFloat(q[KEYS[f.k]]); state.v[f.k] = isFinite(n) ? String(n) : ''; });
  }
  var toastTimer;
  function toast(m) { el.toast.textContent = m; el.toast.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2200); }

  /* ---------- init ---------- */
  el.core = $('#bp-core'); el.more = $('#bp-more'); el.results = $('#bp-results'); el.strip = $('#bp-strip');
  el.three = $('#bp-3d'); el.toast = $('#bp-toast');
  buildInputs();
  if (location.hash) deserialize(location.hash);
  $$('#bp-sex button').forEach(function (b) { b.addEventListener('click', function () { state.sex = b.getAttribute('data-sex'); syncLabels(); render(); }); });
  $$('#bp-units button').forEach(function (b) { b.addEventListener('click', function () { setUnits(b.getAttribute('data-units')); }); });
  root.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) return;
    var act = a.getAttribute('data-act');
    if (act === 'example') loadExample(); else if (act === 'clear') clearAll();
    else if (act === 'copy') {
      var url = location.href.split('#')[0] + '#' + serialize();
      try { history.replaceState(null, '', '#' + serialize()); } catch (er) {}
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied \u2014 it recreates these numbers'); }, function () { window.prompt('Copy this link:', url); });
      else window.prompt('Copy this link:', url);
    }
  });
  var hdr = document.querySelector('.site-header');
  function setHdr() { if (hdr) root.style.setProperty('--bp-hdr', Math.round(hdr.getBoundingClientRect().height) + 'px'); }
  setHdr(); window.addEventListener('resize', setHdr);
  syncLabels(); render();
  if (window.BP_DEBUG) window.BPApp = { state: state, compute: compute, render: render };
})();
