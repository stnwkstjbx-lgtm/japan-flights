// 일본 항공권 최저가 수집 (SerpApi · Google Flights)
// 인천(ICN) → config.json 의 도시들을 정확한 왕복 날짜로 검색.
// 실제 구글 항공권 데이터라 LCC(피치·제주·티웨이 등) 포함 진짜 최저가가 나온다.
// SerpApi 무료 월 250회 → 도시 3개 매일 갱신해도 월 ~90회로 여유.
//
// 실행: SERPAPI_KEY=xxxx node scripts/fetch-prices.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const KEY = process.env.SERPAPI_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "2027-01-21 08:00" → "2027-01-21T08:00:00"
function toISO(s) {
  if (!s) return null;
  const t = s.trim().replace(" ", "T");
  return t.length === 16 ? t + ":00" : t;
}

function bookingUrl(destDeep, depart, ret) {
  const d = (s) => s.slice(2).replaceAll("-", ""); // 2027-01-21 -> 270121
  return `https://www.skyscanner.co.kr/transport/flights/icn/${destDeep}/${d(depart)}/${d(ret)}/?adults=1`;
}

async function searchCity(dest, trip) {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: trip.origin || "ICN",
    arrival_id: dest.arrivalId || dest.code,
    outbound_date: trip.depart,
    return_date: trip.return,
    currency: trip.currency || "KRW",
    hl: "ko", gl: "kr", type: "1",
    adults: String(trip.passengers || 1),
    api_key: KEY
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  const all = [...(json.best_flights || []), ...(json.other_flights || [])];
  return all.map((f) => {
    const seg = f.flights || [];
    const airlines = [...new Set(seg.map((s) => s.airline).filter(Boolean))];
    const out = seg[0] || {};
    return {
      dest: dest.code,
      price: f.price,
      airline: airlines[0] || "항공사미상",
      airlines,
      departureAt: toISO(out.departure_airport?.time),
      returnAt: null,
      stops: (f.layovers || []).length,
      durationMin: f.total_duration ?? null,
      bookingUrl: bookingUrl(dest.skyDeep || dest.code.toLowerCase(), trip.depart, trip.return)
    };
  }).filter((o) => o.price > 0).sort((a, b) => a.price - b.price);
}

async function main() {
  if (!KEY) { console.error("❌ SERPAPI_KEY 환경변수가 필요합니다."); process.exit(1); }

  const config = JSON.parse(await readFile(join(DATA, "config.json"), "utf8"));
  const trip = { ...config.trip, origin: config.origin };
  const { target, maxOffersPerCity = 6 } = config;

  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const today = now.toISOString().slice(0, 10);
  const updated = now.toISOString().replace("Z", "+09:00");

  const destinations = [];
  for (const d of config.destinations) {
    let offers = [];
    try {
      offers = (await searchCity(d, trip)).slice(0, maxOffersPerCity);
    } catch (e) {
      console.warn(`  ⚠️ ${d.code}: ${e.message}`);
    }
    destinations.push({ code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: offers[0] || null, offers, updatedAt: today });
    const c = offers[0];
    console.log(`${d.emoji} ${d.name}: ${c ? c.price.toLocaleString() + "원 (" + (c.stops ? c.stops + "경유" : "직항") + ", " + c.airline + ")" : "데이터 없음"}`);
    await sleep(1500);
  }

  destinations.sort((a, b) => { if (!a.cheapest) return 1; if (!b.cheapest) return -1; return a.cheapest.price - b.cheapest.price; });
  const overall = destinations.find((d) => d.cheapest) || null;

  await writeFile(join(DATA, "latest.json"),
    JSON.stringify({ updated, sample: false, source: "Google Flights (SerpApi) · 왕복 실시간", trip: config.trip, target, overall, destinations }, null, 2) + "\n");

  let history = {};
  try { const raw = JSON.parse(await readFile(join(DATA, "history.json"), "utf8")); if (raw && !raw.sample) history = raw; } catch {}
  const record = (k, price) => { history[k] = history[k] || []; const a = history[k], l = a[a.length - 1]; if (l && l.date === today) l.price = price; else a.push({ date: today, price }); };
  for (const d of destinations) if (d.cheapest) record(d.code, d.cheapest.price);
  if (overall) record("ALL", overall.cheapest.price);
  await writeFile(join(DATA, "history.json"), JSON.stringify(history, null, 2) + "\n");

  const ok = destinations.filter((d) => d.cheapest).length;
  console.log(`✅ 완료 (${today}) · 데이터 ${ok}/${destinations.length}개 · 전역 최저가 ${overall ? overall.emoji + " " + overall.name + " " + overall.cheapest.price.toLocaleString() + "원" : "없음"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
