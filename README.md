# Immich 한국어 역지오코딩 워커

Immich 사진의 대한민국 위치 정보를 **VWORLD 우선 + Naver 보조 + mapping fallback** 방식으로 한글 주소로 보정하는 워커입니다.

이 프로젝트는 Docker Hub 이미지를 기준으로 배포합니다.

- GitHub: https://github.com/lscya84/immich-ko-reverse-geocoding
- Docker Hub: https://hub.docker.com/r/lscya84/immich-ko-reverse-geocoding
- Releases: https://github.com/lscya84/immich-ko-reverse-geocoding/releases

## Immich v3 호환 메모

- Immich `v3`에서도 이 워커의 핵심 경로인 `asset_exif.country/state/city`, `latitude`, `longitude` 기반 보정은 유지됩니다.
- 이 레포는 preview 파일이나 edited asset 파생 파일을 직접 다루지 않으므로, `v3` 대응 포인트는 주로 운영 호환성 확인과 릴리즈 정리에 가깝습니다.
- 좌표 잠금 정책(`lockedProperties`)은 현재 워커가 좌표 자체를 바꾸지 않으므로 직접 충돌하지 않습니다.

## 무엇을 해주나

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

즉, 이 프로젝트의 목적은 좌표를 단순히 영문 지명으로 남겨두지 않고 **Immich에서 보기 쉬운 한국어 위치명 형태로 정리해 넣는 것**입니다.

## 주요 특징

- 기본 역지오코딩: **VWORLD API 우선**
- 보조 보강: **Naver 역지오코딩**
- 최종 fallback: `mapping.json`
- `APPEND_BUILDING_NAME=true|false`로 건물명 보강 on/off 가능
- 사진들을 가까운 위치끼리 **클러스터 단위 처리**
- 같은 장소 클러스터는 API 1회 호출 후 벌크 업데이트
- 메모리 + PostgreSQL 캐시 사용
- 결과 없음(`NOT_FOUND`) 좌표는 **negative cache**로 저장해 불필요한 재시도 방지
- 역지오코딩 로직은 `lib/` 아래 공통 모듈로 분리되어 워커와 CLI가 같은 규칙을 공유

## 버전 / 배포 정책

이 프로젝트는 **GitHub 태그 버전과 Docker 이미지 태그를 같은 값으로** 운영합니다.

예:

- GitHub tag: `v1.4.3`
- Docker image: `lscya84/immich-ko-reverse-geocoding:v1.4.3`

Docker Hub에는 보통 아래 태그가 올라갑니다.

- `main` : main 브랜치 최신 개발본
- `sha-<commit>` : 특정 커밋 추적용
- `vX.Y.Z` : 릴리즈 버전
- `latest` : 최신 안정 버전

운영 환경에서는 **`vX.Y.Z` 고정 사용**을 권장합니다.

## 빠른 설치

### 1) API 키 준비

필수:

- VWORLD API Key
  - https://www.vworld.kr/

선택:

- NAVER_CLIENT_ID
- NAVER_CLIENT_SECRET
  - VWORLD에서 건물명이나 일부 주소값이 비는 경우에만 보조적으로 사용

### 2) Immich 작업 폴더의 `.env`에 값 추가

Immich에서 실제로 사용하는 `.env` 파일에 아래를 추가합니다.

```env
VWORLD_API_KEY=복사한_VWORLD_KEY
NAVER_CLIENT_ID=복사한_ID
NAVER_CLIENT_SECRET=복사한_SECRET
DB_PORT=5432
INTERVAL_HOURS=24
STEP_DELAY_MS=100
CLUSTER_RADIUS_METERS=15
APPEND_BUILDING_NAME=true
NAVER_API_TIMEOUT_MS=10000
NOT_FOUND_CACHE_TTL_DAYS=30
```

설명:

