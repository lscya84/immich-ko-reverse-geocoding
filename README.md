# Immich 한국어 역지오코딩 워커

Immich 사진의 대한민국 위치 정보를 **VWORLD 기반 기본 역지오코딩 + 선택적 Naver 건물명 보강** 방식으로 한글 주소 보정하는 워커입니다.

이 프로젝트는 다음에 초점을 맞춥니다.
- 한국 주소를 더 자연스럽게 한글화
- 기본 역지오코딩은 **VWORLD API 우선**으로 처리
- VWORLD가 부족하거나 실패하면 **Naver 역지오코딩을 보조적으로 사용**
- **건물명 보강은 env 설정으로 on/off 가능**
- 전체 강제 처리 시 가까운 사진을 **클러스터 단위**로 묶어 빠르게 반영
- 해외 데이터는 건드리지 않고 보존
- 기존 설치 사용자가 쉽게 업데이트 가능

## 위치정보가 표시되는 방식

이 워커는 Immich의 위치 메타데이터 중 주로 아래 값을 보정합니다.

- `country` → `대한민국`
- `state` → 시/도
- `city` → 시/군/구/읍/면/동

예를 들면:
- `country`: `대한민국`
- `state`: `경기도`
- `city`: `성남시 분당구 정자동`

네이버 도로명 응답에 **건물명**이 있으면 `city`에 함께 붙여 더 읽기 쉽게 표시할 수 있습니다.

예:
- `city`: `성남시 분당구 정자동 (네이버 1784)`

즉, 이 프로젝트는 좌표를 단순히 영문 지명으로 남겨두지 않고,
**Immich에서 보기 쉬운 한국어 위치명 형태로 정리해 넣는 것**이 목적입니다.

## 주요 특징

- VWORLD API 기반 기본 역지오코딩
- 법정동(`level4L`) 기준 주소 반영
- 우선순위: **VWORLD → Naver → mapping.json**
- `APPEND_BUILDING_NAME=true|false`로 건물명 보강 on/off 가능
- Naver API는 건물명 보강뿐 아니라 역지오코딩 보조 fallback으로도 사용
- `mapping.json`은 최종 보조 매핑 fallback
- 메모리 + PostgreSQL 캐시 사용
- 사진들을 가까운 위치끼리 **클러스터 단위 처리**
- 같은 장소 클러스터는 API 1회 호출 후 벌크 업데이트
- 캐시 TTL(180일) 적용
- 작업 중복 실행 방지

## 릴리즈

