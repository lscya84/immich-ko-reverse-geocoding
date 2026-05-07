const { fetchJsonDetailed } = require('./http');
const { extractBuildingNameFromRoadText, roadTextPartsToAddress, jibunLandToAddress } = require('./geocode-utils');

async function fetchNaverAddressDetailed(lat, lon, config) {
  if (!config.naverId || !config.naverSecret) {
    return { address: null, attempted: false, provider: 'naver', reason: 'missing-naver-key' };
  }

  const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=legalcode,admcode,roadaddr,addr`;
  const response = await fetchJsonDetailed(url, {
    'x-ncp-apigw-api-key-id': config.naverId,
    'x-ncp-apigw-api-key': config.naverSecret,
  }, config.apiTimeoutMs);

  if (!response.ok) {
    return {
      address: null,
      attempted: true,
      provider: 'naver',
      reason: response.error || 'request-failed',
      statusCode: response.statusCode || 0,
    };
  }

  const parsed = response.data;
  if (parsed?.status?.code !== 0 || !Array.isArray(parsed.results) || !parsed.results.length) {
    return {
      address: null,
      attempted: true,
      provider: 'naver',
      reason: parsed?.status?.message || `status-code-${parsed?.status?.code ?? 'unknown'}`,
      statusCode: response.statusCode || 200,
    };
  }

  const legalResult = parsed.results.find((r) => r.name === 'legalcode');
  const admResult = parsed.results.find((r) => r.name === 'admcode');
  const regionResult = legalResult || admResult || parsed.results.find((r) => r.region) || parsed.results[0];
  const region = regionResult?.region;
  if (!region) {
    return {
      address: null,
      attempted: true,
      provider: 'naver',
      reason: 'missing-region',
      statusCode: response.statusCode || 200,
    };
  }

  const state = region.area1?.name || '';
  const area2 = region.area2?.name || '';
  const area3 = region.area3?.name || '';
  const area4 = region.area4?.name || '';
  const city = [area2, area3, area4].filter(Boolean).join(' ').trim();

  const roadResult = parsed.results.find((r) => r.name === 'roadaddr');
  const jibunResult = parsed.results.find((r) => r.name === 'addr');
  let poiName = '';
  const rawBuildingName = roadResult?.land?.addition0?.value?.trim();
  if (rawBuildingName && rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
    poiName = rawBuildingName;
  } else if (roadResult?.land) {
    const roadTextParts = [
      roadResult.land.name1,
      roadResult.land.number1,
      roadResult.land.number2,
      roadResult.land.addition1?.value,
      roadResult.land.addition2?.value,
      roadResult.land.addition3?.value,
      roadResult.land.addition4?.value,
    ].filter(Boolean);
    poiName = extractBuildingNameFromRoadText(roadTextParts.join(' '));
  }

  return {
    address: {
      country: '대한민국',
      state,
      city,
      legalDong: [area3, area4].filter(Boolean).join(' ').trim(),
      poiName,
      roadAddress: roadResult?.land ? roadTextPartsToAddress(roadResult.land) : '',
      jibunAddress: jibunResult?.land ? jibunLandToAddress(jibunResult.land, state, area2, area3, area4) : '',
      provider: 'naver',
      source: 'api',
    },
    attempted: true,
    provider: 'naver',
    reason: 'ok',
    statusCode: response.statusCode || 200,
  };
}

async function fetchNaverAddress(lat, lon, config) {
  const result = await fetchNaverAddressDetailed(lat, lon, config);
  return result.address;
}

module.exports = { fetchNaverAddress, fetchNaverAddressDetailed };
