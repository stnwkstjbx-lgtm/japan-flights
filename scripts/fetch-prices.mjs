// 일본 항공권 최저가 수집 (Sky Scrapper = Skyscanner data via RapidAPI)
// 인천(ICN) → config.json 의 도시들을 정확한 왕복 날짜로 실시간 검색(왕복 1회 호출).
// Skyscanner 데이터라 LCC(피치·제주·티웨이 등) 포함 진짜 최저가가 나온다.
// 공항 entityId 는 data/airports.json 에 캐시(무료 한도 월 20회 절약).
//
// 실행: RAPIDAPI_KEY=xxxx node scripts/fetch-prices.mjs

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const KEY = process.env.RAPIDAPI_KEY;
const HOST = "sky-scrapper.p.rapidapi.com";
const BASE = `https://${HOST}`;

const AIRLINES = {
  "Korean Air": "대한항공", "Asiana Airlines": "아시아나", "Jeju Air": "제주항공",
  "T'way Air": "티웨이항공", "Tway Air": "티웨이항공", "Jin Air": "진에어",
  "Air Seoul": "에어서울", "Air Busan": "에어부산", "Eastar Jet": "이스타항공",
  "Air Premia": "에어프레미아", "Japan Airlines": "JAL", "All Nippon Airways": "ANA",
  "Peach": "피치", "Peach Aviation": "피치", "Jetstar Japan": "젯스타재팬",
  "Spring Japan": "스프링재팬", "Cathay Pacific": "캐세이퍼시픽"
};
const airlineName = (n) => AIRLINES[n] || n || "항공사미상";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bookingUrl(originDeep, destDeep, depart, ret) {
  const d = (s) => s.slice(2).replaceAll("-", ""); // 2027-01-21 -> 270121
  return `https://www.skyscanner.co.kr/transport/flights/${originDeep}/${destDeep}/${d(depart)}/${d(ret)}/?adults=1`;
}

let callCount = 0;
async function api(path, params) {
  const url = `${BASE}${path}?` + new URLSearchParams(params);
  callCount++;
  const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (res.status === 429) throw new Error("RATE_LIMIT: 무료 한도(월 20회) 초과");
  if (res.status === 403) throw new Error("403: API 구독 확인 필요");
  return res.json();
}

async function resolveAirport(query, code, cache) {
  if (cache[code]) return cache[code];
  const json = await api("/api/v1/flights/searchAirport", { query, locale: "en-US" });
  const list = json.data || [];
  const p = (list.find((x) => x?.navigation?.relevantFlightParams?.skyId === code)
    || list[0])?.navigation?.relevantFlightParams;
  if (!p) throw new Error(`공항 ID 못 찾음: ${query}`);
  cache[code] = { skyId: p.skyId, entityId: p.entityId };
  await sleep(400);
  return cache[code];
}

async function searchRoundTrip(origin, dest, trip) {
  const params = {
    originSkyId: origin.skyId, originEntityId: origin.entityId,
    destinationSkyId: dest.skyId, destinationEntityId: dest.entityId,
    date: trip.depart, returnDate: trip.return,
    cabinClass: trip.cabin || "economy", adults: String(trip.passengers || 1),
    sortBy: "best", currency: trip.currency || "KRW",
    market: trip.market || "ko-KR", countryCode: trip.countryCode || "KR"
  };
  let json = await api("/api/v2/flights/searchFlights", params);
  if (!json.status) { await sleep(1500); json = await api("/api/v2/flights/searchFlights", params); }
  return json?.data?.itineraries || [];
}

