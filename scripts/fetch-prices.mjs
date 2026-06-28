// 일본 전역 항공권 최저가 수집 (Flight Fare Search via RapidAPI)
// 이 API는 편도 전용 + IATA 공항코드 직접 사용 + 하루 10회 무료.
// 그래서 도시별로 [가는편(ICN→도시, 출발일)] + [오는편(도시→ICN, 귀국일)] 2회 호출해
// 왕복 추정가(가장 싼 가는편 + 가장 싼 오는편)를 만든다.
// 하루 한도(10회) 때문에 한 번에 몇 개 도시만 처리하고, 커서(state.json)를 저장해
// 매일 돌리면 전체 도시를 순환 갱신한다. latest.json 은 갱신분만 병합한다.
//
// 실행: RAPIDAPI_KEY=xxxx node scripts/fetch-prices.mjs

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const KEY = process.env.RAPIDAPI_KEY;
const HOST = "flight-fare-search.p.rapidapi.com";
const BASE = `https://${HOST}/v2/flights/`;

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
const stopsNum = (s) => (!s || /direct|논스톱|nonstop/i.test(s)) ? 0 : (parseInt(s) || 1);

function bookingUrl(origin, dest, depart, ret) {
  const d = (s) => s.slice(2).replaceAll("-", ""); // 2027-01-21 -> 270121
  return `https://www.skyscanner.co.kr/transport/flights/${origin.toLowerCase()}/${dest.toLowerCase()}/${d(depart)}/${d(ret)}/?adults=1`;
}

let callCount = 0;
async function fetchLegOnce(from, to, date, trip) {
  const url = `${BASE}?` + new URLSearchParams({
    from, to, date, adult: String(trip.passengers || 1),
    type: trip.cabin || "economy", currency: trip.currency || "KRW"
  });
  callCount++;
  const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (res.status === 429) throw new Error("RATE_LIMIT: 일일 무료 한도(10회) 초과");
  if (res.status === 403) throw new Error("403: API 구독 확인 필요");
  const json = await res.json();
  return (json.results || []).map((r) => ({
    total: Math.round(r.totals?.total ?? r.totals?.base ?? 0),
    airline: airlineName(r.flight_name), airlineRaw: r.flight_name,
    code: r.careerCode, flight: r.flight_code,
    departureAt: r.departureAirport?.time || null,
    stops: stopsNum(r.stops), durationMin: r.duration?.minute ?? null
  })).filter((r) => r.total > 0).sort((a, b) => a.total - b.total);
}

// 빈 응답이 가끔 와서 1회 재시도
async function fetchLeg(from, to, date, trip) {
  let r = await fetchLegOnce(from, to, date, trip);
  if (!r.length) { await sleep(1500); r = await fetchLegOnce(from, to, date, trip); }
  return r;
}

