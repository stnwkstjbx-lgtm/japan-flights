# 🇯🇵 일본 항공권 최저가 추적 (도쿄·오사카·오키나와)

친구들과 가는 **2027-01-21 → 2027-01-24** 일본 여행 항공권을, 클로드 코드를 켜지 않아도
상시 볼 수 있는 페이지. 매일 자동으로 **도쿄·오사카·오키나와**의 인천 출발 왕복 최저가를 수집해
**전역 최저가 히어로 + 도시 가격 순위표 + 가격 추이 그래프**로 보여준다.

## 구조
```
GitHub Actions(매일 09:00 KST) → scripts/fetch-prices.mjs → data/*.json 커밋 → Vercel 자동 배포 → 상시 접속
```
- 서버·DB 없음. 데이터는 레포 안 JSON에 누적되어 가격 히스토리가 쌓인다.
- 데이터 소스: **Google Flights (SerpApi)** — 실제 구글 항공권 데이터(LCC 포함), 관리형이라 안 깨짐, 먼 미래 날짜 지원.

## 무료 한도 설계
- SerpApi 무료 = **월 250회 검색**. 도시 3개 × 매일 = 월 ~90회 → 한도 안에서 **매일 갱신**.
- 가격은 구글 항공권 그대로라 **피치·제주·티웨이 등 LCC 최저가 포함** (예: 오사카 피치 직항 22.5만원).
- 가격은 **왕복 총액**, 표시 시간은 가는편 출발 기준. 귀국편·실제 결제는 페이지의 「예약」(스카이스캐너) 링크에서 확인.

## 데이터 소스 선택 기록 (왜 이걸 쓰나)
- Travelpayouts: 무료·무제한이나 **먼 미래 데이터가 캐시에 없음** → 탈락.
- Amadeus: 2026-07 셀프서비스 종료, 신규 가입 불가 → 탈락.
- 구글 항공권 직접 크롤링(fast-flights): 봇 차단 → 탈락.
- Flight Fare Search(RapidAPI): 하루 10회로 넉넉하나 **GDS only라 LCC를 못 잡아 3배 부풀림** → 탈락.
- Sky Scrapper(RapidAPI): 정확하나 무료 **월 20회**뿐 → 부족.
- 네이버 항공권: 정확하나 GraphQL 폴링+동적토큰+봇차단으로 **무인 자동화엔 부적합** → 탈락.
- **SerpApi 구글 항공권: 정확(LCC)+안정(관리형)+무료 월 250회 → 채택.**

## 파일
| 경로 | 역할 |
|------|------|
| `index.html` | 정적 페이지 (Chart.js CDN, 바닐라 JS) |
| `data/config.json` | 추적 도시·여행 날짜·목표가 (여기만 고치면 됨) |
| `data/latest.json` | 최신 수집 결과 (자동 갱신) |
| `data/history.json` | 날짜별 최저가 누적 (자동 갱신) |
| `scripts/fetch-prices.mjs` | SerpApi 호출 & JSON 갱신 |
| `.github/workflows/track.yml` | 매일 cron + 수동 실행 |
| `vercel.json` | 정적 배포 설정 |

## 설정 (한 번만)
1. **SerpApi 키**: https://serpapi.com 가입(무료, 카드 불필요) → 대시보드 `Your Private API Key` 복사.
2. **로컬 테스트**: `SERPAPI_KEY=발급키 node scripts/fetch-prices.mjs` → `npx serve .` 로 확인 (※ file:// 직접 열기는 fetch 차단).
3. **GitHub** Settings → Secrets and variables → Actions 에 `SERPAPI_KEY` 등록.
4. **Vercel** 에서 레포 Import → 자동 배포. 그 URL이 상시 확인 주소.
5. **수집**: Actions 탭 → `Run workflow` 수동 실행 또는 매일 자동.

## 커스터마이즈
- 도시/날짜/목표가 → `data/config.json` (도시 추가해도 월 250회 안에서 매일 갱신 여유).
- `arrivalId` 는 콤마로 여러 공항 묶기 가능 (도쿄 = `NRT,HND`).
