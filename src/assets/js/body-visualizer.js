/* ==========================================================================
   Body Visualizer — core engine (geometry, renderer, metrics)
   bodyshapecalculator.net
   Everything runs in the browser. No network calls, nothing is stored.
   ========================================================================== */
(function (root) {
  'use strict';

  var PI = Math.PI;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function sq(x) { return x * x; }

  /* ---------- Sex factor: 0 = female, 1 = male, 0.5 = neutral ------------ */
  var SEX = { f: 0, m: 1, n: 0.5 };

  /* ---------- Measurement keys & absolute ranges (metric) ---------------- */
  var MEAS = ['bust', 'waist', 'hips', 'shoulders', 'inseam', 'neck', 'arm', 'thigh'];
  var RANGES = {
    height:    [120, 230],
    weight:    [30, 250],
    bust:      [60, 160],
    waist:     [45, 160],
    hips:      [60, 170],
    shoulders: [30, 65],
    inseam:    [50, 110],
    neck:      [25, 55],
    arm:       [18, 50],
    thigh:     [35, 90]
  };
  var MIN_BMI = 16, MAX_BMI = 60;

  function rangeFor(key, body) {
    var r = RANGES[key];
    var H = body ? body.height : 170;
    if (key === 'weight') {
      var h2 = sq(H / 100);
      return [Math.max(r[0], Math.ceil(MIN_BMI * h2)), Math.min(r[1], Math.floor(MAX_BMI * h2))];
    }
    if (key === 'inseam') {
      return [Math.max(r[0], Math.round(0.38 * H)), Math.min(r[1], Math.round(0.56 * H))];
    }
    return r;
  }

  /* ---------- "Typical" measurements for a given sex / height / weight --- */
  //            female  male   bmiExp(f)  bmiExp(m)  heightExp
  var REF = {
    bust:      [88,   98,    0.42, 0.42, 0.60],
    waist:     [74,   82,    0.65, 0.70, 0.60],
    hips:      [96,   97.5,  0.40, 0.36, 0.60],
    shoulders: [38.5, 48,  0.12, 0.12, 0.90],
    neck:      [31,   39,    0.32, 0.34, 0.50],
    arm:       [26,   32,    0.60, 0.60, 0.60],
    thigh:     [55,   57,    0.50, 0.50, 0.60]
  };
  function refH(s) { return lerp(165, 178, s); }
  function refBMI(s) { return lerp(22, 23, s); }

  function typical(key, s, H, W) {
    if (key === 'inseam') return 0.452 * H;
    var r = REF[key];
    var bmi = clamp(W / sq(H / 100), 14, 65);
    return lerp(r[0], r[1], s) * Math.pow(H / refH(s), r[4]) * Math.pow(bmi / refBMI(s), lerp(r[2], r[3], s));
  }

  var DEFAULT_HW = { f: [165, 60], m: [178, 76], n: [171, 68] };

  function makeBody(sex, H, W) {
    var hw = DEFAULT_HW[sex] || DEFAULT_HW.f;
    H = H || hw[0]; W = W || hw[1];
    var s = SEX[sex];
    var b = { sex: sex, height: H, weight: W };
    MEAS.forEach(function (k) { b[k] = Math.round(typical(k, s, H, W) * 2) / 2; });
    return b;
  }

  function cloneBody(b) {
    var c = {};
    for (var k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) c[k] = b[k]; }
    return c;
  }

  // Keep the user's own proportions when height / weight change.
  function rebalance(body, newH, newW) {
    var s = SEX[body.sex];
    MEAS.forEach(function (k) {
      var ratio = body[k] / typical(k, s, body.height, body.weight);
      body[k] = typical(k, s, newH, newW) * ratio;
    });
    body.height = newH; body.weight = newW;
    sanitize(body);
    return body;
  }

  function sanitize(b) {
    b.height = clamp(b.height, RANGES.height[0], RANGES.height[1]);
    var wr = rangeFor('weight', b);
    b.weight = clamp(b.weight, wr[0], wr[1]);
    MEAS.forEach(function (k) {
      var r = rangeFor(k, b);
      b[k] = clamp(b[k], r[0], r[1]);
    });
    return b;
  }

  /* ---------- Monotone cubic (PCHIP) spline ------------------------------ */
  function sign(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }
  function endSlope(h0, h1, d0, d1) {
    var s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (sign(s) !== sign(d0)) s = 0;
    else if (sign(d0) !== sign(d1) && Math.abs(s) > 3 * Math.abs(d0)) s = 3 * d0;
    return s;
  }
  function Spline(xs, ys) {
    var n = xs.length, h = [], del = [], d = [], i;
    for (i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; del[i] = (ys[i + 1] - ys[i]) / h[i]; }
    if (n === 2) { d[0] = d[1] = del[0]; }
    else {
      for (i = 1; i < n - 1; i++) {
        if (del[i - 1] * del[i] <= 0) d[i] = 0;
        else {
          var w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
          d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
        }
      }
      d[0] = endSlope(h[0], h[1], del[0], del[1]);
      d[n - 1] = endSlope(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
    }
    this.xs = xs; this.ys = ys; this.h = h; this.d = d; this.n = n; this.i = 0;
  }
  Spline.prototype.seg = function (x) {
    var xs = this.xs, n = this.n, i = this.i;
    if (i > n - 2) i = n - 2;
    if (x < xs[i] || x > xs[i + 1]) {
      var lo = 0, hi = n - 2;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid - 1; }
      i = lo;
    }
    this.i = i;
    return i;
  };
  Spline.prototype.at = function (x) {
    x = clamp(x, this.xs[0], this.xs[this.n - 1]);
    var i = this.seg(x), h = this.h[i], t = (x - this.xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * this.ys[i] + (t3 - 2 * t2 + t) * h * this.d[i] +
           (-2 * t3 + 3 * t2) * this.ys[i + 1] + (t3 - t2) * h * this.d[i + 1];
  };
  Spline.prototype.diff = function (x) {
    x = clamp(x, this.xs[0], this.xs[this.n - 1]);
    var i = this.seg(x), h = this.h[i], t = (x - this.xs[i]) / h, t2 = t * t;
    return ((6 * t2 - 6 * t) * this.ys[i] + (3 * t2 - 4 * t + 1) * h * this.d[i] +
            (-6 * t2 + 6 * t) * this.ys[i + 1] + (3 * t2 - 2 * t) * h * this.d[i + 1]) / h;
  };

  /* ---------- Ellipse helpers ------------------------------------------- */
  // semi-axes (a = lateral, b = depth = k*a) of an ellipse with perimeter C
  function ellipseAB(C, k) {
    var f = PI * (3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k)));
    var a = C / f;
    return { a: a, b: a * k };
  }

  // Resample a PCHIP curve on a fine grid and low-pass it with a Gaussian so that
  // shading stays smooth (no creases at measurement stations).
  function Dense(y0, y1, ys, vals, sigma) {
    var raw = new Spline(ys, vals);
    var step = 0.5, n = Math.max(2, Math.ceil((y1 - y0) / step) + 1);
    step = (y1 - y0) / (n - 1);
    var arr = new Float32Array(n), i, j;
    for (i = 0; i < n; i++) arr[i] = raw.at(y0 + i * step);
    if (sigma > 0.01) {
      var r = Math.ceil(3 * sigma / step), ker = [], sum = 0;
      for (j = -r; j <= r; j++) { var w = Math.exp(-0.5 * sq(j * step / sigma)); ker.push(w); sum += w; }
      var sm = new Float32Array(n);
      for (i = 0; i < n; i++) {
        var acc = 0;
        for (j = -r; j <= r; j++) { var k = i + j; if (k < 0) k = 0; else if (k > n - 1) k = n - 1; acc += arr[k] * ker[j + r]; }
        sm[i] = acc / sum;
      }
      // keep the true end shape (rounded caps) — only smooth the interior
      var edge = 2.5 * sigma;
      for (i = 0; i < n; i++) {
        var dist = Math.min(i, n - 1 - i) * step, wgt = smooth(dist / edge);
        sm[i] = arr[i] * (1 - wgt) + sm[i] * wgt;
      }
      arr = sm;
    }
    var d = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a0 = arr[Math.max(0, i - 1)], a1 = arr[Math.min(n - 1, i + 1)];
      d[i] = (a1 - a0) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * step);
    }
    this.y0 = y0; this.step = step; this.n = n; this.arr = arr; this.d = d;
  }
  Dense.prototype.at = function (y) {
    var f = (y - this.y0) / this.step; if (f < 0) f = 0; else if (f > this.n - 1) f = this.n - 1;
    var i = f | 0; if (i >= this.n - 1) return this.arr[this.n - 1];
    var t = f - i; return this.arr[i] * (1 - t) + this.arr[i + 1] * t;
  };
  Dense.prototype.diff = function (y) {
    var f = (y - this.y0) / this.step; if (f < 0) f = 0; else if (f > this.n - 1) f = this.n - 1;
    var i = f | 0; if (i >= this.n - 1) return this.d[this.n - 1];
    var t = f - i; return this.d[i] * (1 - t) + this.d[i + 1] * t;
  };

  function makePart(name, st, side, sigma, fadeLo, fadeHi) {
    // st: array of {y, cx, cz, a, b}, ascending in y
    var ys = [], cx = [], cz = [], a = [], b = [], i, last = -1e9;
    for (i = 0; i < st.length; i++) {
      var y = st[i].y; if (y <= last + 1e-3) y = last + 1e-3; last = y;
      ys.push(y); cx.push(st[i].cx || 0); cz.push(st[i].cz || 0);
      a.push(Math.max(0.35, st[i].a)); b.push(Math.max(0.35, st[i].b));
    }
    var y0 = ys[0], y1 = ys[ys.length - 1], sg = sigma == null ? 1.2 : sigma;
    return {
      name: name, side: side || 1, y0: y0, y1: y1, fadeLo: fadeLo || 0, fadeHi: fadeHi || 0,
      cx: new Dense(y0, y1, ys, cx, sg), cz: new Dense(y0, y1, ys, cz, sg),
      a: new Dense(y0, y1, ys, a, sg), b: new Dense(y0, y1, ys, b, sg)
    };
  }

  /* ---------- Body -> geometry ------------------------------------------ */
  // Every sex-dependent number is a lerp between a female value (s = 0) and a
  // male value (s = 1); the neutral model sits halfway.
  function buildModel(p) {
    var s = SEX[p.sex];
    var H = p.height;
    var bmi = p.weight / sq(H / 100);
    var yC = clamp(p.inseam, 0.38 * H, 0.56 * H);         // crotch height
    var yS = H * lerp(0.812, 0.822, s);                     // shoulder line
    var tl = yS - yC;
    function yT(t) { return yC + t * tl; }

    // fat distribution: men carry it on the belly, women on hips / thighs
    var belly = Math.min(1, clamp((p.waist / p.hips - 0.78) * 4, 0, 1) *
                (0.55 + 0.45 * clamp((bmi - 19) / 10, 0, 1)) * lerp(0.85, 1.2, s));

    /* --- chest: rib cage + breast / pectoral lobes ---------------------- */
    var dC = lerp(p.bust * 0.095, p.bust * 0.03, s);        // bust minus rib girth
    var Cr = p.bust - dC * lerp(0.55, 1.0, s);
    var kB = lerp(0.72, 0.61, s);
    var kW = 0.72 + 0.14 * belly;
    var kH = lerp(0.64, 0.76, s) + 0.06 * clamp((bmi - 22) / 12, -0.5, 1);

    var Eh = ellipseAB(p.hips, kH);
    var Ew = ellipseAB(p.waist, kW);
    var Eb = ellipseAB(Cr, kB);
    var Eu = ellipseAB(Cr * lerp(0.965, 0.99, s), kB - 0.02);
    var Ec = ellipseAB(Cr * lerp(0.95, 0.985, s), kB - 0.05);
    var hhC = (p.highhip > 0) ? clamp(p.highhip, Math.min(p.waist, p.hips) * 0.9, Math.max(p.waist, p.hips) * 1.08) : p.waist + (p.hips - p.waist) * 0.45;
    var Ehh = ellipseAB(hhC, (kW + kH) / 2);
    var Eth = ellipseAB(p.thigh, 0.97);
    var Enk = ellipseAB(p.neck, 0.98);
    var rA = p.arm / (2 * PI);

    /* --- torso -------------------------------------------------------- */
    var hipCz = -lerp(0.17, 0.08, s) * Eh.b;
    var waistCz = (0.02 + 0.14 * belly) * Ew.b;
    var xTop = Math.max(0.35 * Eth.a, Math.min(Eth.a * lerp(1.0, 1.1, s), Eh.a * 0.98 - Eth.a));
    var aBot = Math.min(Eh.a * 0.98, xTop + Eth.a);
    var bBot = Eth.b * 1.04, cBot = 0.4;
    var aSh = clamp(0.5 * p.shoulders - rA * 0.9, 0.75 * Eb.a, 1.10 * Eb.a);
    var tW = lerp(0.45, 0.41, s), tHip = lerp(0.145, 0.165, s), tBust = lerp(0.72, 0.735, s);
    var trapA = lerp(0.52, 0.22, s), trapB = lerp(0.86, 0.58, s);
    // breast (female) / pectoral (male) volume: a smooth shading bump on the chest
    // plus a matching forward profile in the side view
    var hF = clamp(0.44 * dC, 1.8, 5.2) * Math.pow(clamp((0.75 - s) / 0.75, 0, 1), 1.2);
    var hM = 1.0 * clamp((s - 0.25) / 0.75, 0, 1);
    var bumpH = hF + hM;
    var bustCz = lerp(0.03, 0.02, s) * Eb.b + 0.42 * hF;
    var bustB = Eb.b + 0.30 * hF;

    var torso = [
      { y: yC - 0.022 * H, a: aBot * 0.97, b: bBot * 0.90, cz: cBot },
      { y: yC - 0.004 * H, a: aBot, b: bBot, cz: cBot },
      { y: yC + (yT(tHip) - yC) * 0.48, a: lerp(aBot, Eh.a, 0.55), b: lerp(bBot, Eh.b, 0.42), cz: lerp(cBot, hipCz, 0.42) },
      { y: yT(tHip), a: Eh.a, b: Eh.b, cz: hipCz },
      { y: yT((tHip + tW) / 2 - 0.02), a: Ehh.a, b: Ehh.b, cz: lerp(hipCz, waistCz, 0.55) + 0.14 * belly * Ehh.b },
      { y: yT(tW), a: Ew.a, b: Ew.b, cz: waistCz },
      { y: yT((tW + tBust) / 2 + 0.03), a: Eu.a, b: Eu.b + 0.06 * hF, cz: 0.03 * Eu.b + 0.10 * hF },
      { y: yT(tBust), a: Eb.a, b: bustB, cz: bustCz },
      { y: yT(0.80), a: Eb.a * lerp(0.97, 1.05, s), b: Eb.b * 0.97, cz: bustCz * 0.6 },
      { y: yT(0.87), a: lerp(Ec.a, aSh, 0.45), b: Ec.b + 0.10 * hF, cz: lerp(0.05, 0.02, s) * Ec.b + 0.18 * hF },
      { y: yS - 0.016 * H, a: aSh * lerp(0.95, 1.0, s), b: 0.86 * Eb.b, cz: 0 },
      { y: yS, a: aSh * lerp(0.84, 0.92, s), b: 0.72 * Eb.b, cz: 0 },
      { y: yS + 0.010 * H, a: lerp(aSh, Enk.a, trapA), b: lerp(0.72 * Eb.b, Enk.b, trapA) * 1.05, cz: 0.2 },
      { y: yS + 0.024 * H, a: lerp(aSh, Enk.a, trapB), b: lerp(0.72 * Eb.b, Enk.b, trapB) * 1.05, cz: 0.4 },
      { y: yS + 0.036 * H, a: Enk.a * lerp(1.08, 1.42, s), b: Enk.b * lerp(1.08, 1.22, s), cz: 0.5 },
      { y: yS + 0.048 * H, a: Enk.a * 0.94, b: Enk.b * 0.94, cz: 0.6 }
    ];

    /* --- neck & head -------------------------------------------------- */
    var neck = [
      { y: 0.808 * H, a: Enk.a * 1.25, b: Enk.b * 1.25, cz: 0.3 },
      { y: 0.842 * H, a: Enk.a, b: Enk.b, cz: 0.6 },
      { y: 0.876 * H, a: Enk.a * 0.96, b: Enk.b * 0.96, cz: 1.0 },
      { y: 0.905 * H, a: Enk.a * 0.98, b: Enk.b * 0.98, cz: 1.2 }
    ];
    var hh = H * lerp(0.0640, 0.0660, s), hc = H - hh;
    var HA = H * lerp(0.0445, 0.0468, s), HB = H * 0.0585;
    var jaw = lerp(0.80, 0.94, s);
    var head = [];
    [-1, -0.965, -0.9, -0.78, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.78, 0.9, 0.965, 1].forEach(function (t) {
      var g = Math.sqrt(Math.max(0, 1 - t * t));
      var ga = g * (jaw + (1 - jaw) * smooth((t + 0.9) / 1.5));
      head.push({ y: hc + t * hh, a: Math.max(0.5, HA * ga), b: Math.max(0.5, HB * g), cz: 1.0 });
    });

    /* --- arms --------------------------------------------------------- */
    var xSh = Math.max(0.5 * p.shoulders - rA, 0.86 * Eb.a + 0.5 * rA);   // shoulder joint x
    var tanA = 0.10;                                     // slight outward hang
    var ySh0 = 0.80 * H;
    var fA = Math.pow(rA / lerp(4.3, 4.9, s), 0.5) * (H / 170) * lerp(1.0, 1.12, s);
    function armSt(y, rMul, isAbs, bMul) {
      var r = isAbs ? rMul * fA : rA * rMul;
      return { y: y, cx: xSh + (ySh0 - y) * tanA, a: r, b: r * (bMul || 1), cz: 0.3 };
    }
    function domeUp(y, r, bMul, up) {                   // rounded cap
      var out = [], h = r * 0.95;
      [28, 52, 70, 82, 90].forEach(function (deg) {
        var t = deg * PI / 180;
        out.push({ y: y + (up ? 1 : -1) * h * Math.sin(t), cx: 0, cz: 0.3, a: Math.max(0.18, r * Math.cos(t)), b: Math.max(0.18, r * bMul * Math.cos(t)) });
      });
      return out;
    }
    function armX(y) { return xSh + (ySh0 - y) * tanA; }
    var armBase = [
      armSt(0.410 * H, lerp(2.85, 3.10, s), true, 0.44),
      armSt(0.452 * H, lerp(3.25, 3.55, s), true, 0.44),
      armSt(0.487 * H, lerp(2.00, 2.25, s), true, 0.85),
      armSt(0.525 * H, lerp(2.35, 2.65, s), true, 0.90),
      armSt(0.590 * H, lerp(0.84, 0.92, s), false, 0.98),
      armSt(0.632 * H, lerp(0.77, 0.82, s), false, 0.95),
      armSt(0.690 * H, lerp(0.94, 1.02, s), false, 1.00),
      armSt(0.750 * H, lerp(1.04, 1.18, s), false, 1.02),
      armSt(0.782 * H, lerp(1.06, 1.24, s), false, 1.00),
      armSt(0.797 * H, lerp(1.00, 1.22, s), false, 0.98)
    ];
    var tipCap = domeUp(0.410 * H, lerp(2.3, 2.5, s) * fA, 0.44, false).map(function (q) { q.y = q.y - 1.2; q.cx = armX(q.y); return q; });
    var shCap = domeUp(0.797 * H, rA * lerp(1.00, 1.22, s), 0.98, true).map(function (q) { q.cx = armX(q.y); return q; });
    var armStations = tipCap.slice().reverse().concat(armBase, shCap);

    /* --- legs --------------------------------------------------------- */
    var ankleA = 3.5 * Math.pow(Eth.a / 8.8, 0.45) * Math.pow(H / 165, 0.6) * lerp(0.95, 1.10, s);
    var footL = H * lerp(0.148, 0.158, s), footW = H * lerp(0.028, 0.031, s);
    function legSt(f, aF, aM, bF, bM, cz, cxMul) {
      return { y: f * yC, cx: xTop * cxMul, cz: cz, a: Eth.a * lerp(aF, aM, s), b: Eth.b * lerp(bF, bM, s) };
    }
    var leg = [
      { y: 0, cx: xTop * 0.88, cz: 0.30 * footL, a: footW * 0.92, b: 0.50 * footL },
      { y: 0.030 * yC, cx: xTop * 0.88, cz: 0.25 * footL, a: footW, b: 0.44 * footL },
      { y: 0.075 * yC, cx: xTop * 0.88, cz: -0.4, a: ankleA * 1.05, b: ankleA * 1.15 },
      { y: 0.11 * yC, cx: xTop * 0.88, cz: -0.7, a: ankleA, b: ankleA * 1.12 },
      legSt(0.24, 0.47, 0.52, 0.50, 0.56, -0.9, 0.89),
      legSt(0.40, 0.60, 0.70, 0.66, 0.78, -0.9, 0.89 + 0.05 * s),
      legSt(0.50, 0.58, 0.64, 0.64, 0.70, -0.3, 0.90 + 0.05 * s),
      legSt(0.62, 0.62, 0.70, 0.66, 0.74, 1.0, 0.90 + 0.06 * s),
      legSt(0.78, 0.86, 0.90, 0.88, 0.95, 0.8, 0.95),
      legSt(0.90, 0.97, 0.98, 0.97, 1.00, 0.7, 0.98),
      legSt(1.00, 1.00, 1.00, 1.00, 1.00, 0.5, 1.00)
    ];

    var torsoPart = makePart('torso', torso, 1, 2.2, 4.5, 3.0);
    torsoPart.bumps = [];
    if (hF > 0.05) {
      [-1, 1].forEach(function (sg) {
        torsoPart.bumps.push({ x: sg * Eb.a * 0.50, y: yT(tBust) - 0.6, sx: 3.5 + 0.10 * dC, sy: 3.6 + 0.12 * dC, h: hF });
      });
    }
    if (hM > 0.05) {
      [-1, 1].forEach(function (sg) {
        torsoPart.bumps.push({ x: sg * Eb.a * 0.50, y: yT(tBust) + 1.2, sx: 6.6, sy: 4.3, h: hM * 1.5 });
      });
    }
    var gH = lerp(2.6, 1.0, s) * (0.8 + 0.4 * clamp((bmi - 18) / 10, 0, 1));
    [-1, 1].forEach(function (sg) {
      torsoPart.bumps.push({ x: sg * Eh.a * 0.46, y: yT(tHip) - 1.8, sx: 4.6 + 0.05 * p.hips * 0.1, sy: 5.6, h: gH, side: -1 });
    });
    var parts = [
      torsoPart,
      makePart('neck', neck, 1, 0.8, 2.0, 2.5),
      makePart('head', head, 1, 0.35, 3.0, 0),
      makePart('armR', armStations, 1, 0.7, 0, 0),
      makePart('armL', armStations, -1, 0.7, 0, 0),
      makePart('legR', leg, 1, 1.6, 0, 4.0),
      makePart('legL', leg, -1, 1.6, 0, 4.0)
    ];
    var Rb = 0;
    armStations.forEach(function (q) { Rb = Math.max(Rb, Math.abs(q.cx) + Math.max(q.a, q.b)); });
    torso.forEach(function (q) { Rb = Math.max(Rb, Math.max(q.a, q.b)); });

    return {
      H: H, parts: parts, Rb: Rb,
      levels: { bust: yT(tBust), waist: yT(tW), highhip: yT((tHip + tW) / 2 - 0.02), hips: yT(tHip), shoulder: yS },
      yCrotch: yC
    };
  }

  // Horizontal extent (cm, screen space) of the model at height y
  function extentsAt(model, y, theta) {
    var c = Math.cos(theta), s = Math.sin(theta), lo = 1e9, hi = -1e9;
    for (var i = 0; i < model.parts.length; i++) {
      var pt = model.parts[i];
      if (y < pt.y0 || y > pt.y1) continue;
      var cx = pt.cx.at(y) * pt.side, cz = pt.cz.at(y), a = pt.a.at(y), b = pt.b.at(y);
      var sc = cx * c + cz * s, E = Math.sqrt(a * a * c * c + b * b * s * s);
      if (sc - E < lo) lo = sc - E;
      if (sc + E > hi) hi = sc + E;
    }
    return lo > hi ? null : [lo, hi];
  }

  /* ---------- Rasteriser (scan-line, analytic ellipse cross-sections) ---- */
  var LX = -0.50, LY = 0.46, LZ = 0.74;
  (function () { var l = Math.sqrt(LX * LX + LY * LY + LZ * LZ); LX /= l; LY /= l; LZ /= l; })();
  var HX = LX, HY = LY, HZ = LZ + 1;
  (function () { var l = Math.sqrt(HX * HX + HY * HY + HZ * HZ); HX /= l; HY /= l; HZ /= l; })();

  var _rb = null;
  function rowBuffers(W) {
    if (_rb && _rb.W === W) return _rb;
    _rb = { W: W, zb: new Float32Array(W), S: new Float32Array(W), cov: new Uint8Array(W),
            NX: new Float32Array(W), NY: new Float32Array(W), NZ: new Float32Array(W),
            BX: new Float32Array(W), BY: new Float32Array(W), BZ: new Float32Array(W) };
    return _rb;
  }
  var rowBumps = new Float64Array(20);
  var SOFT_K = 0.9;   // 1/cm — how far apart two surfaces may be and still blend

  function rasterize(buf, W, Hp, model, o) {
    var scale = o.scale, ox = o.cxPx, gy = o.groundPx;
    var th = o.theta, c = Math.cos(th), s = Math.sin(th);
    var col = o.color, alpha = o.alpha == null ? 255 : Math.round(255 * o.alpha);
    var T = rowBuffers(W);
    var zb = T.zb, S = T.S, cov = T.cov, NX = T.NX, NY = T.NY, NZ = T.NZ, BX = T.BX, BY = T.BY, BZ = T.BZ;
    var parts = model.parts, np = parts.length;
    var top = Math.max(0, Math.floor(gy - model.H * scale) - 1), bot = Math.min(Hp - 1, Math.ceil(gy));
    var kk = SOFT_K;

    for (var py = top; py <= bot; py++) {
      var y = (gy - (py + 0.5)) / scale;
      if (y < 0 || y > model.H) continue;
      var any = false;
      for (var i = 0; i < W; i++) { zb[i] = -1e9; S[i] = 0; cov[i] = 0; NX[i] = 0; NY[i] = 0; NZ[i] = 0; }

      for (var pi = 0; pi < np; pi++) {
        var pt = parts[pi];
        if (y < pt.y0 || y > pt.y1) continue;
        var fw = 1;
        if (pt.fadeLo > 0) fw *= smooth((y - pt.y0) / pt.fadeLo);
        if (pt.fadeHi > 0) fw *= smooth((pt.y1 - y) / pt.fadeHi);
        if (fw < 0.002) fw = 0.002;
        var side = pt.side;
        var cx = pt.cx.at(y) * side, cz = pt.cz.at(y), a = pt.a.at(y), b = pt.b.at(y);
        var dcx = pt.cx.diff(y) * side, dcz = pt.cz.diff(y), da = pt.a.diff(y), db = pt.b.diff(y);
        var scx = cx * c + cz * s;
        var E = Math.sqrt(a * a * c * c + b * b * s * s);
        var x0 = Math.max(0, Math.floor(ox + (scx - E) * scale)), x1 = Math.min(W - 1, Math.ceil(ox + (scx + E) * scale));
        var a2 = 1 / (a * a), b2 = 1 / (b * b);
        var A = s * s * a2 + c * c * b2;
        // row-constant part of the chest bumps
        var bumps = null, bcount = 0;
        if (pt.bumps && pt.bumps.length) {
          bumps = rowBumps; bcount = 0;
          for (var bi = 0; bi < pt.bumps.length; bi++) {
            var bp = pt.bumps[bi], dy = (y - bp.y) / bp.sy;
            if (Math.abs(dy) > 3) continue;
            var gyv = bp.h * Math.exp(-0.5 * dy * dy);
            var o2 = bcount * 5;
            bumps[o2] = bp.x; bumps[o2 + 1] = 1 / bp.sx; bumps[o2 + 2] = gyv; bumps[o2 + 3] = -gyv * dy / bp.sy; bumps[o2 + 4] = bp.side || 1;
            bcount++;
          }
        }
        for (var px = x0; px <= x1; px++) {
          var xs = (px + 0.5 - ox) / scale;
          var X0 = xs * c - cx, Z0 = xs * s - cz;
          var Bq = 2 * (Z0 * c * b2 - X0 * s * a2);
          var Cq = X0 * X0 * a2 + Z0 * Z0 * b2 - 1;
          var D = Bq * Bq - 4 * A * Cq;
          if (D < 0) continue;
          var z = (-Bq + Math.sqrt(D)) / (2 * A);
          if (cov[px] && z < zb[px] - 4 / kk) continue;
          var Xp = X0 - z * s, Zp = Z0 + z * c;
          var gx = Xp * a2, gz = Zp * b2;
          var gl = Math.sqrt(gx * gx + gz * gz) || 1;
          var ux = gx / gl, uz = gz / gl;
          var ny = -(da * (Xp / a) * ux + db * (Zp / b) * uz + dcx * ux + dcz * uz) * 0.85;
          if (bcount && (uz > 0.05 || uz < -0.05)) {
            // smooth chest volume: perturb the normal with the gradient of Gaussian bumps
            var hx = 0, hy = 0, auz = uz < 0 ? -uz : uz, fz = auz > 0.55 ? 1 : (auz - 0.05) / 0.5, sgz = uz < 0 ? -1 : 1;
            for (var q2 = 0; q2 < bcount; q2++) {
              var o3 = q2 * 5;
              if (rowBumps[o3 + 4] !== sgz) continue;
              var dxn = (Xp - rowBumps[o3]) * rowBumps[o3 + 1], ex = Math.exp(-0.5 * dxn * dxn);
              hx += -rowBumps[o3 + 2] * ex * dxn * rowBumps[o3 + 1];
              hy += rowBumps[o3 + 3] * ex;
            }
            ux -= hx * fz * auz; ny -= hy * fz;
            var ul = Math.sqrt(ux * ux + uz * uz) || 1; ux /= ul; uz /= ul;
          }
          var nx = ux * c + uz * s, nz = -ux * s + uz * c;
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          any = true;
          if (!cov[px]) {
            cov[px] = 1; zb[px] = z; S[px] = fw; NX[px] = nx * fw; NY[px] = ny * fw; NZ[px] = nz * fw;
            BX[px] = nx; BY[px] = ny; BZ[px] = nz;
          } else if (z > zb[px]) {
            var sc = Math.exp(kk * (zb[px] - z));
            S[px] = S[px] * sc + fw; NX[px] = NX[px] * sc + nx * fw; NY[px] = NY[px] * sc + ny * fw; NZ[px] = NZ[px] * sc + nz * fw;
            zb[px] = z; BX[px] = nx; BY[px] = ny; BZ[px] = nz;
          } else {
            var w = Math.exp(kk * (z - zb[px])) * fw;
            S[px] += w; NX[px] += w * nx; NY[px] += w * ny; NZ[px] += w * nz;
          }
        }
      }
      if (!any) continue;
      var row = py * W * 4;
      for (var q = 0; q < W; q++) {
        if (!cov[q]) continue;
        var mx = NX[q] + 0.002 * BX[q], my = NY[q] + 0.002 * BY[q], mz = NZ[q] + 0.002 * BZ[q];
        var ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
        mx /= ml; my /= ml; mz /= ml;
        var dif = mx * LX + my * LY + mz * LZ; if (dif < 0) dif = 0;
        var hs = mx * HX + my * HY + mz * HZ; if (hs < 0) hs = 0;
        var rim = 1 - (mz < 0 ? 0 : mz); rim = rim * rim * rim;
        var sh = 0.30 + 0.70 * (dif + 0.15 * dif * (1 - dif));
        var h2 = hs * hs, h4 = h2 * h2, h8 = h4 * h4, h16 = h8 * h8;
        var sp = h16 * h8 * h2 * 0.16 + rim * 0.10;
        var k = row + q * 4;
        buf[k] = col[0] * sh + 255 * sp;
        buf[k + 1] = col[1] * sh + 255 * sp;
        buf[k + 2] = col[2] * sh + 255 * sp;
        buf[k + 3] = alpha;
      }
    }
  }

  /* ---------- Metrics ---------------------------------------------------- */
  function bmiOf(b) { return b.weight / sq(b.height / 100); }
  function bmiCategory(v) {
    if (v < 18.5) return 'Underweight range';
    if (v < 25) return 'Healthy weight range';
    if (v < 30) return 'Overweight range';
    return 'Obesity range';
  }
  function bmiShort(v) { return v < 18.5 ? 'Underweight' : (v < 25 ? 'Healthy' : (v < 30 ? 'Overweight' : 'Obesity')); }
  function whrShort(b) { var lim = b.sex === 'm' ? 0.90 : (b.sex === 'f' ? 0.85 : 0.875); return whrOf(b) > lim ? 'Above ref.' : 'Within ref.'; }
  function whtrShort(b) { var v = whtrOf(b); return v < 0.40 ? 'Slim' : (v < 0.50 ? 'Healthy' : (v < 0.60 ? 'Increased' : 'High')); }
  function healthyRange(b) {
    var h2 = sq(b.height / 100);
    return [18.5 * h2, 24.9 * h2];
  }
  function whrOf(b) { return b.waist / b.hips; }
  function whrNote(b) {
    var v = whrOf(b), lim = b.sex === 'm' ? 0.90 : (b.sex === 'f' ? 0.85 : 0.875);
    var ref = b.sex === 'm' ? '0.90' : (b.sex === 'f' ? '0.85' : '0.85 women / 0.90 men');
    return (v > lim ? 'Above' : 'At or below') + ' the WHO reference (' + ref + ')';
  }
  function whtrOf(b) { return b.waist / b.height; }
  function whtrNote(b) {
    var v = whtrOf(b);
    if (v < 0.40) return 'Below 0.40 (slim)';
    if (v < 0.50) return 'Within the commonly cited healthy range (0.40–0.49)';
    if (v < 0.60) return 'Increased — 0.50 or above';
    return 'High — 0.60 or above';
  }
  // US Navy circumference method (metric form)
  function bodyFat(b) {
    var H = b.height, m, f;
    var wn = Math.max(b.waist - b.neck, 5);
    m = 495 / (1.0324 - 0.19077 * Math.log10(wn) + 0.15456 * Math.log10(H)) - 450;
    var wf = Math.max(b.waist + b.hips - b.neck, 20);
    f = 495 / (1.29579 - 0.35004 * Math.log10(wf) + 0.22100 * Math.log10(H)) - 450;
    var v = b.sex === 'm' ? m : (b.sex === 'f' ? f : (m + f) / 2);
    return clamp(v, 3, 60);
  }
  function bodyFatNote(b, v) {
    var t = b.sex === 'm' ? [6, 14, 18, 25] : (b.sex === 'f' ? [14, 21, 25, 32] : [10, 17.5, 21.5, 28.5]);
    if (v < t[0]) return 'Very lean (athlete-level or lower)';
    if (v < t[1]) return 'Athletic range';
    if (v < t[2]) return 'Fitness range';
    if (v < t[3]) return 'Average range';
    return 'Above average range';
  }

  function bodyFatShort(b, v) {
    var t = b.sex === 'm' ? [6, 14, 18, 25] : (b.sex === 'f' ? [14, 21, 25, 32] : [10, 17.5, 21.5, 28.5]);
    return v < t[0] ? 'Very lean' : (v < t[1] ? 'Athletic' : (v < t[2] ? 'Fitness' : (v < t[3] ? 'Average' : 'Above avg.')));
  }

  var SHAPES = {
    hourglass:        { n: 'Hourglass',        url: '/hourglass-body-shape/' },
    top_hourglass:    { n: 'Top Hourglass',    url: '/hourglass-body-shape/' },
    bottom_hourglass: { n: 'Bottom Hourglass', url: '/hourglass-body-shape/' },
    triangle:         { n: 'Pear (Triangle)',  url: '/pear-body-shape/' },
    apple:            { n: 'Apple',            url: '/apple-body-shape/' },
    inverted_triangle:{ n: 'Inverted Triangle',url: '/inverted-triangle-body-shape/' },
    rectangle:        { n: 'Rectangle',        url: '/' },
    trapezoid:        { n: 'Trapezoid',        url: '/male-body-type-calculator/' },
    oval:             { n: 'Oval',             url: '/male-body-type-calculator/' },
    m_inverted:       { n: 'Inverted Triangle',url: '/male-body-type-calculator/' },
    m_triangle:       { n: 'Triangle',         url: '/male-body-type-calculator/' },
    m_rectangle:      { n: 'Rectangle',        url: '/male-body-type-calculator/' }
  };

  // Same rules (in inches) as the site's Body Type Calculators
  function classifyFemale(bustCm, waistCm, hipsCm) {
    var B = bustCm / 2.54, W = waistCm / 2.54, H = hipsCm / 2.54;
    var bh = B - H, hb = H - B, bw = B - W, hw = H - W;
    if (bh <= 1 && hb < 3.6 && (bw >= 9 || hw >= 10)) return 'hourglass';
    if (hb >= 3.6 && hb < 10 && hw >= 9) return 'bottom_hourglass';
    if (bh > 1 && bh < 10 && bw >= 9) return 'top_hourglass';
    if (Math.abs(B - H) < 3.6 && W >= B - 2 && W >= H - 2) return 'apple';
    if (hb >= 3.6 && hw < 9) return 'triangle';
    if (bh >= 3.6 && bw < 9) return 'inverted_triangle';
    return 'rectangle';
  }
  function classifyMale(chestCm, waistCm, hipsCm) {
    var C = chestCm / 2.54, W = waistCm / 2.54, H = hipsCm / 2.54;
    var ch = C - H, hc = H - C, cw = C - W;
    if (ch >= 3 && cw >= 7) return 'trapezoid';
    if (ch >= 3) return 'm_inverted';
    if (hc >= 3) return 'm_triangle';
    if (Math.abs(ch) < 3 && W >= C - 2 && W >= H - 2) return 'oval';
    return 'm_rectangle';
  }
  function classify(b) {
    var key = b.sex === 'f' ? classifyFemale(b.bust, b.waist, b.hips) : classifyMale(b.bust, b.waist, b.hips);
    return { key: key, name: SHAPES[key].n, url: SHAPES[key].url };
  }

  /* ---------- Shape presets (targets are re-checked by the classifier) --- */
  var PRESETS_F = [
    ['hourglass', 'Hourglass'], ['top_hourglass', 'Top hourglass'], ['bottom_hourglass', 'Bottom hourglass'],
    ['triangle', 'Pear'], ['apple', 'Apple'], ['inverted_triangle', 'Inverted triangle'], ['rectangle', 'Rectangle']
  ];
  var PRESETS_M = [
    ['trapezoid', 'Trapezoid'], ['m_inverted', 'Inverted triangle'], ['m_rectangle', 'Rectangle'],
    ['oval', 'Oval'], ['m_triangle', 'Triangle']
  ];
  function presetValues(key, body) {
    var H0 = body.hips, bust, waist;
    switch (key) {
      case 'hourglass':        bust = H0;                           waist = 0.70 * H0; break;
      case 'top_hourglass':    bust = H0 * 1.08;                    waist = 0.68 * H0; break;
      case 'bottom_hourglass': bust = H0 - Math.max(10, 0.11 * H0); waist = 0.70 * H0; break;
      case 'triangle':         bust = H0 - Math.max(11, 0.12 * H0); waist = 0.84 * H0; break;
      case 'apple':            bust = H0 + 1;                       waist = 1.02 * H0; break;
      case 'inverted_triangle':bust = H0 + Math.max(10, 0.115 * H0); waist = bust - Math.min(20, 0.15 * H0); break;
      case 'rectangle':        bust = H0 - 4;                       waist = 0.86 * H0; break;
      case 'trapezoid':        bust = H0 + Math.max(10, 0.10 * H0); waist = bust - 20; break;
      case 'm_inverted':       bust = H0 + 10;                      waist = bust - 12; break;
      case 'm_rectangle':      bust = H0 + 3;                       waist = bust * 0.88; break;
      case 'oval':             bust = H0 + 1;                       waist = Math.max(bust, H0) * 1.03; break;
      case 'm_triangle':       bust = H0 - 10;                      waist = bust * 0.90; break;
      default: return null;
    }
    return { bust: bust, waist: waist };
  }

  /* ---------- Swatches --------------------------------------------------- */
  var SWATCHES = [
    { n: 'Champagne', c: [221, 199, 158] },
    { n: 'Sand',      c: [232, 208, 181] },
    { n: 'Clay',      c: [201, 145, 108] },
    { n: 'Mocha',     c: [140, 92, 64] },
    { n: 'Rose',      c: [216, 160, 160] },
    { n: 'Sage',      c: [157, 181, 159] },
    { n: 'Slate',     c: [143, 163, 184] },
    { n: 'Graphite',  c: [154, 154, 154] }
  ];

  var API = {
    SEX: SEX, MEAS: MEAS, RANGES: RANGES, MIN_BMI: MIN_BMI, SWATCHES: SWATCHES,
    PRESETS_F: PRESETS_F, PRESETS_M: PRESETS_M, SHAPES: SHAPES,
    clamp: clamp, lerp: lerp, rangeFor: rangeFor, typical: typical,
    makeBody: makeBody, cloneBody: cloneBody, rebalance: rebalance, sanitize: sanitize,
    buildModel: buildModel, extentsAt: extentsAt, rasterize: rasterize,
    bmiOf: bmiOf, bmiCategory: bmiCategory, healthyRange: healthyRange, bmiShort: bmiShort, whrShort: whrShort, whtrShort: whtrShort, bodyFatShort: bodyFatShort,
    whrOf: whrOf, whrNote: whrNote, whtrOf: whtrOf, whtrNote: whtrNote,
    bodyFat: bodyFat, bodyFatNote: bodyFatNote,
    classify: classify, classifyFemale: classifyFemale, classifyMale: classifyMale,
    presetValues: presetValues
  };
  root.BVCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
