const fs = require('fs');
const path = require('path');

let locationMap = {};
try {
  const mappingPath = path.join(__dirname, '..', 'mapping.json');
  if (fs.existsSync(mappingPath)) {
    locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  }
} catch (e) {}

function translateLocation(engName) {
  if (!engName) return null;
  const original = engName.toLowerCase().trim();
  const clean = original.replace(/-(do|si|gun|gu|eup|myeon|dong|ri)$/i, '').trim();

  if (locationMap[original]) return locationMap[original];
  if (locationMap[clean]) return locationMap[clean];

  for (const [eng, kor] of Object.entries(locationMap)) {
    const key = eng.toLowerCase();
    if (original === key || original.split('-').includes(key)) return kor;
  }
  return null;
}

function normalizeVworldKoreanText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const map = {
    'South Korea': '대한민국',
    'Korea': '대한민국',
    'Seoul': '서울특별시',
    'Busan': '부산광역시',
    'Daegu': '대구광역시',
    'Incheon': '인천광역시',
    'Gwangju': '광주광역시',
    'Daejeon': '대전광역시',
    'Ulsan': '울산광역시',
    'Sejong': '세종특별자치시',
    'Gyeonggi-do': '경기도',
    'Gangwon-do': '강원특별자치도',
    'Chungcheongbuk-do': '충청북도',
    'Chungcheongnam-do': '충청남도',
    'Jeollabuk-do': '전북특별자치도',
    'Jeollanam-do': '전라남도',
    'Gyeongsangbuk-do': '경상북도',
    'Gyeongsangnam-do': '경상남도',
    'Jeju-do': '제주특별자치도',
  };
  return map[text] || text;
}

function normalizeVworldDepths(structure) {
  const level1 = normalizeVworldKoreanText(structure?.level1 || '');
  const level2 = normalizeVworldKoreanText(structure?.level2 || '');
  const legalDong = normalizeVworldKoreanText(structure?.level4L || '');
  return [level1, level2, legalDong].filter(Boolean);
}

function extractBuildingNameFromRoadText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const paren = raw.match(/\(([^()]*)\)\s*$/);
  if (paren) {
    const parts = paren[1].split(',').map((v) => v.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
    if (parts.length === 1 && !/^[0-9-]+$/.test(parts[0])) return parts[0];
  }

  const tokens = raw.split(/\s+/).map((v) => v.trim()).filter(Boolean);
  const candidate = tokens[tokens.length - 1] || '';
  if (/^[0-9-]+$/.test(candidate)) return '';
  return candidate;
}

function roadTextPartsToAddress(land) {
  return [
    land?.name1,
    [land?.number1, land?.number2].filter(Boolean).join('-'),
    land?.addition0?.value,
  ].filter(Boolean).join(' ').trim();
}

function jibunLandToAddress(land, state, area2, area3, area4) {
  return [
    state,
    area2,
    area3,
    area4,
    land?.number1,
    land?.number2 ? `-${land.number2}` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  translateLocation,
  normalizeVworldKoreanText,
  normalizeVworldDepths,
  extractBuildingNameFromRoadText,
  roadTextPartsToAddress,
  jibunLandToAddress,
};
