// 일본 항공권 최저가 수집 (SerpApi · Google Flights)
// 인천(ICN)·김포(GMP) → config.json 의 도시들을 정확한 왕복 날짜로 검색.
// 실제 구글 항공권 데이터라 LCC(피치·제주·티웨이 등) 포함 진짜 최저가가 나온다.
// 도시마다 인천/김포 둘 다 검색해 더 싼 출발지를 표시. 가격은 인원수(5인) 총액.
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

function bookingUrl(originDeep, destDeep, depart, ret, adults) {
  const d = (s) => s.slice(2).replaceAll("-", ""); // 2027-01-21 -> 270121
  return `https://www.skyscanner.co.kr/transport/flights/${originDeep}/${destDeep}/${d(depart)}/${d(ret)}/?adults=${adults}`;
}

async function searchOrigin(origin, dest, trip) {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: origin.code,
    arrival_id: origin.arrivalId || dest.code,
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
    const out = seg[0] || {};
    const last = seg[seg.length - 1] || {};
    const airlines = [...new Set(seg.map((s) => s.airline).filter(Boolean))];
    return {
      origin: origin.code, originLabel: origin.label,
      dest: dest.code,
      price: f.price,
      airline: airlines[0] || "항공사미상", airlines,
      departureAt: toISO(out.departure_airport?.time),
      arrivalAt: toISO(last.arrival_airport?.time),
      stops: (f.layovers || []).length,
      durationMin: f.total_duration ?? null,
      bookingUrl: bookingUrl(origin.skyDeep || origin.code.toLowerCase(), dest.skyDeep || dest.code.toLowerCase(), trip.depart, trip.return, trip.passengers || 1)
    };
  }).filter((o) => o.price > 0);
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
    let offers = [];
    for (const origin of d.origins) {
      try {
        offers.push(...await searchOrigin(origin, d, trip));
      } catch (e) {
        console.warn(`  ⚠️ ${origin.code}->${d.code}: ${e.message}`);
      }
      await sleep(1200);
    }
    offers.sort((a, b) => a.price - b.price);
    offers = offers.slice(0, maxOffersPerCity);
    destinations.push({ code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: offers[0] || null, offers, updatedAt: today });
    const c = offers[0];
    console.log(`${d.emoji} ${d.name}: ${c ? c.price.toLocaleString() + "원 (" + c.originLabel + " 출발, " + (c.stops ? c.stops + "경유" : "직항") + ", " + c.airline + ")" : "데이터 없음"}`);
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