- `DB_PORT`: PostgreSQL 포트
- `INTERVAL_HOURS`: 자동 실행 주기
- `STEP_DELAY_MS`: API 성공 호출 사이 지연
- `CLUSTER_RADIUS_METERS`: 같은 장소로 묶을 반경
- `APPEND_BUILDING_NAME`: 건물명 보강 on/off
- `NAVER_API_TIMEOUT_MS`: Naver API 타임아웃
- `NOT_FOUND_CACHE_TTL_DAYS`: 결과 없음 좌표 재시도 보류 기간

### 3) `docker-compose.yml`에 서비스 추가

Immich 작업 폴더의 `docker-compose.yml`에 아래 서비스를 추가합니다.

```yaml
immich-ko-reverse-geocoding:
  container_name: immich_ko_reverse_geocoding
  image: lscya84/immich-ko-reverse-geocoding:v1.4.3
  restart: always
  volumes:
    - ./.env:/app/.env:ro
  environment:
    DB_HOSTNAME: immich_postgres
    DB_PORT: ${DB_PORT:-5432}
    DB_USERNAME: postgres
    DB_PASSWORD: ${DB_PASSWORD}
    DB_DATABASE_NAME: immich
  depends_on:
    - immich_postgres
```

메모:

- 운영에서는 `image: lscya84/immich-ko-reverse-geocoding:v1.4.3` 같이 **버전 고정**을 권장합니다.
- 자동 최신 추적이 필요하면 `:latest`를 쓸 수 있지만, 예기치 않은 변경까지 바로 반영될 수 있습니다.

### 4) 실행

```bash
docker compose pull immich-ko-reverse-geocoding
docker compose up -d immich-ko-reverse-geocoding
```

최초 설치 후 백그라운드에서 `INTERVAL_HOURS` 주기로 자동 실행됩니다.

---

## 업데이트 방법

### 버전 고정 사용 중일 때

1. `docker-compose.yml`의 이미지 태그를 원하는 버전으로 변경

```yaml
image: lscya84/immich-ko-reverse-geocoding:v1.4.3
```

2. 적용

```bash
docker compose pull immich-ko-reverse-geocoding
docker compose up -d immich-ko-reverse-geocoding
```

### `latest` 사용 중일 때

```bash
docker compose pull immich-ko-reverse-geocoding
docker compose up -d immich-ko-reverse-geocoding
```

### 롤백

이미지 태그만 이전 버전으로 되돌리면 됩니다.

```yaml
image: lscya84/immich-ko-reverse-geocoding:v1.4.1
```

그 다음:

```bash
docker compose pull immich-ko-reverse-geocoding
docker compose up -d immich-ko-reverse-geocoding
```

---

## 로그 확인

```bash
docker compose logs -f --tail=100 immich-ko-reverse-geocoding
```

현재 로그는 아래 흐름을 중심으로 나옵니다.

- 전체 사진 수
- 전체 클러스터 수
- `Fast Track`
- `Negative Cache`
- `API Track`
- API 실패 샘플 일부
- 최종 반영 수

예를 들어:

- `Fast Track`: 캐시 적중 주소 반영
- `Negative Cache`: 결과 없음 좌표 스킵
- `API Track`: 실제 API 확인이 필요한 클러스터

---

## 수동 실행

### 기존 사진까지 전체 재처리

```bash
docker compose exec immich-ko-reverse-geocoding node updater.js --force
```

- 기존 주소값이 있어도 다시 검사하고 반영합니다.
- DB 캐시는 유지한 채 다시 처리합니다.

### 캐시만 삭제 후 종료

```bash
docker compose exec immich-ko-reverse-geocoding node updater.js --clear-cache-only
```

### 캐시 삭제 후 전체 재처리

```bash
docker compose exec immich-ko-reverse-geocoding node updater.js --force --clear-cache
```

---

## 좌표 1건 확인

컨테이너 안에서 단건 좌표를 바로 확인할 수 있습니다.

