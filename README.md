# 🇯🇵 일본 전역 항공권 최저가 추적

친구들과 가는 **2027-01-21 → 2027-01-24** 일본 여행 항공권을, 클로드 코드를 켜지 않아도
상시 볼 수 있는 페이지. 매일 자동으로 **일본 전역 공항(25곳)** 의 인천 출발 왕복 추정가를 수집해
**전역 최저가 히어로 + 전체 도시 가격 순위표 + 가격 추이 그래프**로 보여준다.

## 구조
```
GitHub Actions(매일 09:00 KST) → scripts/fetch-prices.mjs → data/*.json 커밋 → Vercel 자동 배포 → 상시 접속
```
- 서버·DB 없음. 데이터는 레포 안 JSON에 누적되어 가격 히스토리가 쌓인다.
- 데이터 소스: **Flight Fare Search (RapidAPI)** — 실시간 항공 가격, 먼 미래 날짜 지원.

## 데이터 소스의 제약과 설계
- 무료 한도가 **하루 10회 호출**(RapidAPI 응답 헤더 기준). 이 API는 **편도 전용**이라
  도시당 [가는편 + 오는편] 2회를 호출해 **왕복 추정가**(가장 싼 가는편 + 가장 싼 오는편)를 만든다.
- 그래서 한 번에 **3개 도시만** 처리하고 `data/state.json` 에 커서를 저장 → 매일 돌리면
  **25개 도시를 약 8일마다 한 바퀴** 순환 갱신한다. `latest.json` 은 갱신분만 병합.
- ⚠️ 가격은 **추정가**다. 저가 LCC 운임을 다 잡지 못해 실제보다 높게 나올 수 있다.
  절대가보다 **도시 간 비교·추이**용으로 보고, 실제 결제가는 페이지의 「예약」(스카이스캐너) 링크에서 확인.

## 왜 이 소스인가 (선택 기록)
- Travelpayouts: 무료·무제한이나 **먼 미래(1월) 데이터가 캐시에 없음** → 탈락.
- Amadeus: 2026-07 셀프서비스 포털 종료, 신규 가입 불가 → 탈락.
- 구글 항공권 크롤링: 봇 차단 → 탈락.
- Sky Scrapper(RapidAPI): 데이터 정확하나 무료 **월 20회**뿐 → 25개 도시엔 부족.
- **Flight Fare Search(RapidAPI): 하루 10회(월 ~300) + 먼 미래 데이터 OK → 채택.**

## 파일
| 경로 | 역할 |
|------|------|
| `index.html` | 정적 페이지 (Chart.js CDN, 바닐라 JS) |
| `data/config.json` | 추적 공항·여행 날짜·하루 호출 예산 (여기만 고치면 됨) |
| `data/latest.json` | 최신 수집 결과 (자동 갱신·병합) |
| `data/history.json` | 날짜별 최저가 누적 (자동 갱신) |
| `data/state.json` | 순환 커서 (다음에 갱신할 도시 위치) |
| `scripts/fetch-prices.mjs` | API 호출 & JSON 갱신 |
| `.github/workflows/track.yml` | 매일 cron + 수동 실행 |
| `vercel.json` | 정적 배포 설정 |

## 설정 (한 번만)
1. **RapidAPI 키**: https://rapidapi.com 가입 → **Flight Fare Search**(`farish978`) API 페이지에서
   `Subscribe to Test` → `Basic`(무료) 구독 → Endpoints 탭의 `X-RapidAPI-Key` 복사.
2. **로컬 테스트**:
   ```bash
   RAPIDAPI_KEY=발급받은키 node scripts/fetch-prices.mjs   # 3개 도시 채워짐
   npx serve .                                              # http://localhost:3000 확인
   ```
   (※ `index.html`을 파일로 직접 열면 JSON fetch가 막힌다. 반드시 정적 서버로.)
3. **GitHub 레포 생성 후 push** → Settings → Secrets and variables → Actions 에 `RAPIDAPI_KEY` 추가.
4. **Vercel** 에서 이 레포 Import → 자동 배포. 그 URL이 상시 확인용 주소.
5. **자동 실행 확인**: Actions 탭 → `Track flight prices` → `Run workflow`(수동) → 커밋·배포 확인. 이후 매일 자동.

## 커스터마이즈
- 공항/도시/날짜/목표가 → `data/config.json`.
- 더 자주·더 많은 도시를 보려면 RapidAPI 유료 플랜으로 올리고 `dailyBudgetCalls` 를 키우면 됨.