async function main() {
  if (!KEY) { console.error("❌ RAPIDAPI_KEY 환경변수가 필요합니다."); process.exit(1); }

  const config = JSON.parse(await readFile(join(DATA, "config.json"), "utf8"));
  const { trip, origin, target, maxOffersPerCity = 6 } = config;

  const cachePath = join(DATA, "airports.json");
  let cache = {};
  if (existsSync(cachePath)) { try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch {} }
  // 출발지 ICN 은 config 에 박혀 있으면 그대로 캐시
  if (origin.entityId && !cache[origin.code]) cache[origin.code] = { skyId: origin.skyId, entityId: origin.entityId };
  const originAir = cache[origin.code] || await resolveAirport(origin.query || origin.code, origin.code, cache);

  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const today = now.toISOString().slice(0, 10);
  const updated = now.toISOString().replace("Z", "+09:00");

  // 이전 결과 병합용
  const cityMap = {};
  if (existsSync(join(DATA, "latest.json"))) {
    try { const prev = JSON.parse(await readFile(join(DATA, "latest.json"), "utf8"));
      if (prev && !prev.sample) for (const c of prev.destinations || []) cityMap[c.code] = c; } catch {}
  }
  for (const d of config.destinations) if (!cityMap[d.code]) cityMap[d.code] = { code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: null, offers: [] };

  const refreshed = [];
  for (const d of config.destinations) {
    try {
      const destAir = await resolveAirport(d.query || d.code, d.code, cache);
      const its = await searchRoundTrip(originAir, destAir, trip);
      const offers = its.map((it) => {
        const out = it.legs[0], back = it.legs[1] || null;
        const carrier = out.carriers?.marketing?.[0]?.name;
        return {
          origin: origin.code, dest: d.code,
          price: Math.round(it.price.raw),
          airline: airlineName(carrier), airlineRaw: carrier || null,
          departureAt: out.departure, returnAt: back ? back.departure : null,
          stops: out.stopCount, durationMin: out.durationInMinutes,
          bookingUrl: bookingUrl(origin.skyDeep || "icn", d.skyDeep || d.code.toLowerCase(), trip.depart, trip.return)
        };
      }).filter((o) => o.price > 0).sort((a, b) => a.price - b.price).slice(0, maxOffersPerCity);
      if (offers.length) {
        cityMap[d.code] = { code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: offers[0], offers, updatedAt: today };
        console.log(`${d.emoji} ${d.name}: ${offers[0].price.toLocaleString()}원 (${offers[0].stops ? offers[0].stops + "경유" : "직항"}, ${offers[0].airline})`);
      } else {
        console.log(`${d.emoji} ${d.name}: 데이터 없음`);
      }
    } catch (e) {
      console.warn(`  ⚠️ ${d.code}: ${e.message}`);
      if (String(e.message).startsWith("RATE_LIMIT")) break;
    }
    refreshed.push(d.code);
    await sleep(800);
  }

  await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n");

  let destinations = config.destinations.map((d) => cityMap[d.code]);
  destinations.sort((a, b) => { if (!a.cheapest) return 1; if (!b.cheapest) return -1; return a.cheapest.price - b.cheapest.price; });
  const overall = destinations.find((d) => d.cheapest) || null;

  await writeFile(join(DATA, "latest.json"),
    JSON.stringify({ updated, sample: false, source: "Skyscanner (Sky Scrapper, RapidAPI) · 왕복 실시간", trip, target, overall, destinations }, null, 2) + "\n");

  let history = {};
  try { const raw = JSON.parse(await readFile(join(DATA, "history.json"), "utf8")); if (raw && !raw.sample) history = raw; } catch {}
  const record = (k, price) => { history[k] = history[k] || []; const a = history[k], l = a[a.length - 1]; if (l && l.date === today) l.price = price; else a.push({ date: today, price }); };
  for (const code of refreshed) { const c = cityMap[code]; if (c && c.cheapest) record(code, c.cheapest.price); }
  if (overall) record("ALL", overall.cheapest.price);
  await writeFile(join(DATA, "history.json"), JSON.stringify(history, null, 2) + "\n");

  const ok = destinations.filter((d) => d.cheapest).length;
  console.log(`✅ 완료 (${today}) · 데이터 ${ok}/${destinations.length}개 · API ${callCount}회 · 전역 최저가 ${overall ? overall.emoji + " " + overall.name + " " + overall.cheapest.price.toLocaleString() + "원" : "없음"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