/* ==========================================================================
   Body Visualizer — interface
   ========================================================================== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.BVCore) return;
  var C = window.BVCore;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var root = $('#bv-app');
  if (!root) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  var VIEW_KEYS = ['height', 'weight', 'bust', 'waist', 'hips', 'shoulders', 'inseam', 'neck', 'arm', 'thigh'];
  var state = {
    mode: 'single',            // single | compare | overlay
    units: 'metric',
    active: 0,
    bodies: [C.makeBody('f'), null],
    angle: 0,
    auto: true,
    lines: true,
    ruler: true,
    color: 0,
    spin: false
  };

  var FIELDS = [
    { k: 'height',    kind: 'len', grp: 'basic', label: 'Height',        tip: 'Standing straight, without shoes.' },
    { k: 'weight',    kind: 'wt',  grp: 'basic', label: 'Weight',        tip: 'Your current body weight.' },
    { k: 'bust',      kind: 'len', grp: 'basic', label: 'Bust',          tip: 'Around the fullest part of the bust, with the tape level across your back.', tipM: 'Around the fullest part of the chest, just under the arms.' },
    { k: 'waist',     kind: 'len', grp: 'basic', label: 'Waist',         tip: 'Around the narrowest part of your torso, usually just above the navel.' },
    { k: 'hips',      kind: 'len', grp: 'basic', label: 'Hips',          tip: 'Around the fullest part of the hips and buttocks, feet together.' },
    { k: 'shoulders', kind: 'len', grp: 'adv',   label: 'Shoulder width', tip: 'Straight-line width across the tips of both shoulders.' },
    { k: 'inseam',    kind: 'len', grp: 'adv',   label: 'Inseam',        tip: 'Crotch to floor along the inside of the leg. A longer inseam means a shorter torso at the same height.' },
    { k: 'neck',      kind: 'len', grp: 'adv',   label: 'Neck',          tip: 'Around the base of the neck, just below the larynx.' },
    { k: 'arm',       kind: 'len', grp: 'adv',   label: 'Upper arm',     tip: 'Around the midpoint of the relaxed upper arm.' },
    { k: 'thigh',     kind: 'len', grp: 'adv',   label: 'Thigh',         tip: 'Around the fullest part of the upper thigh.' }
  ];

  var els = {
    canvas: $('#bv-canvas'), wrap: $('#bv-canvas-wrap'), angle: $('#bv-angle'), spin: $('#bv-spin'),
    hint: $('#bv-hint'), tabs: $('#bv-tabs'), presets: $('#bv-presets'),
    cards: $('#bv-cards'), live: $('#bv-live'), liveGrid: $('#bv-live-grid'), softShort: $('#bv-softnote-short'), tableWrap: $('#bv-table-wrap'), table: $('#bv-table'),
    softNote: $('#bv-softnote'), toast: $('#bv-toast'), swatches: $('#bv-swatches'),
    fieldsBasic: $('#bv-fields-basic'), fieldsAdv: $('#bv-fields-adv'),
    presetLbl: $('#bv-preset-lbl')
  };
  var ctx = els.canvas.getContext('2d');
  var fieldEls = {};

  /* ------------------------------------------------------------------ */
  /* Units                                                               */
  /* ------------------------------------------------------------------ */
  function isMetric() { return state.units === 'metric'; }
  function toDisp(k, v) {
    if (k === 'weight') return isMetric() ? v : v * 2.2046226;
    return isMetric() ? v : v / 2.54;
  }
  function fromDisp(k, d) {
    if (k === 'weight') return isMetric() ? d : d / 2.2046226;
    return isMetric() ? d : d * 2.54;
  }
  function unitOf(k) { return k === 'weight' ? (isMetric() ? 'kg' : 'lb') : (isMetric() ? 'cm' : 'in'); }
  function num(v, dp) { return String(+v.toFixed(dp == null ? 1 : dp)); }
  function fmtVal(k, v) { return num(toDisp(k, v), 1) + ' ' + unitOf(k); }
  function fmtHeight(cm) { return isMetric() ? num(cm, 0) + ' cm' : feetIn(cm); }
  function fmtLen(cm) { return isMetric() ? num(cm, 0) + ' cm' : num(cm / 2.54, 1) + ' in'; }
  function feetIn(cm) {
    var t = Math.round(cm / 2.54), f = Math.floor(t / 12), i = t - f * 12;
    return f + '\u2032 ' + i + '\u2033';
  }
  function labelFor(f, body) { return f.k === 'bust' ? (body.sex === 'f' ? 'Bust' : 'Chest') : f.label; }
  function tipFor(f, body) { return (f.k === 'bust' && body.sex !== 'f') ? f.tipM : f.tip; }

  function activeBody() { return state.bodies[state.active] || state.bodies[0]; }
  function shownBodies() {
    return (state.mode === 'single' || !state.bodies[1]) ? [state.bodies[0]] : [state.bodies[0], state.bodies[1]];
  }

  /* ------------------------------------------------------------------ */
  /* Build the measurement fields                                        */
  /* ------------------------------------------------------------------ */
  function buildFields() {
    FIELDS.forEach(function (f) {
      var host = f.grp === 'basic' ? els.fieldsBasic : els.fieldsAdv;
      var d = document.createElement('div');
      d.className = 'bv-field';
      d.innerHTML =
        '<div class="bv-field-top">' +
          '<label class="bv-flabel" for="bv-n-' + f.k + '"></label>' +
          '<button type="button" class="bv-tipbtn" aria-expanded="false" aria-controls="bv-t-' + f.k + '">?</button>' +
          '<div class="bv-inputwrap"><input id="bv-n-' + f.k + '" type="number" inputmode="decimal" step="any" autocomplete="off"><span class="bv-unit"></span></div>' +
        '</div>' +
        '<input class="bv-range" id="bv-s-' + f.k + '" type="range">' +
        '<p class="bv-tip" id="bv-t-' + f.k + '" hidden></p>' +
        '<p class="bv-fhint"></p>';
      host.appendChild(d);
      var r = fieldEls[f.k] = {
        root: d, label: $('.bv-flabel', d), num: $('#bv-n-' + f.k, d), rng: $('#bv-s-' + f.k, d),
        unit: $('.bv-unit', d), tip: $('.bv-tip', d), btn: $('.bv-tipbtn', d), hint: $('.bv-fhint', d)
      };
      r.btn.addEventListener('click', function () {
        var open = r.btn.getAttribute('aria-expanded') === 'true';
        r.btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        r.tip.hidden = open;
      });
      r.rng.addEventListener('input', function () { setField(f.k, parseFloat(r.rng.value)); });
      r.num.addEventListener('input', function () {
        var v = parseFloat(r.num.value);
        if (!isFinite(v)) return;
        var rg = C.rangeFor(f.k, activeBody());
        var lo = toDisp(f.k, rg[0]), hi = toDisp(f.k, rg[1]);
        if (v >= lo - 1e-9 && v <= hi + 1e-9) setField(f.k, v, true);
      });
      r.num.addEventListener('change', function () {
        var v = parseFloat(r.num.value);
        if (!isFinite(v)) { syncFields(); return; }
        setField(f.k, v);
        syncFields(true);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mutations                                                           */
  /* ------------------------------------------------------------------ */
  function setField(k, dispVal, keepInput) {
    var b = activeBody();
    var rg = C.rangeFor(k, b);
    var v = C.clamp(fromDisp(k, dispVal), rg[0], rg[1]);
    if ((k === 'height' || k === 'weight') && state.auto) {
      C.rebalance(b, k === 'height' ? v : b.height, k === 'weight' ? v : b.weight);
    } else {
      b[k] = v;
      C.sanitize(b);
    }
    update({ keepInput: keepInput ? k : null });
  }

  function changeSex(sex) {
    var b = activeBody();
    if (b.sex === sex) return;
    var s0 = C.SEX[b.sex], s1 = C.SEX[sex];
    C.MEAS.forEach(function (k) {
      var ratio = b[k] / C.typical(k, s0, b.height, b.weight);
      b[k] = C.typical(k, s1, b.height, b.weight) * ratio;
    });
    b.sex = sex;
    C.sanitize(b);
    update();
  }

  function setMode(mode) {
    if (mode !== 'single' && !state.bodies[1]) state.bodies[1] = C.cloneBody(state.bodies[0]);
    state.mode = mode;
    if (mode === 'single') state.active = 0;
    else if (state.active === 0 && !state.modeSeen) { state.active = 1; }
    if (mode !== 'single') state.modeSeen = true;
    update();
  }

  function applyPreset(key) {
    var b = activeBody();
    var v = C.presetValues(key, b);
    if (!v) return;
    b.bust = v.bust; b.waist = v.waist;
    C.sanitize(b);
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Sync UI with state                                                  */
  /* ------------------------------------------------------------------ */
  function pctFill(inp) {
    var mn = parseFloat(inp.min), mx = parseFloat(inp.max), v = parseFloat(inp.value);
    inp.style.setProperty('--pct', (mx > mn ? ((v - mn) / (mx - mn)) * 100 : 0) + '%');
  }

  function syncFields(force) {
    var b = activeBody();
    FIELDS.forEach(function (f) {
      var r = fieldEls[f.k];
      var rg = C.rangeFor(f.k, b);
      var lo = toDisp(f.k, rg[0]), hi = toDisp(f.k, rg[1]);
      var stepS = f.kind === 'wt' ? (isMetric() ? 0.5 : 1) : (isMetric() ? 0.5 : 0.25);
      r.label.textContent = labelFor(f, b);
      r.btn.setAttribute('aria-label', 'How to measure: ' + labelFor(f, b));
      r.tip.textContent = tipFor(f, b);
      r.unit.textContent = unitOf(f.k);
      r.rng.min = String(Math.floor(lo / stepS) * stepS);
      r.rng.max = String(Math.ceil(hi / stepS) * stepS);
      r.rng.step = String(stepS);
      r.rng.value = String(toDisp(f.k, b[f.k]));
      r.rng.setAttribute('aria-label', labelFor(f, b) + ' slider');
      pctFill(r.rng);
      if (force || document.activeElement !== r.num) r.num.value = num(toDisp(f.k, b[f.k]), 1);
      var hint = '';
      if (f.k === 'height' && !isMetric()) hint = feetIn(b.height);
      if (f.k === 'weight') hint = 'Shown range at this height: ' + num(toDisp('weight', rg[0]), 0) + '\u2013' + num(toDisp('weight', rg[1]), 0) + ' ' + unitOf('weight');
      if (f.k === 'inseam') hint = 'Typical for your height: ' + fmtLen(0.452 * b.height);
      r.hint.textContent = hint;
      r.hint.hidden = !hint;
    });
  }

  function segSet(id, attr, val) {
    $$('#' + id + ' button').forEach(function (btn) {
      var on = btn.getAttribute(attr) === String(val);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncChips() {
    var b = activeBody();
    var list = b.sex === 'f' ? C.PRESETS_F : C.PRESETS_M;
    var cur = C.classify(b).key;
    els.presets.innerHTML = '';
    list.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bv-chip' + (p[0] === cur ? ' is-on' : '');
      btn.textContent = p[1];
      btn.setAttribute('aria-pressed', p[0] === cur ? 'true' : 'false');
      btn.addEventListener('click', function () { applyPreset(p[0]); });
      els.presets.appendChild(btn);
    });
  }

  function syncUI(opts) {
    segSet('bv-mode', 'data-mode', state.mode);
    segSet('bv-sex', 'data-sex', activeBody().sex);
    segSet('bv-units', 'data-units', state.units);
    els.tabs.hidden = state.mode === 'single';
    $$('#bv-tabs [data-body]').forEach(function (btn) {
      var on = btn.getAttribute('data-body') === String(state.active);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('#bv-auto').checked = state.auto;
    $('#bv-lines').checked = state.lines;
    $('#bv-ruler').checked = state.ruler;
    $$('#bv-swatches button').forEach(function (btn, i) {
      btn.classList.toggle('is-on', i === state.color);
      btn.setAttribute('aria-pressed', i === state.color ? 'true' : 'false');
    });
    var ml = $('#bv-model-lbl'); if (ml) ml.textContent = state.mode === 'single' ? 'Model' : 'Model for ' + (state.active === 0 ? 'A' : 'B');
    var editing = els.presetLbl;
    editing.textContent = state.mode === 'single' ? 'Try a shape' : 'Try a shape on ' + (state.active === 0 ? 'A' : 'B');
    if (opts && opts.keepInput) {
      var keep = fieldEls[opts.keepInput].num;
      var prev = keep.value;
      syncFields();
      keep.value = prev;
    } else syncFields();
    syncChips();
    if (state.mode !== 'single') els.hint.classList.add('is-gone');
    els.angle.value = String(Math.round(((state.angle % 360) + 360) % 360));
    $$('#bv-viewbar [data-view]').forEach(function (btn) {
      var a = ((state.angle % 360) + 360) % 360;
      var v = parseFloat(btn.getAttribute('data-view'));
      btn.classList.toggle('is-on', Math.abs(a - v) < 2);
    });
    els.spin.classList.toggle('is-on', state.spin);
    els.spin.setAttribute('aria-pressed', state.spin ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------ */
  /* Metrics + results                                                   */
  /* ------------------------------------------------------------------ */
  function metricsOf(b) {
    var bmi = C.bmiOf(b), hr = C.healthyRange(b), bf = C.bodyFat(b);
    return {
      bmi: bmi, bmiCat: C.bmiCategory(bmi), hr: hr,
      whr: C.whrOf(b), whrNote: C.whrNote(b),
      whtr: C.whtrOf(b), whtrNote: C.whtrNote(b),
      bf: bf, bfNote: C.bodyFatNote(b, bf),
      shape: C.classify(b)
    };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderResults() {
    var list = shownBodies();
    var ms = list.map(metricsOf);
    var two = list.length === 2;
    function rows(fn, sub) {
      return ms.map(function (m, i) {
        return '<div class="bv-mrow">' + (two ? '<span class="bv-tag">' + (i ? 'B' : 'A') + '</span>' : '') +
               '<span class="bv-big">' + fn(m, list[i]) + '</span>' +
               (sub ? '<span class="bv-sub">' + esc(sub(m, list[i])) + '</span>' : '') + '</div>';
      }).join('');
    }
    var html = '';
    html += '<article class="bv-metric"><h3>BMI</h3>' + rows(function (m) { return m.bmi.toFixed(1); }, function (m) { return m.bmiCat; }) +
            '<p class="bv-msub">Healthy range at ' + fmtLen(list[0].height) + ': ' +
            num(toDisp('weight', ms[0].hr[0]), 0) + '\u2013' + num(toDisp('weight', ms[0].hr[1]), 0) + ' ' + unitOf('weight') + '. Adults only. <a href="/body-frame-size-calculator/">Check your frame size \u2192</a></p></article>';
    html += '<article class="bv-metric"><h3>Waist-to-hip ratio</h3>' + rows(function (m) { return m.whr.toFixed(2); }, function (m, b) { return m.whrNote; }) + '<p class="bv-msub"><a href="/waist-to-hip-ratio-calculator/">Read the WHR guide \u2192</a></p></article>';
    html += '<article class="bv-metric"><h3>Waist-to-height ratio</h3>' + rows(function (m) { return m.whtr.toFixed(2); }, function (m) { return m.whtrNote; }) + '<p class="bv-msub"><a href="/waist-to-height-ratio-calculator/">Read the WHtR guide \u2192</a></p></article>';
    html += '<article class="bv-metric"><h3>Body fat (estimate)</h3>' + rows(function (m) { return '~' + num(m.bf, 0) + '%'; }, function (m) { return m.bfNote; }) +
            '<p class="bv-msub">US Navy circumference method. Typically within a few percentage points; not a scan.</p></article>';
    html += '<article class="bv-metric"><h3>Body shape</h3>' + ms.map(function (m, i) {
      return '<div class="bv-mrow">' + (two ? '<span class="bv-tag">' + (i ? 'B' : 'A') + '</span>' : '') +
             '<span class="bv-big bv-shape">' + esc(m.shape.name) + '</span></div>';
    }).join('') + '<p class="bv-msub">' + ms.map(function (m) {
      return '<a href="' + m.shape.url + '">Read the ' + esc(m.shape.name) + ' guide \u2192</a>';
    }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('<br>') + '</p></article>';
    els.cards.innerHTML = html;

    // ---- compact live panel (sits beside / under the figure) ----
    function lrow(i, value, tag, cls) {
      return '<div class="bv-li-row">' + (two ? '<span class="bv-tag">' + (i ? 'B' : 'A') + '</span>' : '') +
             '<b class="bv-li-v' + (cls ? ' ' + cls : '') + '">' + value + '</b>' + (tag ? '<span class="bv-li-tag">' + esc(tag) + '</span>' : '') + '</div>';
    }
    function litem(k, rowsFn, note) {
      var kk = k.split('|');
      return '<div class="bv-li"><div class="bv-li-k"><span class="k-long">' + kk[0] + '</span><span class="k-short">' + (kk[1] || kk[0]) + '</span></div>' + ms.map(function (m, i) { return rowsFn(m, list[i], i); }).join('') +
             (note && !two ? '<div class="bv-li-note">' + note + '</div>' : '') + '</div>';
    }
    var lv = '';
    lv += litem('BMI', function (m, b, i) { return lrow(i, m.bmi.toFixed(1), C.bmiShort(m.bmi)); },
      'Healthy range for this height: ' + num(toDisp('weight', ms[0].hr[0]), 0) + '\u2013' + num(toDisp('weight', ms[0].hr[1]), 0) + ' ' + unitOf('weight'));
    lv += litem('Waist / hip|WHR', function (m, b, i) { return lrow(i, m.whr.toFixed(2), C.whrShort(b)); }, esc(ms[0].whrNote));
    lv += litem('Waist / height|WHtR', function (m, b, i) { return lrow(i, m.whtr.toFixed(2), C.whtrShort(b)); }, esc(ms[0].whtrNote));
    lv += litem('Body fat|Fat %', function (m, b, i) { return lrow(i, '~' + num(m.bf, 0) + '%', C.bodyFatShort(b, m.bf)); }, 'US Navy estimate \u00B7 ' + esc(ms[0].bfNote));
    lv += litem('Shape', function (m, b, i) { return lrow(i, esc(m.shape.name), '', 'is-shape'); },
      '<a href="' + ms[0].shape.url + '">Read the guide \u2192</a>');
    els.liveGrid.innerHTML = lv;
    els.live.classList.toggle('is-two', two);

    // comparison table
    if (two) {
      var A = list[0], B = list[1], mA = ms[0], mB = ms[1];
      var rowsT = [];
      [['height', 'Height'], ['weight', 'Weight'], ['bust', A.sex === B.sex ? (A.sex === 'f' ? 'Bust' : 'Chest') : 'Bust / chest'], ['waist', 'Waist'], ['hips', 'Hips']].forEach(function (p) {
        var k = p[0], d = toDisp(k, B[k]) - toDisp(k, A[k]);
        rowsT.push([p[1], num(toDisp(k, A[k]), 1) + ' ' + unitOf(k), num(toDisp(k, B[k]), 1) + ' ' + unitOf(k), (d > 0 ? '+' : '') + num(d, 1) + ' ' + unitOf(k), d]);
      });
      function mrow(label, a, b2, dp, suffix) {
        var d = b2 - a;
        rowsT.push([label, num(a, dp) + suffix, num(b2, dp) + suffix, (d > 0 ? '+' : '') + num(d, dp) + suffix, d]);
      }
      mrow('BMI', mA.bmi, mB.bmi, 1, '');
      mrow('Waist-to-hip', mA.whr, mB.whr, 2, '');
      mrow('Waist-to-height', mA.whtr, mB.whtr, 2, '');
      mrow('Body fat (est.)', mA.bf, mB.bf, 0, '%');
      rowsT.push(['Shape', mA.shape.name, mB.shape.name, mA.shape.key === mB.shape.key ? 'Same' : 'Changes', 0]);
      var th = '<caption class="bv-sr">Measurements and metrics for A and B</caption><thead><tr><th scope="col">Measure</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Change</th></tr></thead><tbody>';
      rowsT.forEach(function (r) { th += '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td class="bv-delta">' + esc(r[3]) + '</td></tr>'; });
      els.table.innerHTML = th + '</tbody>';
      els.tableWrap.hidden = false;
    } else {
      els.tableWrap.hidden = true;
    }

    // gentle wellbeing note
    var low = ms.some(function (m) { return m.bmi < 18.5; });
    els.softNote.hidden = !low;
    els.softShort.hidden = !low;
    if (low) els.softShort.textContent = 'BMI is in the underweight range \u2014 a reference, not a target. See the note below.';
    if (low) {
      els.softNote.textContent = state.mode === 'single'
        ? 'This BMI is in the underweight range. The visualizer is a reference tool, not a target \u2014 if weight loss is on your mind, a doctor or registered dietitian can help you decide what is healthy for you.'
        : 'One of these bodies has a BMI in the underweight range. A goal outline is a reference, not an ideal \u2014 if you are considering a lower weight, please talk with a doctor or registered dietitian first.';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  var modelCache = {};
  var modelKeys = [];
  function modelFor(b) {
    var key = b.sex + VIEW_KEYS.map(function (k) { return b[k].toFixed(2); }).join(',');
    if (modelCache[key]) return modelCache[key];
    var m = C.buildModel(b);
    modelCache[key] = m; modelKeys.push(key);
    if (modelKeys.length > 12) delete modelCache[modelKeys.shift()];
    return m;
  }

  var offCanvas = document.createElement('canvas');
  var imgCache = {};
  function getImage(name, w, h) {
    var c = imgCache[name];
    if (!c || c.w !== w || c.h !== h) {
      var oc = name === 'main' ? offCanvas : (c && c.canvas) || document.createElement('canvas');
      oc.width = w; oc.height = h;
      var octx = oc.getContext('2d');
      c = imgCache[name] = { w: w, h: h, canvas: oc, ctx: octx, img: octx.createImageData(w, h) };
    } else c.img.data.fill(0);
    return c;
  }

  function ghostOver(bufA, bufB, w, h, t, rgb) {
    var W4 = w * 4, y, x, i, a;
    for (y = t; y < h - t; y++) {
      for (x = t; x < w - t; x++) {
        i = y * W4 + x * 4;
        if (bufB[i + 3] === 0) continue;
        var edge = bufB[i - t * 4 + 3] === 0 || bufB[i + t * 4 + 3] === 0 || bufB[i - t * W4 + 3] === 0 || bufB[i + t * W4 + 3] === 0;
        a = edge ? 0.95 : 0.17;
        if (bufA[i + 3] === 0) { bufA[i] = rgb[0]; bufA[i + 1] = rgb[1]; bufA[i + 2] = rgb[2]; bufA[i + 3] = Math.round(255 * a); }
        else {
          bufA[i] = bufA[i] * (1 - a) + rgb[0] * a; bufA[i + 1] = bufA[i + 1] * (1 - a) + rgb[1] * a; bufA[i + 2] = bufA[i + 2] * (1 - a) + rgb[2] * a;
        }
      }
    }
  }

  var B_RGB = [79, 209, 197], B_TXT = '#6fe0d5', A_TXT = '#e8c97a';
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function label(c, text, x, y, align, color, size, weight) {
    c.font = (weight || 500) + ' ' + (size || 11) + 'px ' + FONT;
    c.textAlign = align; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(13,13,13,.85)'; c.lineJoin = 'round';
    c.strokeText(text, x, y);
    c.fillStyle = color; c.fillText(text, x, y);
  }

  function drawScene(c, W, H, o) {
    var items = o.items, n = items.length, mode = o.mode;
    var sep = mode === 'compare' && n === 2;
    var rulerW = o.ruler ? 44 : 8;
    var topPad = 30, botPad = sep ? 38 : 20;
    var maxH = 0, maxR = 0;
    items.forEach(function (it) { maxH = Math.max(maxH, it.body.height); maxR = Math.max(maxR, it.model.Rb); });
    var availW = W - rulerW - 12;
    var showText = o.lines && (mode === 'single' || W >= 520);
    var perW = sep ? availW / 2 : availW;
    var wFrac = showText ? 0.60 : 0.86;
    var scale = Math.min((H - topPad - botPad) / (maxH * 1.02), (perW * wFrac) / (2 * maxR));
    var gy = H - botPad;
    var cxs;
    if (sep) cxs = [rulerW + availW * 0.25, rulerW + availW * 0.75];
    else cxs = [rulerW + availW * (mode === 'single' && showText ? 0.42 : 0.5)];
    var theta = o.theta * Math.PI / 180;
    var col = o.color;

    // ground shadow
    items.forEach(function (it, i) {
      var cx = sep ? cxs[i] : cxs[0];
      var rx = Math.max(38, maxR * scale * 0.95), ry = rx * 0.16;
      var g = c.createRadialGradient(cx, gy, 2, cx, gy, rx);
      g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.translate(0, 0); c.setTransform(o.dpr || 1, 0, 0, o.dpr || 1, o.ox || 0, o.oy || 0);
      c.translate(cx, gy); c.scale(1, ry / rx); c.translate(-cx, -gy);
      c.fillStyle = g; c.beginPath(); c.arc(cx, gy, rx, 0, Math.PI * 2); c.fill(); c.restore();
      if (mode === 'overlay') return;
    });

    // body raster
    var rs = o.rs, rw = Math.round(W * rs), rh = Math.round(H * rs);
    var main = getImage('main', rw, rh);
    if (mode === 'overlay' && n === 2) {
      C.rasterize(main.img.data, rw, rh, items[0].model, { cxPx: cxs[0] * rs, groundPx: gy * rs, scale: scale * rs, theta: theta, color: col });
      var ghost = getImage('ghost', rw, rh);
      C.rasterize(ghost.img.data, rw, rh, items[1].model, { cxPx: cxs[0] * rs, groundPx: gy * rs, scale: scale * rs, theta: theta, color: B_RGB });
      ghostOver(main.img.data, ghost.img.data, rw, rh, Math.max(1, Math.round(rs * 0.85)), B_RGB);
    } else {
      items.forEach(function (it, i) {
        C.rasterize(main.img.data, rw, rh, it.model, { cxPx: (sep ? cxs[i] : cxs[0]) * rs, groundPx: gy * rs, scale: scale * rs, theta: theta, color: col });
      });
    }
    main.ctx.putImageData(main.img, 0, 0);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.setTransform(o.dpr || 1, 0, 0, o.dpr || 1, o.ox || 0, o.oy || 0);
    c.drawImage(main.canvas, 0, 0, W, H);
    c.restore();

    c.save(); c.setTransform(o.dpr || 1, 0, 0, o.dpr || 1, o.ox || 0, o.oy || 0);

    // ruler
    if (o.ruler) {
      var rx0 = 10;
      c.strokeStyle = 'rgba(138,138,138,.55)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(rx0 + .5, gy); c.lineTo(rx0 + .5, gy - maxH * scale); c.stroke();
      var minor = isMetric() ? 10 : 2.54 * 6, majorEvery = isMetric() ? 5 : 2;
      for (var v = 0, k = 0; v <= maxH + 0.01; v += minor, k++) {
        var yy = Math.round(gy - v * scale) + .5, major = k % majorEvery === 0;
        c.beginPath(); c.moveTo(rx0, yy); c.lineTo(rx0 + (major ? 10 : 5), yy); c.stroke();
        if (major && v > 0) {
          c.font = '500 10px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#8a8a8a';
          c.fillText(isMetric() ? String(Math.round(v)) : Math.round(v / 30.48) + '\u2032', rx0 + 14, yy);
        }
      }
    }

    // ground line
    c.strokeStyle = 'rgba(201,168,76,.28)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(rulerW - 4, Math.round(gy) + .5); c.lineTo(W - 8, Math.round(gy) + .5); c.stroke();

    // per body annotations
    items.forEach(function (it, i) {
      var cx = sep ? cxs[i] : cxs[0];
      var isB = i === 1;
      var name = n === 2 ? (isB ? 'B \u00B7 Goal' : 'A \u00B7 Current') : '';
      var head = fmtHeight(it.body.height);
      if (mode === 'overlay' && n === 2) {
        if (i === 0) label(c, 'A ' + head + '  \u00B7  B ' + fmtHeight(items[1].body.height), cx, gy - Math.max(it.body.height, items[1].body.height) * scale - 12, 'center', '#f5efe0', 11, 600);
      } else {
        label(c, (n === 2 ? (isB ? 'B ' : 'A ') : '') + head, cx, gy - it.body.height * scale - 12, 'center', '#f5efe0', 11, 600);
      }
      if (sep) label(c, name, cx, gy + 20, 'center', isB ? B_TXT : '#c9a84c', 11, 600);
      if (o.lines) {
        var side = (mode === 'single') ? 1 : (isB ? 1 : -1);
        var lv = it.model.levels;
        var lineCol = isB ? 'rgba(79,209,197,.85)' : 'rgba(232,201,122,.75)';
        var txtCol = isB ? B_TXT : A_TXT;
        [['bust', it.body.sex === 'f' ? 'Bust' : 'Chest'], ['waist', 'Waist'], ['hips', 'Hips']].forEach(function (p) {
          var y = lv[p[0]];
          var ext = C.extentsAt(it.model, y, theta);
          if (!ext) return;
          var xa = cx + ext[0] * scale - 8, xb = cx + ext[1] * scale + 8, py = gy - y * scale;
          c.setLineDash([4, 3]); c.strokeStyle = lineCol; c.lineWidth = 1;
          c.beginPath(); c.moveTo(xa, py); c.lineTo(xb, py); c.stroke(); c.setLineDash([]);
          if (!showText) return;
          var compact = mode === 'compare';
          var txt = compact ? num(toDisp(p[0], it.body[p[0]]), 1)
                            : p[1] + ' ' + (o.narrow ? num(toDisp(p[0], it.body[p[0]]), 0) : fmtVal(p[0], it.body[p[0]]));
          c.font = '600 11px ' + FONT;
          var tw = c.measureText(txt).width, s2 = side;
          if (!compact) {
            if (s2 > 0 && xb + 6 + tw > W - 4) s2 = -1;
            if (s2 < 0 && xa - 6 - tw < rulerW) s2 = 1;
          } else if ((s2 > 0 && xb + 6 + tw > W - 4) || (s2 < 0 && xa - 6 - tw < rulerW)) return;
          label(c, txt, s2 > 0 ? xb + 6 : xa - 6, py, s2 > 0 ? 'left' : 'right', txtCol, 11, 600);
        });
      }
    });
    if (o.lines && mode === 'compare' && n === 2) label(c, 'Lines: bust \u00B7 waist \u00B7 hips', W - 12, 16, 'right', '#8a8a8a', 10.5, 500);
    if (mode === 'overlay' && n === 2) {
      c.font = '500 10.5px ' + FONT;
      var t2 = 'B outline', w2 = c.measureText(t2).width;
      label(c, t2, W - 12, 16, 'right', B_TXT, 10.5, 600);
      label(c, 'A solid  \u00B7  ', W - 12 - w2, 16, 'right', '#a9a9a9', 10.5, 500);
    }
    c.restore();
  }

  var pendingRender = false, hqTimer = null, lastFast = false;
  function requestRender(fast) {
    lastFast = !!fast;
    if (fast) { clearTimeout(hqTimer); hqTimer = setTimeout(function () { requestRender(false); }, 170); }
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(function () { pendingRender = false; render(lastFast); });
  }

  function render(fast) {
    var W = els.wrap.clientWidth, H = els.wrap.clientHeight;
    if (W < 40 || H < 40) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (els.canvas.width !== cw || els.canvas.height !== ch) { els.canvas.width = cw; els.canvas.height = ch; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var rs = fast ? 1 : Math.min(2, Math.sqrt(3.2e6 / (W * H)));
    rs = Math.max(1, rs);
    var list = shownBodies();
    drawScene(ctx, W, H, {
      items: list.map(function (b) { return { body: b, model: modelFor(b) }; }),
      mode: state.mode, theta: state.angle, rs: rs, dpr: dpr, ox: 0, oy: 0,
      lines: state.lines, ruler: state.ruler, color: C.SWATCHES[state.color].c, narrow: W < 460
    });
  }

  function describe() {
    var list = shownBodies();
    var v = Math.round(((state.angle % 360) + 360) % 360);
    var view = v < 20 || v > 340 ? 'front' : (Math.abs(v - 180) < 20 ? 'back' : (Math.abs(v - 90) < 20 || Math.abs(v - 270) < 20 ? 'side' : 'angled') );
    var s = list.map(function (b, i) {
      return (list.length > 1 ? (i ? 'Body B: ' : 'Body A: ') : '') + (b.sex === 'f' ? 'female' : (b.sex === 'm' ? 'male' : 'neutral')) + ' model, ' +
        fmtLen(b.height) + ' tall, ' + fmtVal('weight', b.weight) + ', ' + (b.sex === 'f' ? 'bust ' : 'chest ') + fmtVal('bust', b.bust) + ', waist ' + fmtVal('waist', b.waist) + ', hips ' + fmtVal('hips', b.hips);
    }).join('. ');
    els.canvas.setAttribute('aria-label', 'Body model, ' + view + ' view. ' + s + '. Drag or use the arrow keys to rotate.');
  }

  /* ------------------------------------------------------------------ */
  /* Update                                                              */
  /* ------------------------------------------------------------------ */
  function update(opts) {
    syncUI(opts);
    renderResults();
    describe();
    requestRender(false);
  }

  /* ------------------------------------------------------------------ */
  /* Rotation                                                            */
  /* ------------------------------------------------------------------ */
  var tween = null, spinRaf = null, lastT = 0;
  function normAngle(a) { return ((a % 360) + 360) % 360; }

  function gotoAngle(target) {
    stopSpin();
    var from = normAngle(state.angle), to = target;
    var d = ((to - from + 540) % 360) - 180;       // shortest way
    if (reduceMotion || Math.abs(d) < 0.5) { state.angle = to; syncAngleUI(); requestRender(false); return; }
    var t0 = performance.now(), dur = 420;
    cancelAnimationFrame(tween);
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      state.angle = from + d * e;
      syncAngleUI(); requestRender(t < 1);
      if (t < 1) tween = requestAnimationFrame(step); else { state.angle = normAngle(to); syncAngleUI(); }
    })(t0);
  }
  function syncAngleUI() {
    var a = normAngle(state.angle);
    els.angle.value = String(Math.round(a));
    $$('#bv-viewbar [data-view]').forEach(function (btn) {
      btn.classList.toggle('is-on', Math.abs(a - parseFloat(btn.getAttribute('data-view'))) < 2);
    });
  }
  function startSpin() {
    state.spin = true; cancelAnimationFrame(tween); lastT = performance.now();
    els.spin.classList.add('is-on'); els.spin.setAttribute('aria-pressed', 'true');
    (function step(now) {
      if (!state.spin) return;
      state.angle = normAngle(state.angle + (now - lastT) * 0.035); lastT = now;
      syncAngleUI(); requestRender(true);
      spinRaf = requestAnimationFrame(step);
    })(lastT);
  }
  function stopSpin() {
    if (!state.spin) return;
    state.spin = false; cancelAnimationFrame(spinRaf);
    els.spin.classList.remove('is-on'); els.spin.setAttribute('aria-pressed', 'false');
    requestRender(false);
  }

  /* drag to rotate */
  (function () {
    var down = false, lastX = 0;
    els.canvas.addEventListener('pointerdown', function (e) {
      down = true; lastX = e.clientX; stopSpin(); cancelAnimationFrame(tween);
      try { els.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      els.hint.classList.add('is-gone');
    });
    els.canvas.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - lastX; lastX = e.clientX;
      state.angle = normAngle(state.angle + dx * 0.6);
      syncAngleUI(); requestRender(true);
    });
    function up(e) { if (!down) return; down = false; try { els.canvas.releasePointerCapture(e.pointerId); } catch (err) {} requestRender(false); }
    els.canvas.addEventListener('pointerup', up);
    els.canvas.addEventListener('pointercancel', up);
    els.canvas.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 30 : 10;
      if (e.key === 'ArrowLeft') { state.angle = normAngle(state.angle - step); }
      else if (e.key === 'ArrowRight') { state.angle = normAngle(state.angle + step); }
      else if (e.key === 'Home') { state.angle = 0; }
      else return;
      e.preventDefault(); stopSpin(); syncAngleUI(); requestRender(true); describe();
    });
  })();

  els.angle.addEventListener('input', function () { stopSpin(); state.angle = parseFloat(els.angle.value); syncAngleUI(); requestRender(true); describe(); });
  els.spin.addEventListener('click', function () { if (state.spin) stopSpin(); else startSpin(); });
  $$('#bv-viewbar [data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { gotoAngle(parseFloat(btn.getAttribute('data-view'))); setTimeout(describe, 480); });
  });

  /* ------------------------------------------------------------------ */
  /* Controls wiring                                                     */
  /* ------------------------------------------------------------------ */
  $$('#bv-mode button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
  $$('#bv-sex button').forEach(function (b) { b.addEventListener('click', function () { changeSex(b.getAttribute('data-sex')); }); });
  $$('#bv-units button').forEach(function (b) { b.addEventListener('click', function () { state.units = b.getAttribute('data-units'); update(); }); });
  $$('#bv-tabs [data-body]').forEach(function (b) { b.addEventListener('click', function () { state.active = parseInt(b.getAttribute('data-body'), 10); update(); }); });
  $('#bv-copy-ab').addEventListener('click', function () { state.bodies[1] = C.cloneBody(state.bodies[0]); state.active = 1; update(); toast('Copied A to B'); });
  $('#bv-swap').addEventListener('click', function () { var t = state.bodies[0]; state.bodies[0] = state.bodies[1]; state.bodies[1] = t; update(); toast('Swapped A and B'); });
  $('#bv-auto').addEventListener('change', function (e) { state.auto = e.target.checked; update(); });
  $('#bv-lines').addEventListener('change', function (e) { state.lines = e.target.checked; requestRender(false); });
  $('#bv-ruler').addEventListener('change', function (e) { state.ruler = e.target.checked; requestRender(false); });
  $('#bv-reset').addEventListener('click', function () {
    var b = activeBody(), fresh = C.makeBody(b.sex);
    state.bodies[state.active] = fresh; update(); toast('Reset to a typical ' + (b.sex === 'f' ? 'female' : (b.sex === 'm' ? 'male' : 'neutral')) + ' body');
  });

  function buildSwatches() {
    C.SWATCHES.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'bv-swatch'; b.title = s.n; b.setAttribute('aria-label', 'Body colour: ' + s.n);
      b.style.background = 'rgb(' + s.c.join(',') + ')';
      b.addEventListener('click', function () { state.color = i; update(); });
      els.swatches.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toast, share, download                                              */
  /* ------------------------------------------------------------------ */
  var toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { els.toast.classList.remove('is-on'); }, 2200);
  }

  function serialize() {
    function pack(b) { return VIEW_KEYS.map(function (k) { return +b[k].toFixed(1); }).join(','); }
    var p = ['v=1', 'sx=' + state.bodies[0].sex, 'sb=' + (state.bodies[1] ? state.bodies[1].sex : state.bodies[0].sex), 'u=' + (isMetric() ? 'm' : 'i'), 'md=' + state.mode, 'c=' + state.color, 'ang=' + Math.round(normAngle(state.angle)), 'a=' + pack(state.bodies[0])];
    if (state.bodies[1] && state.mode !== 'single') p.push('b=' + pack(state.bodies[1]));
    return p.join('&');
  }
  function deserialize(hash) {
    if (!hash || hash.charAt(0) !== '#') return false;
    var q = {};
    hash.slice(1).split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (q.v !== '1' || !q.a) return false;
    function pickSex(v) { return v === 'm' || v === 'n' ? v : 'f'; }
    var sexA = pickSex(q.sx), sexB = q.sb ? pickSex(q.sb) : sexA;
    // Accepts blanks (a=165,,88,74,96,,74) so other tools can link here with only some numbers:
    // missing values are filled with typical measurements for that height and weight.
    function unpack(s, sex) {
      var parts = s.split(',');
      if (parts.length !== VIEW_KEYS.length) return null;
      var v = parts.map(function (x) { return x === '' ? NaN : parseFloat(x); });
      var H = v[0];
      if (!isFinite(H)) return null;
      var W = isFinite(v[1]) ? v[1] : 22 * Math.pow(H / 100, 2);
      var b = C.makeBody(sex, H, W);
      VIEW_KEYS.forEach(function (k, i) { if (i > 1 && isFinite(v[i])) b[k] = v[i]; });
      b.height = H; b.weight = W;
      return C.sanitize(b);
    }
    var a = unpack(q.a, sexA); if (!a) return false;
    state.bodies[0] = a;
    if (q.b) { var bb = unpack(q.b, sexB); if (bb) state.bodies[1] = bb; }
    state.units = q.u === 'i' ? 'imperial' : 'metric';
    state.mode = (q.md === 'compare' || q.md === 'overlay') && state.bodies[1] ? q.md : 'single';
    var ci = parseInt(q.c, 10); if (ci >= 0 && ci < C.SWATCHES.length) state.color = ci;
    var an = parseFloat(q.ang); if (isFinite(an)) state.angle = normAngle(an);
    state.active = 0;
    return true;
  }
  $('#bv-share').addEventListener('click', function () {
    var url = location.href.split('#')[0] + '#' + serialize();
    try { history.replaceState(null, '', '#' + serialize()); } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied \u2014 it recreates this exact setup'); }, function () { window.prompt('Copy this link:', url); });
    } else window.prompt('Copy this link:', url);
  });

  $('#bv-download').addEventListener('click', function () {
    var list = shownBodies();
    var EW = 1200, FH = 1120, TOP = 120, BOT = 330, EH = TOP + FH + BOT;
    var cv = document.createElement('canvas'); cv.width = EW; cv.height = EH;
    var c = cv.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, EH); g.addColorStop(0, '#161616'); g.addColorStop(1, '#0d0d0d');
    c.fillStyle = g; c.fillRect(0, 0, EW, EH);
    var rg = c.createRadialGradient(EW * .3, TOP + 200, 20, EW * .3, TOP + 200, 700); rg.addColorStop(0, 'rgba(201,168,76,.10)'); rg.addColorStop(1, 'rgba(201,168,76,0)');
    c.fillStyle = rg; c.fillRect(0, 0, EW, EH);
    c.fillStyle = '#f5efe0'; c.font = '900 44px "Playfair Display", Georgia, serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('Body Visualizer', 56, 78);
    c.fillStyle = '#c9a84c'; c.font = '500 18px ' + FONT; c.fillText('bodyshapecalculator.net', 56, 106);
    drawScene(c, EW, FH, {
      items: list.map(function (b) { return { body: b, model: modelFor(b) }; }),
      mode: state.mode, theta: state.angle, rs: 1, dpr: 1, ox: 0, oy: TOP,
      lines: state.lines, ruler: state.ruler, color: C.SWATCHES[state.color].c, narrow: false
    });
    // stats
    var y = TOP + FH + 30;
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 1; c.beginPath(); c.moveTo(56, y - 12); c.lineTo(EW - 56, y - 12); c.stroke();
    list.forEach(function (b, i) {
      var m = metricsOf(b), x = 56 + i * (EW / 2 - 20);
      var head = (list.length > 1 ? (i ? 'B \u00B7 Goal' : 'A \u00B7 Current') : 'Your measurements');
      c.fillStyle = '#c9a84c'; c.font = '600 16px ' + FONT; c.textAlign = 'left'; c.fillText(head.toUpperCase(), x, y + 14);
      c.fillStyle = '#f0e8d8'; c.font = '500 20px ' + FONT;
      c.fillText(fmtLen(b.height) + '  \u00B7  ' + fmtVal('weight', b.weight) + '  \u00B7  BMI ' + m.bmi.toFixed(1), x, y + 50);
      c.fillText((b.sex === 'f' ? 'Bust ' : 'Chest ') + fmtVal('bust', b.bust) + '  \u00B7  Waist ' + fmtVal('waist', b.waist) + '  \u00B7  Hips ' + fmtVal('hips', b.hips), x, y + 84);
      c.fillText('WHR ' + m.whr.toFixed(2) + '  \u00B7  WHtR ' + m.whtr.toFixed(2) + '  \u00B7  Shape: ' + m.shape.name, x, y + 118);
    });
    c.fillStyle = '#8a8a8a'; c.font = '400 15px ' + FONT;
    c.fillText('Illustrative model only \u2014 not a body scan, prediction or medical advice.', 56, EH - 44);
    cv.toBlob(function (blob) {
      if (!blob) { toast('Could not create the image'); return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'body-visualizer.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('Image saved');
    }, 'image/png');
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  function setHdr() {
    var h = document.querySelector('.site-header');
    if (h) root.style.setProperty('--bv-hdr', Math.round(h.getBoundingClientRect().height) + 'px');
  }
  setHdr();
  window.addEventListener('resize', setHdr);
  setTimeout(function () { els.hint.classList.add('is-gone'); }, 6000);

  buildFields();
  buildSwatches();
  if (location.hash) deserialize(location.hash);
  syncAngleUI();
  update();
  if (window.ResizeObserver) new ResizeObserver(function () { requestRender(false); }).observe(els.wrap);
  else window.addEventListener('resize', function () { requestRender(false); });

  // test / debug hook (harmless in production)
  if (window.BV_DEBUG) window.BVApp = { state: state, update: update, render: render };
})();