```bash
docker compose exec immich-ko-reverse-geocoding node reverse_geocode.js 35.354921 127.558729
```

원본 상세 응답까지 보고 싶으면:

```bash
docker compose exec immich-ko-reverse-geocoding node reverse_geocode.js 35.354921 127.558729 --raw
```

기본 출력 예시:

```json
{
  "ok": true,
  "lat": 37.3595704,
  "lon": 127.105399,
  "summary": {
    "country": "대한민국",
    "state": "경기도",
    "city": "성남시 분당구 정자동 (네이버 1784)",
    "legalDong": "정자동",
    "buildingName": "네이버 1784",
    "roadAddress": "불정로 6 네이버 1784",
    "jibunAddress": "경기도 성남시 분당구 정자동 178-4",
    "selectedProvider": "vworld"
  }
}
```

---

## 개발자용: 소스 기준 빌드

Docker Hub 이미지를 쓰지 않고 직접 빌드하고 싶다면 아래처럼 사용할 수 있습니다.

```bash
git clone https://github.com/lscya84/immich-ko-reverse-geocoding.git
cd immich-ko-reverse-geocoding
```

`docker-compose.yml`에서는 `image:` 대신 `build:`를 사용하면 됩니다.

```yaml
immich-ko-reverse-geocoding:
  container_name: immich_ko_reverse_geocoding
  build: ./immich-ko-reverse-geocoding
  restart: always
  volumes:
    - ./.env:/app/.env:ro
  environment:
    DB_HOSTNAME: immich_postgres
    DB_PORT: ${DB_PORT:-5432}
  depends_on:
    - immich_postgres
```

이 방식은 개발/수정 용도에 더 적합하고, 일반 사용자는 Docker Hub 이미지 사용을 권장합니다.

---

## 업데이트 시 참고

- `.env`의 API 키 설정은 그대로 사용됩니다.
- PostgreSQL의 `custom_naver_geocode_cache` 캐시는 기본적으로 유지됩니다.
- `NAVER_API_TIMEOUT_MS`로 네이버 API 요청 최대 대기시간을 조정할 수 있습니다.
- `--force --clear-cache`를 사용하면 메모리/DB 캐시를 모두 비운 뒤 전체 사진을 다시 처리할 수 있습니다.

---

## 트러블슈팅

### 주소가 번역되지 않음

- 네이버 API 결과가 없거나
- `mapping.json`에도 매핑이 없는 경우입니다.

이 프로젝트는 확실하지 않은 정보를 억지로 넣지 않도록 설계되어 있습니다.

### 같은 좌표를 계속 다시 조회하나?

이제 `VWorld=NOT_FOUND` + `Naver=결과 없음` 조합은 **negative cache**로 저장됩니다.
따라서 같은 실패 좌표는 일정 기간 API 재시도를 하지 않습니다.

### 해외 좌표가 잘못 보임

Immich에서 해당 사진의 **메타데이터 갱신(Refresh Metadata)** 후 다시 `--force` 실행을 권장합니다.

---

## 내부 구조

- `lib/http.js`: 공통 HTTP JSON 요청
- `lib/geocode-utils.js`: 텍스트 정규화, building name 추출, mapping fallback 유틸
- `lib/vworld.js`: VWORLD 역지오코딩 전용 모듈
- `lib/naver.js`: Naver 역지오코딩 전용 모듈
- `lib/geocode.js`: 최종 조합 로직 (`VWORLD → Naver → mapping`)
- `reverse_geocode.js`: CLI 엔트리포인트
- `updater.js`: 워커 본체

---

## 요약

이 프로젝트는 **VWORLD를 기본축으로 한국 주소를 안전하게 한글화**하고, 필요할 때만 **Naver**와 **mapping fallback**을 이용해 보강하는 Immich용 역지오코딩 워커입니다.

일반 사용자는 **GitHub 소스 빌드보다 Docker Hub 이미지 설치**를 권장합니다.
