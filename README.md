# 🇯🇵 일본 항공권 최저가 추적 (도쿄·오사카·오키나와)

친구들과 가는 **2027-01-21 → 2027-01-24** 일본 여행 항공권을, 클로드 코드를 켜지 않아도
상시 볼 수 있는 페이지. 매주 자동으로 **도쿄·오사카·오키나와**의 인천 출발 왕복 최저가를 수집해
**전역 최저가 히어로 + 도시 가격 순위표 + 가격 추이 그래프**로 보여준다.

## 구조
```
GitHub Actions(매주 월 09:00 KST) → scripts/fetch-prices.mjs → data/*.json 커밋 → Vercel 자동 배포 → 상시 접속
```
- 서버·DB 없음. 데이터는 레포 안 JSON에 누적되어 가격 히스토리가 쌓인다.
- 데이터 소스: **Skyscanner (Sky Scrapper, RapidAPI)** — 스카이스캐너 실시간 데이터(LCC 포함), 먼 미래 날짜 지원, 왕복 1회 호출.

## 무료 한도 설계
- Sky Scrapper 무료 = **월 20회 호출**. 도시 3개 × 왕복 1회 = **회당 3호출** → 주 1회 갱신 시 월 ~13회로 한도 안.
- 7개월 전 여행이라 주 1회면 추이 보기 충분. 가격은 스카이스캐너 그대로라 **피치·제주·티웨이 등 LCC 최저가 포함**.
- 실제 결제가·좌석은 페이지의 「예약」(스카이스캐너) 링크에서 확인.

## 데이터 소스 선택 기록 (왜 이걸 쓰나)
- Travelpayouts: 무료·무제한이나 **먼 미래 데이터가 캐시에 없음** → 탈락.
- Amadeus: 2026-07 셀프서비스 포털 종료, 신규 가입 불가 → 탈락.
- 구글 항공권 크롤링: 봇 차단 → 탈락.
- Flight Fare Search(RapidAPI): 하루 10회로 넉넉하나 **LCC를 못 잡아 가격이 3배 부풀려짐**(오사카 67만 vs 실제 21만) → 탈락.
- **Sky Scrapper(RapidAPI): 스카이스캐너 데이터라 LCC 포함 정확. 무료 월 20회 → 도시 3개·주1회로 채택.**

## 파일
| 경로 | 역할 |
|------|------|
| `index.html` | 정적 페이지 (Chart.js CDN, 바닐라 JS) |
| `data/config.json` | 추적 도시·여행 날짜·목표가 (여기만 고치면 됨) |
| `data/latest.json` | 최신 수집 결과 (자동 갱신) |
| `data/history.json` | 날짜별 최저가 누적 (자동 갱신) |
| `data/airports.json` | 공항 entityId 캐시 (호출 절약, 자동 생성) |
| `scripts/fetch-prices.mjs` | API 호출 & JSON 갱신 |
| `.github/workflows/track.yml` | 매주 월 cron + 수동 실행 |
| `vercel.json` | 정적 배포 설정 |

## 설정 (한 번만)
1. **RapidAPI 키**: https://rapidapi.com 가입 → **Sky Scrapper**(`apiheya`) API의 `Basic`(무료) 구독 → `X-RapidAPI-Key` 복사.
2. **로컬 테스트**: `RAPIDAPI_KEY=발급키 node scripts/fetch-prices.mjs` → `npx serve .` 로 확인 (※ file:// 직접 열기는 fetch 차단).
3. **GitHub** Settings → Secrets → Actions 에 `RAPIDAPI_KEY` 등록.
4. **Vercel** 에서 레포 Import → 자동 배포. 그 URL이 상시 확인 주소.
5. **수집**: Actions 탭 → `Run workflow` 수동 실행 또는 매주 월요일 자동.

## 커스터마이즈
- 도시/날짜/목표가 → `data/config.json` (도시 추가 시 무료 월 20회 안에서 갱신 빈도 조절).
- 더 자주·더 많은 도시는 RapidAPI 유료 플랜으로 올리면 됨.