- Latest: [v1.3.0](https://github.com/lscya84/immich-naver-reverse-geocoding/releases/tag/v1.3.0)
- Previous: [v1.2.0](https://github.com/lscya84/immich-naver-reverse-geocoding/releases/tag/v1.2.0)
- Initial: [v1.0.0](https://github.com/lscya84/immich-naver-reverse-geocoding/releases/tag/v1.0.0)
- Releases: [GitHub Releases](https://github.com/lscya84/immich-naver-reverse-geocoding/releases)

---

## 설치 방법

### 1) 저장소 클론
Immich를 운영 중인 **본인 작업 폴더**에서 클론합니다.

```bash
git clone https://github.com/lscya84/immich-naver-reverse-geocoding.git
cd immich-naver-reverse-geocoding
```

### 2) VWORLD API 키 준비
기본 역지오코딩은 VWORLD API를 사용합니다. 아래 키를 준비해 주세요.

- VWORLD: https://www.vworld.kr/

준비할 값:
- `VWORLD_API_KEY`

### 3) Naver API 키 준비 (선택, 건물명 보강용)
Naver API는 건물명 보강과 VWORLD 실패 시 역지오코딩 보조 fallback에 사용됩니다. `APPEND_BUILDING_NAME=false`면 건물명 보강은 하지 않지만, VWORLD 실패 시 주소 fallback 용도로는 계속 사용됩니다.

준비할 값:
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

### 4) `.env` 설정
Immich에서 실제로 사용하는 `.env` 파일에 아래를 추가합니다.

```env
VWORLD_API_KEY=복사한_VWORLD_KEY
NAVER_CLIENT_ID=복사한_ID
NAVER_CLIENT_SECRET=복사한_Secret
INTERVAL_HOURS=24
STEP_DELAY_MS=100
CLUSTER_RADIUS_METERS=15
APPEND_BUILDING_NAME=true
NAVER_API_TIMEOUT_MS=10000
```

### 5) `mapping.json` 준비
이 저장소는 기본적으로 `mapping.csv`를 포함해 배포하는 것을 전제로 합니다.
따라서 일반적인 사용자는 별도로 `mapping.csv`를 새로 구할 필요 없이, 저장소에 포함된 파일로 `mapping.json`만 생성하면 됩니다.

```bash
node make_mapping.js
```

특별히 최신 행정구역 기준으로 다시 만들고 싶은 경우에만 `mapping.csv`를 교체해서 재생성하면 됩니다.

> 참고: `mapping.csv`가 UTF-8이 아닌 CP949/EUC-KR 계열 인코딩이면 한글이 깨질 수 있습니다. 이 경우 UTF-8로 변환한 뒤 `mapping.json`을 다시 생성하세요.

### 6) `docker-compose.yml`에 서비스 추가
Immich의 `docker-compose.yml`에 아래 서비스를 추가합니다.

```yaml
immich-naver-reverse-geocoding:
  container_name: immich_naver_reverse_geocoding
  build: ./immich-naver-reverse-geocoding
  restart: always
  volumes:
    - ./.env:/app/.env:ro
  environment:
    - DB_HOSTNAME=immich_postgres
  depends_on:
    - immich_postgres
```

### 7) 빌드 및 실행
Immich 작업 폴더에서 실행합니다.

```bash
docker compose up -d --build immich-naver-reverse-geocoding
```

---

## 업데이트 방법

이미 설치한 사용자는 보통 아래 순서면 충분합니다.

### 최신판으로 업데이트
```bash
cd <immich 작업 폴더>/immich-naver-reverse-geocoding
git pull origin main
cd <immich 작업 폴더>
docker compose up -d --build immich-naver-reverse-geocoding
```

---

## 실행 / 사용

### 백그라운드 스케줄러
`INTERVAL_HOURS` 주기로 자동 실행됩니다.

### 수동 강제 실행
기존 사진까지 다시 처리하려면, 가까운 사진을 같은 장소 클러스터로 묶어서 재처리합니다. 기본 실행도 동일하게 클러스터 단위로 동작합니다.

```bash
docker compose exec immich-naver-reverse-geocoding node updater.js --force
```

### 로그 확인
```bash
docker compose logs -f --tail=100 immich-naver-reverse-geocoding
```

---

## 업데이트 시 참고

- `.env`의 네이버 API 키는 그대로 사용됩니다.
- PostgreSQL의 `custom_naver_geocode_cache` 캐시는 유지됩니다.
- `NAVER_API_TIMEOUT_MS`로 네이버 API 요청 최대 대기시간(기본 10000ms)을 조정할 수 있습니다.
- 코드 변경 후에는 `docker compose up -d --build ...`로 재빌드해야 반영됩니다.

---

## 트러블슈팅

### 주소가 번역되지 않음
- 네이버 API 결과가 없거나
- `mapping.json`에도 매핑이 없는 경우입니다.

이 프로젝트는 확실하지 않은 정보를 억지로 넣지 않도록 설계되어 있습니다.

### 해외 좌표가 잘못 보임
Immich에서 해당 사진의 **메타데이터 갱신(Refresh Metadata)** 후 다시 `--force` 실행을 권장합니다.

---

## 요약

이 프로젝트는 **한국 주소를 안전하게 한글화**하면서도,
**기존 설치 사용자가 쉽게 업데이트할 수 있게 만든 Immich용 역지오코딩 워커**입니다.
