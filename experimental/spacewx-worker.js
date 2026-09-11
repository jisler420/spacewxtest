/* SpaceWx poller: UTC boundaries, HAPI deltas, NOAA summary fallback. */
const HAPI = "https://hapi.spaceweather.knmi.nl/hapi/data";
const NOAA = {
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  scales: "https://services.swpc.noaa.gov/products/noaa-scales.json",
  kf: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
  day: "https://services.swpc.noaa.gov/text/3-day-forecast.txt",
  dst: "https://services.swpc.noaa.gov/products/kyoto-dst.json",
  dstPred: "https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json",
  hemi: "https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt",
  hemiSnap: "../data/hemi-archive.txt",
  aurora: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  sumMag: "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json",
  sumSpeed: "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json",
  kp1m: "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
};

const bodyCache = Object.create(null);
const printCache = Object.create(null);
const series = { mag: [], plasma: [], enlil: [], hp: [] };

function parseT(t) {
  let s = String(t || "").trim().replace(" ", "T");
  if (!s) return NaN;
  s = s.replace(/\.(\d{3})\d+/, ".$1");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

function parseHapiCsv(text, keys) {
  const out = [];
  String(text || "").split(/\n/).forEach(function (line) {
    if (!line || line.charAt(0) === "#") return;
    const p = line.trim().split(",");
    const t = parseT(p[0]);
    if (!Number.isFinite(t)) return;
    const rec = { t: t };
    let ok = false;
    keys.forEach(function (k, i) {
      const v = Number(p[i + 1]);
      if (Number.isFinite(v) && v > -1e20 && v < 1e20 && v !== -9999) {
        rec[k] = v;
        ok = true;
      }
    });
    if (ok) rec.fill = false;
    else rec.fill = true;
    out.push(rec);
  });
  return out;
}

function isoH(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fingerprint(x) {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  let h = 0;
  const n = Math.min(s.length, 24000);
  for (let i = 0; i < n; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return h + ":" + s.length;
}

function seriesFp(arr) {
  if (!arr || !arr.length) return "0";
  const last = arr[arr.length - 1];
  return arr.length + ":" + last.t + ":" + (last.fill ? 1 : 0);
}

function mergeRows(oldArr, neu) {
  if (!neu || !neu.length) return oldArr || [];
  if (!oldArr || !oldArr.length) return neu;
  const lastRowT = oldArr[oldArr.length - 1].t;
  const add = neu.filter(function (r) { return r.t > lastRowT; });
  const cut = Date.now() - 37 * 3600000;
  return oldArr.concat(add).filter(function (r) { return r.t >= cut; });
}

function hapiStart(arr) {
  if (arr && arr.length) return isoH(new Date(arr[arr.length - 1].t - 120000));
  return isoH(new Date(Date.now() - 36 * 3600000));
}

function lastT(arr) {
  return arr && arr.length && Number.isFinite(arr[arr.length - 1].t) ? arr[arr.length - 1].t : 0;
}
function lastGoodT(arr, keys) {
  if (!arr || !arr.length) return 0;
  keys = keys || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const r = arr[i];
    for (let k = 0; k < keys.length; k++) {
      if (Number.isFinite(r[keys[k]])) return r.t;
    }
  }
  return 0;
}
function isStale(arr, maxAge, keys) {
  const t = keys && keys.length ? lastGoodT(arr, keys) : lastT(arr);
  return !t || (Date.now() - t > maxAge);
}

function mixSignal(outer) {
  try {
    const t = AbortSignal.timeout(12000);
    if (!outer) return t;
    if (typeof AbortSignal.any === "function") return AbortSignal.any([outer, t]);
    return outer;
  } catch (e) {
    return outer || undefined;
  }
}

async function grab(u, signal) {
  const r = await fetch(u, { cache: "no-store", signal: mixSignal(signal) });
  if (!r.ok) throw new Error(String(r.status));
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") || u.endsWith(".json") ? await r.json() : await r.text();
  bodyCache[u] = data;
  return { data: data, cached: false };
}

async function settled(u, signal) {
  try {
    return await grab(u, signal);
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return null;
  }
}

async function hapi(id, params, start, stop, signal) {
  const u = HAPI + "?id=" + id + "&parameters=" + params + "&start=" + start + "&stop=" + stop + "&format=csv";
  const got = await settled(u, signal);
  if (!got || got.data == null) return [];
  const txt = typeof got.data === "string" ? got.data : String(got.data);
  return parseHapiCsv(txt, params.split(","));
}

function asRow(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) obj = obj[obj.length - 1] || obj[0];
  if (!obj || typeof obj !== "object") return null;
  return obj;
}

async function noaaSummary(signal) {
  const [sm, sw] = await Promise.all([
    settled(NOAA.sumMag, signal),
    settled(NOAA.sumSpeed, signal)
  ]);
  const mag = asRow(sm && sm.data);
  const wind = asRow(sw && sw.data);
  const out = { mag: null, plasma: null };
  if (mag) {
    const t = parseT(mag.time_tag);
    const bt = Number(mag.bt);
    const bz = Number(mag.bz_gsm);
    if (Number.isFinite(t) && (Number.isFinite(bt) || Number.isFinite(bz))) {
      out.mag = [{ t: t, bt: bt, bz_gsm: bz, bx_gsm: Number(mag.bx_gsm), by_gsm: Number(mag.by_gsm) }];
    }
  }
  if (wind) {
    const t = parseT(wind.time_tag);
    const speed = Number(wind.proton_speed);
    if (Number.isFinite(t) && Number.isFinite(speed)) {
      out.plasma = [{ t: t, speed: speed, density: Number(wind.proton_density), temperature: Number(wind.proton_temperature) }];
    }
  }
  return out;
}

const src = { mag: "", plasma: "", hp: "", dst: "", kp: "" };

function putIfChanged(out, key, value) {
  if (value == null) return false;
  const fp = fingerprint(value);
  if (printCache[key] === fp) return false;
  printCache[key] = fp;
  out[key] = value;
  return true;
}

function putSeries(out, key, arr) {
  if (!arr) return false;
  const fp = seriesFp(arr);
  if (printCache[key] === fp) return false;
  printCache[key] = fp;
  out[key] = arr;
  return true;
}

async function ovationIfNew(signal) {
  try {
    const r = await fetch(NOAA.aurora, {
      cache: "no-store",
      signal: mixSignal(signal),
      headers: { Range: "bytes=0-700" }
    });
    const txt = await r.text();
    const m = txt.match(/"Observation Time"\s*:\s*"([^"]+)"/);
    const obs = m ? m[1] : "";
    if (r.status === 206 && obs && printCache.auroraObs === obs) return null;
    if (r.status === 200 && txt.charAt(0) === "{") {
      try { return { data: JSON.parse(txt) }; } catch (e) {}
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
  }
  return settled(NOAA.aurora, signal);
}

async function collect(kind, signal) {
  const now = new Date();
  const stop = isoH(new Date(now.getTime() + 3600000));
  const out = { fetchedAt: Date.now(), kind: kind };
  let changed = false;
  const wantFast = kind === "fast" || kind === "all";
  const wantSlow = kind === "slow" || kind === "all";

  if (wantFast) {
    const [mag, plasma, dstGot, aurora, kp1mGot] = await Promise.all([
      hapi("solar_wind_mag_rt", "bt,bx_gsm,by_gsm,bz_gsm", hapiStart(series.mag), stop, signal),
      hapi("solar_wind_plasma_rt", "density,speed,temperature", hapiStart(series.plasma), stop, signal),
      settled(NOAA.dst, signal),
      ovationIfNew(signal),
      settled(NOAA.kp1m, signal),
    ]);
    series.mag = mergeRows(series.mag, mag);
    series.plasma = mergeRows(series.plasma, plasma);
    src.mag = mag.length ? "KNMI" : src.mag;
    src.plasma = plasma.length ? "KNMI" : src.plasma;
    if (isStale(series.mag, 10 * 60000, ["bt", "bz_gsm"]) || isStale(series.plasma, 10 * 60000, ["speed", "density"])) {
      const sum = await noaaSummary(signal);
      if (sum.mag && sum.mag.length) {
        series.mag = mergeRows(series.mag, sum.mag);
        src.mag = "NOAA summary";
      }
      if (sum.plasma && sum.plasma.length) {
        series.plasma = mergeRows(series.plasma, sum.plasma);
        src.plasma = "NOAA summary";
      }
    }
    let dst = dstGot;
    if (dst && dst.data) src.dst = "Kyoto";
    if (putSeries(out, "mag", series.mag)) changed = true;
    if (putSeries(out, "plasma", series.plasma)) changed = true;
    if (dst && putIfChanged(out, "dst", dst.data)) changed = true;
    if (aurora && aurora.data) {
      const a = aurora.data;
      const stamp = String(a["Observation Time"] || a["Forecast Time"] || "") + ":" + ((a.coordinates && a.coordinates.length) || 0);
      printCache.auroraObs = a["Observation Time"] || "";
      if (printCache.aurora !== stamp) {
        printCache.aurora = stamp;
        out.aurora = a;
        changed = true;
      }
    }
    if (kp1mGot && kp1mGot.data) {
      const rows = Array.isArray(kp1mGot.data) ? kp1mGot.data : [];
      const cut = Date.now() - 35 * 60000;
      const recent = [];
      rows.forEach(function (r) {
        const t = parseT(r && r.time_tag);
        const k = Number(r && (r.estimated_kp != null ? r.estimated_kp : r.kp));
        if (Number.isFinite(t) && t >= cut && Number.isFinite(k)) recent.push({ time_tag: r.time_tag, estimated_kp: k, kp: r.kp });
      });
      if (recent.length && putIfChanged(out, "kp1m", recent)) changed = true;
    }
  }

  if (wantSlow) {
    const [enlil, hp, kpGot, sc, kf, dayTxt, dstPred, hemi, hemiSnap, hp30txt] = await Promise.all([
      hapi("solar_wind_plasma_enlil_metoffice", "density,speed,bt", hapiStart(series.enlil), stop, signal),
      hapi("hp30_index", "Hp30", hapiStart(series.hp), stop, signal),
      settled(NOAA.kp, signal),
      settled(NOAA.scales, signal),
      settled(NOAA.kf, signal),
      settled(NOAA.day, signal),
      settled(NOAA.dstPred, signal),
      settled(NOAA.hemi, signal),
      settled(NOAA.hemiSnap, signal),
      settled("./hp30.txt", signal),
    ]);
    series.enlil = mergeRows(series.enlil, enlil);
    series.hp = mergeRows(series.hp, hp);
    src.hp = series.hp.length ? "KNMI" : (hp30txt && hp30txt.data ? "GFZ" : "");
    let kp = kpGot;
    if (!kp || !kp.data) {
      const knmiKp = await hapi("kp_index", "Kp", isoH(new Date(Date.now() - 3 * 86400000)), stop, signal);
      if (knmiKp.length) {
        kp = { data: knmiKp.map(function (r) { return { time_tag: new Date(r.t).toISOString(), Kp: r.Kp }; }) };
        src.kp = "KNMI";
      }
    } else src.kp = "NOAA";
    if (putSeries(out, "enlil", series.enlil)) changed = true;
    if (putSeries(out, "hp", series.hp)) changed = true;
    if (kp && putIfChanged(out, "kp", kp.data)) changed = true;
    if (sc && putIfChanged(out, "sc", sc.data)) changed = true;
    if (kf && putIfChanged(out, "kf", kf.data)) changed = true;
    if (dayTxt && putIfChanged(out, "dayTxt", dayTxt.data)) changed = true;
    if (dstPred && putIfChanged(out, "dstPred", dstPred.data)) changed = true;
    if (hemiSnap && putIfChanged(out, "hemiSnap", hemiSnap.data)) changed = true;
    if (hemi && putIfChanged(out, "hemi", hemi.data)) changed = true;
    if (hp30txt && putIfChanged(out, "hp30txt", hp30txt.data)) changed = true;
  }

  out.changed = changed;
  out.health = {
    mag: series.mag.length > 0,
    plasma: series.plasma.length > 0,
    dst: !!(bodyCache[NOAA.dst] || src.dst),
    dstPred: !!bodyCache[NOAA.dstPred],
    hemi: !!bodyCache[NOAA.hemi] || !!bodyCache[NOAA.hemiSnap],
    hp: series.hp.length > 0 || !!bodyCache["./hp30.txt"],
    kp: !!(bodyCache[NOAA.kp] || src.kp),
    scales: !!bodyCache[NOAA.scales],
    forecast: !!(bodyCache[NOAA.kf] || bodyCache[NOAA.day]),
    aurora: !!printCache.aurora || !!bodyCache[NOAA.aurora],
    kp1m: !!bodyCache[NOAA.kp1m],
    magSrc: src.mag,
    plasmaSrc: src.plasma,
    hpSrc: src.hp,
    dstSrc: src.dst,
    kpSrc: src.kp
  };
  return out;
}

let running = { fast: null, slow: null };
async function loop(kind) {
  kind = kind || "fast";
  const keys = kind === "all" ? ["fast", "slow"] : [kind];
  const ac = new AbortController();
  keys.forEach(function (k) {
    if (running[k] && running[k] !== ac) {
      try { running[k].abort(); } catch (e) {}
    }
    running[k] = ac;
  });
  try {
    const data = await collect(kind, ac.signal);
    if (ac.signal.aborted) return;
    postMessage({ type: "update", data: data });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    postMessage({ type: "error", error: String(e && e.message ? e.message : e) });
  } finally {
    keys.forEach(function (k) { if (running[k] === ac) running[k] = null; });
  }
}

let userSec = 60;
let hidden = false;
let waitFast = null, waitSlow = null;

function effectiveFast() {
  return hidden ? 300 : ([60, 300].indexOf(userSec) >= 0 ? userSec : 60);
}

function msToBoundary(period) {
  const p = Math.max(1000, period);
  return Math.max(250, p - (Date.now() % p));
}

function arm() {
  const fast = effectiveFast() * 1000;
  const slow = 300000;
  if (waitFast) clearTimeout(waitFast);
  if (waitSlow) clearTimeout(waitSlow);
  function tickFast() {
    Promise.resolve(loop("fast")).then(function () {
      waitFast = setTimeout(tickFast, msToBoundary(effectiveFast() * 1000));
    });
  }
  function tickSlow() {
    Promise.resolve(loop("slow")).then(function () {
      waitSlow = setTimeout(tickSlow, msToBoundary(300000));
    });
  }
  waitFast = setTimeout(tickFast, msToBoundary(fast));
  waitSlow = setTimeout(tickSlow, msToBoundary(slow));
}

onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === "poll") loop(msg.kind || "fast");
  if (msg.type === "config") {
    if (msg.pollSec != null) userSec = Number(msg.pollSec);
    if (typeof msg.hidden === "boolean") hidden = msg.hidden;
    arm();
  }
};

loop("fast");
loop("slow");
arm();