async function main() {
  if (!KEY) { console.error("❌ RAPIDAPI_KEY 환경변수가 필요합니다."); process.exit(1); }

  const config = JSON.parse(await readFile(join(DATA, "config.json"), "utf8"));
  const { trip, origin, target, dailyBudgetCalls = 8, maxOffersPerCity = 5 } = config;
  const dests = config.destinations;

  // 이전 결과 병합용 맵
  const cityMap = {};
  if (existsSync(join(DATA, "latest.json"))) {
    try {
      const prev = JSON.parse(await readFile(join(DATA, "latest.json"), "utf8"));
      if (prev && !prev.sample) for (const c of prev.destinations || []) cityMap[c.code] = c;
    } catch {}
  }
  // config 기준으로 누락 도시 초기화
  for (const d of dests) if (!cityMap[d.code]) cityMap[d.code] = { code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: null, offers: [] };

  // 커서 로드
  const statePath = join(DATA, "state.json");
  let cursor = 0;
  if (existsSync(statePath)) { try { cursor = JSON.parse(await readFile(statePath, "utf8")).cursor || 0; } catch {} }

  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const today = now.toISOString().slice(0, 10);
  const updated = now.toISOString().replace("Z", "+09:00");

  const citiesThisRun = Math.max(1, Math.floor(dailyBudgetCalls / 2));
  const refreshed = [];
  for (let i = 0; i < citiesThisRun && i < dests.length; i++) {
    const d = dests[(cursor + i) % dests.length];
    try {
      const out = await fetchLeg(origin, d.code, trip.depart, trip); await sleep(1200);
      const back = await fetchLeg(d.code, origin, trip.return, trip); await sleep(1200);
      if (out.length && back.length) {
        const minIn = back[0];
        const offers = out.slice(0, maxOffersPerCity).map((o) => ({
          origin, dest: d.code,
          price: o.total + minIn.total,
          airline: o.airline, airlineRaw: o.airlineRaw,
          departureAt: o.departureAt, returnAt: minIn.departureAt,
          returnAirline: minIn.airline, stops: o.stops,
          bookingUrl: bookingUrl(origin, d.code, trip.depart, trip.return)
        }));
        cityMap[d.code] = { code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: offers[0], offers, updatedAt: today };
        console.log(`${d.emoji} ${d.name}(${d.code}): ${offers[0].price.toLocaleString()}원 (가는편 ${out[0].airline} + 오는편 ${minIn.airline})`);
      } else {
        cityMap[d.code] = { code: d.code, name: d.name, region: d.region, emoji: d.emoji, cheapest: null, offers: [], updatedAt: today };
        console.log(`${d.emoji} ${d.name}(${d.code}): 데이터 없음 (가는편 ${out.length}·오는편 ${back.length})`);
      }
    } catch (e) {
      console.warn(`  ⚠️ ${d.code}: ${e.message}`);
      if (String(e.message).startsWith("RATE_LIMIT")) break;
    }
    refreshed.push(d.code);
  }

  // 커서 전진
  const newCursor = (cursor + refreshed.length) % dests.length;
  await writeFile(statePath, JSON.stringify({ cursor: newCursor, lastRun: today, lastRefreshed: refreshed }, null, 2) + "\n");

  // config 순서 → 가격 오름차순 정렬
  let destinations = dests.map((d) => cityMap[d.code]);
  destinations.sort((a, b) => {
    if (!a.cheapest) return 1;
    if (!b.cheapest) return -1;
    return a.cheapest.price - b.cheapest.price;
  });
  const overall = destinations.find((d) => d.cheapest) || null;

  await writeFile(join(DATA, "latest.json"),
    JSON.stringify({ updated, sample: false, source: "Flight Fare Search (RapidAPI) · 왕복 추정가", trip, target, overall, destinations }, null, 2) + "\n");

  // history: 오늘 갱신한 도시 + 전역 최저가(ALL)
  let history = {};
  try { const raw = JSON.parse(await readFile(join(DATA, "history.json"), "utf8")); if (raw && !raw.sample) history = raw; } catch {}
  const record = (k, price) => {
    history[k] = history[k] || [];
    const arr = history[k], last = arr[arr.length - 1];
    if (last && last.date === today) last.price = price; else arr.push({ date: today, price });
  };
  for (const code of refreshed) { const c = cityMap[code]; if (c.cheapest) record(code, c.cheapest.price); }
  if (overall) record("ALL", overall.cheapest.price);
  await writeFile(join(DATA, "history.json"), JSON.stringify(history, null, 2) + "\n");

  const ok = destinations.filter((d) => d.cheapest).length;
  console.log(`✅ 완료 (${today}) · 이번 갱신 ${refreshed.length}개 · 누적 데이터 ${ok}/${dests.length}개 · API ${callCount}회 사용 · 다음 커서 ${newCursor}`);
  console.log(`   전역 최저가: ${overall ? overall.emoji + " " + overall.name + " " + overall.cheapest.price.toLocaleString() + "원" : "아직 없음"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
