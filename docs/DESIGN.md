# Immich Korean Reverse Geocoding Design

## 목표

Immich 사진의 대한민국 좌표를 한국어 주소로 보정하는 워커를 안정적으로 운영한다.

## 요구사항

- Immich PostgreSQL의 `asset_exif`를 읽어 `country`, `state`, `city`를 한글 주소로 보정한다.
- 가까운 사진은 클러스터로 묶어 API 호출 수를 줄인다.
- VWORLD 우선, NAVER 보조, mapping fallback 순서를 유지한다.
- Immich `v3` 환경에서도 핵심 워커 경로가 계속 동작해야 한다.
- 배포는 Docker Hub 이미지 태그와 GitHub 태그를 같은 값으로 맞춘다.

## 가정

- Repository 이름은 `immich-ko-reverse-geocoding`이다.
- 워커는 Immich PostgreSQL에 직접 접근한다.
- Immich `v3`에서도 `asset_exif.city/state/country`, `latitude`, `longitude` 컬럼은 유지된다.

## Architecture

- Worker: Node.js `updater.js`
- CLI 확인용 진입점: `reverse_geocode.js`
- 공통 역지오코딩 모듈: `lib/`
- Cache: PostgreSQL `custom_naver_geocode_cache`

## Immich v3 호환 방침

- 현재 워커의 핵심 의존성은 `asset_exif` 중심이며, `v3`에서도 직접 깨지는 스키마 제거는 없는 것으로 본다.
- 따라서 이번 릴리즈는 워커 로직 대수선보다 `v3 호환성 명시`와 운영 문서 정리를 우선한다.
- 별도 Admin UI나 preview 파일 경로 의존성은 이 레포 범위 밖이다.

## 테스트 계획

- `node --check updater.js`
- `node --check reverse_geocode.js`
- README의 설치/업데이트 예시 버전 일관성 확인

## 배포

- GitHub tag: `v1.4.2`
- Docker image tag: `v1.4.2`

## 위험 요소와 확인 사항

- Immich가 향후 `asset_exif` 주소 컬럼의 의미를 바꾸면 후속 대응이 필요하다.
- 좌표 잠금 정책(`lockedProperties`)은 현재 워커가 좌표 자체를 바꾸지 않으므로 직접 영향이 없다.
