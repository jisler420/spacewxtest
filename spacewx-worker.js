/* SpaceWx poller: split cadence, HAPI deltas, 304s, backoff, abort. */
const HAPI = "https://hapi.spaceweather.knmi.nl/hapi/data";
const NOAA = {
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  scales: "https://services.swpc.noaa.gov/products/noaa-scales.json",
  kf: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
  day: "https://services.swpc.noaa.gov/text/3-day-forecast.txt",
  dst: "https://services.swpc.noaa.gov/products/kyoto-dst.json",
  dstPred: "https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json",
  hemi: "https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt",
  aurora: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
};

const etag = Object.create(null);
const lastMod = Object.create(null);
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
    if (ok) out.push(rec);
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

function mergeRows(oldArr, neu) {
  if (!neu || !neu.length) return oldArr || [];
  if (!oldArr || !oldArr.length) return neu;
  const lastT = oldArr[oldArr.length - 1].t;
  const add = neu.filter(function (r) { return r.t > lastT; });
  const cut = Date.now() - 37 * 3600000;
  return oldArr.concat(add).filter(function (r) { return r.t >= cut; });
}

function hapiStart(arr) {
  if (arr && arr.length) return isoH(new Date(arr[arr.length - 1].t - 120000));
  return isoH(new Date(Date.now() - 36 * 3600000));
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
  const headers = {};
  if (etag[u]) headers["If-None-Match"] = etag[u];
  if (lastMod[u]) headers["If-Modified-Since"] = lastMod[u];
  const r = await fetch(u, { cache: "no-cache", headers: headers, signal: mixSignal(signal) });
  if (r.status === 304 && bodyCache[u] !== undefined) return { data: bodyCache[u], cached: true };
  if (!r.ok) throw new Error(String(r.status));
  const e = r.headers.get("etag");
  const m = r.headers.get("last-modified");
  if (e) etag[u] = e;
  if (m) lastMod[u] = m;
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") || u.endsWith(".json") ? await r.json() : await r.text();
  bodyCache[u] = data;
  return { data: data, cached: false };
}

async function settled(u, signal) {
  try {
    return await grab(u, signal);
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) throw e;
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

function putIfChanged(out, key, value) {
  if (value == null) return false;
  const fp = fingerprint(value);
  if (printCache[key] === fp) return false;
  printCache[key] = fp;
  out[key] = value;
  return true;
}

async function collect(kind, signal) {
  const now = new Date();
  const stop = isoH(new Date(now.getTime() + 3600000));
  const out = { fetchedAt: Date.now(), kind: kind };
  let changed = false;
  const wantFast = kind === "fast" || kind === "all";
  const wantSlow = kind === "slow" || kind === "all";

  if (wantFast) {
    const [mag, plasma, dst, hemi] = await Promise.all([
      hapi("solar_wind_mag_rt", "bt,bx_gsm,by_gsm,bz_gsm", hapiStart(series.mag), stop, signal),
      hapi("solar_wind_plasma_rt", "density,speed,temperature", hapiStart(series.plasma), stop, signal),
      settled(NOAA.dst, signal),
      settled(NOAA.hemi, signal),
    ]);
    series.mag = mergeRows(series.mag, mag);
    series.plasma = mergeRows(series.plasma, plasma);
    if (putIfChanged(out, "mag", series.mag)) changed = true;
    if (putIfChanged(out, "plasma", series.plasma)) changed = true;
    if (dst && putIfChanged(out, "dst", dst.data)) changed = true;
    if (hemi && putIfChanged(out, "hemi", hemi.data)) changed = true;
  }

  if (wantSlow) {
    const [enlil, hp, kp, sc, kf, dayTxt, dstPred, aurora, hp30txt] = await Promise.all([
      hapi("solar_wind_plasma_enlil_metoffice", "density,speed,bt", hapiStart(series.enlil), stop, signal),
      hapi("hp30_index", "Hp30", hapiStart(series.hp), stop, signal),
      settled(NOAA.kp, signal),
      settled(NOAA.scales, signal),
      settled(NOAA.kf, signal),
      settled(NOAA.day, signal),
      settled(NOAA.dstPred, signal),
      settled(NOAA.aurora, signal),
      settled("./hp30.txt", signal),
    ]);
    series.enlil = mergeRows(series.enlil, enlil);
    series.hp = mergeRows(series.hp, hp);
    if (putIfChanged(out, "enlil", series.enlil)) changed = true;
    if (putIfChanged(out, "hp", series.hp)) changed = true;
    if (kp && putIfChanged(out, "kp", kp.data)) changed = true;
    if (sc && putIfChanged(out, "sc", sc.data)) changed = true;
    if (kf && putIfChanged(out, "kf", kf.data)) changed = true;
    if (dayTxt && putIfChanged(out, "dayTxt", dayTxt.data)) changed = true;
    if (dstPred && putIfChanged(out, "dstPred", dstPred.data)) changed = true;
    if (aurora && aurora.data) {
      const a = aurora.data;
      const stamp = String(a["Observation Time"] || a["Forecast Time"] || "") + ":" + ((a.coordinates && a.coordinates.length) || 0);
      if (printCache.aurora !== stamp) {
        printCache.aurora = stamp;
        out.aurora = a;
        changed = true;
      }
    }
    if (hp30txt && putIfChanged(out, "hp30txt", hp30txt.data)) changed = true;
  }

  out.changed = changed;
  return out;
}

let running = { fast: null, slow: null };
let fails = 0;
async function loop(kind) {
  kind = kind || "fast";
  const keys = kind === "all" ? ["fast", "slow"] : [kind];
  if (kind !== "all" && running[kind]) return;
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
    fails = 0;
    postMessage({ type: "update", data: data });
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return;
    fails = Math.min(fails + 1, 6);
    postMessage({ type: "error", error: String(e && e.message ? e.message : e), fails: fails });
  } finally {
    keys.forEach(function (k) { if (running[k] === ac) running[k] = null; });
  }
}

let userSec = 60;
let hidden = false;
let waitFast = null, beatFast = null, waitSlow = null, beatSlow = null;

function effectiveFast() {
  return hidden ? 300 : ([60, 300].indexOf(userSec) >= 0 ? userSec : 60);
}

function delayMs(base) {
  const m = Math.min(8, Math.pow(1.5, fails));
  return Math.min(300000, base * m);
}

function arm() {
  const fast = effectiveFast() * 1000;
  const slow = 300000;
  if (waitFast) clearTimeout(waitFast);
  if (beatFast) clearInterval(beatFast);
  if (waitSlow) clearTimeout(waitSlow);
  if (beatSlow) clearInterval(beatSlow);
  const now = Date.now();
  waitFast = setTimeout(function () {
    loop("fast");
    beatFast = setInterval(function () { loop("fast"); }, delayMs(fast));
  }, Math.max(250, fast - (now % fast)));
  waitSlow = setTimeout(function () {
    loop("slow");
    beatSlow = setInterval(function () { loop("slow"); }, slow);
  }, Math.max(400, slow - (now % slow)));
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

loop("all");
arm();
