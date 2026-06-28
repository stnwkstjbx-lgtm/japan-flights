// 일본 항공권 최저가 수집 (SerpApi · Google Flights)
// 인천(ICN)·김포(GMP) → config.json 의 도시들을 정확한 왕복 날짜로 검색.
// 1단계: 가는편 조회(더 싼 출발지 선택) → 2단계: departure_token 으로 오는편 조회.
// 가격은 인원수(5인) 왕복 총액. LCC(피치·제주·티웨이 등) 포함.
//
// 실행: SERPAPI_KEY=xxxx node scripts/fetch-prices.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const KEY = process.env.SERPAPI_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toISO(s) { // "2027-01-21 08:00" → "2027-01-21T08:00:00"
  if (!s) return null;
  const t = s.trim().replace(" ", "T");
  return t.length === 16 ? t + ":00" : t;
}
function bookingUrl(originDeep, destDeep, depart, ret, adults) {
  const d = (s) => s.slice(2).replaceAll("-", "");
  return `https://www.skyscanner.co.kr/transport/flights/${originDeep}/${destDeep}/${d(depart)}/${d(ret)}/?adults=${adults}`;
}

function parseFlights(json, origin, dest, trip) {
  const all = [...(json.best_flights || []), ...(json.other_flights || [])];
  return all.map((f) => {
    const seg = f.flights || [];
    const out = seg[0] || {}, last = seg[seg.length - 1] || {};
    const airlines = [...new Set(seg.map((s) => s.airline).filter(Boolean))];
    return {
      origin: origin.code, originLabel: origin.label, originDeep: origin.skyDeep, arrivalId: origin.arrivalId,
      price: f.price,
      airline: airlines[0] || "항공사미상",
      departureAt: toISO(out.departure_airport?.time),
      arrivalAt: toISO(last.arrival_airport?.time),
      stops: (f.layovers || []).length,
      departureToken: f.departure_token || null,
      bookingUrl: bookingUrl(origin.skyDeep || origin.code.toLowerCase(), dest.skyDeep || dest.code.toLowerCase(), trip.depart, trip.return, trip.passengers || 1)
    };
  }).filter((o) => o.price > 0);
}

async function call(extra, trip) {
  const params = new URLSearchParams({
    engine: "google_flights",
    outbound_date: trip.depart, return_date: trip.return,
    currency: trip.currency || "KRW", hl: "ko", gl: "kr", type: "1",
    adults: String(trip.passengers || 1), api_key: KEY, ...extra
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function main() {
  if (!KEY) { console.error("❌ SERPAPI_KEY 환경변수가 필요합니다."); process.exit(1); }

  const config = JSON.parse(await readFile(join(DATA, "config.json"), "utf8"));
  const { trip, target, maxOffersPerCity = 6 } = config;

  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const today = now.toISOString().slice(0, 10);
  const updated = now.toISOString().replace("Z", "+09:00");

  const destinations = [];
  for (const d of config.destinations) {
    // 1단계: 출발지별 가는편
    let outs = [];
    for (const origin of d.origins) {
      try {
        const json = await call({ departure_id: origin.code, arrival_id: origin.arrivalId || d.code }, trip);
        outs.push(...parseFlights(json, origin, d, trip));
      } catch (e) { console.warn(`  ⚠️ ${origin.code}->${d.code}: ${e.message}`); }
      await sleep(1200);
    }
    outs.sort((a, b) => a.price - b.price);

    let cheapest = null;
    if (outs.length) {
      const best = outs[0];
      // 2단계: 가장 싼 가는편의 오는편 조회
      let ret = null;
      if (best.departureToken) {
        try {
          const json = await call({ departure_id: best.origin, arrival_id: best.arrivalId, departure_token: best.departureToken }, trip);
          const rets = parseFlights(json, { code: best.origin, label: best.originLabel, skyDeep: best.originDeep, arrivalId: best.arrivalId }, d, trip);
          if (rets.length) ret = rets.sort((a, b) => a.price - b.price)[0];
          await sleep(1200);
        } catch (e) { console.warn(`  ⚠️ ${d.code} 오는편: ${e.message}`); }
      }
      cheapest = {
        originLabel: best.originLabel, origin: best.origin,
        price: ret ? ret.price : best.price,
        out: { airline: best.airline, departureAt: best.departureAt, arrivalAt: best.arrivalAt, stops: best.stops },
        ret: ret ? { airline: ret.airline, departureAt: ret.departureAt, arrivalAt: ret.arrivalAt, stops: ret.stops } : null,
        bookingUrl: best.bookingUrl
      };
    }

    const offers = outs.slice(0, maxOffersPerCity).map((o) => ({
      originLabel: o.originLabel, price: o.price,
      out: { airline: o.airline, departureAt: o.departureAt, arrivalAt: o.arrivalAt, stops: o.stops },
      bookingUrl: o.bookingUrl
    }));

    destinations.push({ code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest, offers, updatedAt: today });
    console.log(`${d.emoji} ${d.name}: ${cheapest ? cheapest.price.toLocaleString() + "원 (" + cheapest.originLabel + ", 가는편 " + cheapest.out.airline + (cheapest.ret ? " / 오는편 " + cheapest.ret.airline : " / 오는편 미조회") + ")" : "데이터 없음"}`);
  }

  destinations.sort((a, b) => { if (!a.cheapest) return 1; if (!b.cheapest) return -1; return a.cheapest.price - b.cheapest.price; });
  const overall = destinations.find((d) => d.cheapest) || null;

  await writeFile(join(DATA, "latest.json"),
    JSON.stringify({ updated, sample: false, source: "Google Flights (SerpApi) · 왕복 실시간", trip, target, overall, destinations }, null, 2) + "\n");

  let history = {};
  try { const raw = JSON.parse(await readFile(join(DATA, "history.json"), "utf8")); if (raw && !raw.sample) history = raw; } catch {}
  const record = (k, price) => { history[k] = history[k] || []; const a = history[k], l = a[a.length - 1]; if (l && l.date === today) l.price = price; else a.push({ date: today, price }); };
  for (const d of destinations) if (d.cheapest) record(d.code, d.cheapest.price);
  if (overall) record("ALL", overall.cheapest.price);
  await writeFile(join(DATA, "history.json"), JSON.stringify(history, null, 2) + "\n");

  const ok = destinations.filter((d) => d.cheapest).length;
  console.log(`✅ 완료 (${today}) · ${trip.passengers}인 · 데이터 ${ok}/${destinations.length}개 · 전역 최저가 ${overall ? overall.emoji + " " + overall.name + " " + overall.cheapest.price.toLocaleString() + "원" : "없음"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
