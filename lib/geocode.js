const { fetchVworldAddress } = require('./vworld');
const { fetchNaverAddress } = require('./naver');
const { translateLocation } = require('./geocode-utils');

async function reverseGeocode(lat, lon, config, options = {}) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) {
    throw new Error('lat/lon must be valid numbers');
  }

  const latitude = Number(lat);
  const longitude = Number(lon);
  const preferBuildingName = options.preferBuildingName !== false;
  const includeRaw = options.includeRaw === true;

  const vworldAddress = await fetchVworldAddress(latitude, longitude, config);
  let address = vworldAddress;
  let naverAddress = null;

  if (!address || (preferBuildingName && !address?.poiName)) {
    naverAddress = await fetchNaverAddress(latitude, longitude, config);
  }

  if (!address && naverAddress) {
    address = { ...naverAddress };
  }

  if (!address) {
    return {
      ok: false,
      lat: latitude,
      lon: longitude,
      error: 'No reverse geocoding result',
    };
  }

  if (preferBuildingName && !address.poiName && naverAddress?.poiName) {
    address.poiName = naverAddress.poiName;
  }

  if (!address.country && naverAddress?.country) address.country = naverAddress.country;
  if (!address.state && naverAddress?.state) address.state = naverAddress.state;
  if (!address.city && naverAddress?.city) address.city = naverAddress.city;
  if (!address.legalDong && naverAddress?.legalDong) address.legalDong = naverAddress.legalDong;
  if (!address.roadAddress && naverAddress?.roadAddress) address.roadAddress = naverAddress.roadAddress;
  if (!address.jibunAddress && naverAddress?.jibunAddress) address.jibunAddress = naverAddress.jibunAddress;

  const mappedState = translateLocation(address.state);
  const mappedCity = translateLocation(address.city);
  if (!address.state && mappedState) address.state = mappedState;
  if (!address.city && mappedCity) address.city = mappedCity;

  if (address.poiName && address.city && !address.city.includes(address.poiName)) {
    address.city = `${address.city} (${address.poiName})`.trim();
  }

  const result = {
    ok: true,
    lat: latitude,
    lon: longitude,
    summary: {
      country: address.country || '',
      state: address.state || '',
      city: address.city || '',
      legalDong: address.legalDong || '',
      buildingName: address.poiName || '',
      roadAddress: address.roadAddress || '',
      jibunAddress: address.jibunAddress || '',
      selectedProvider: address.provider || '',
    },
    providers: {
      vworld: vworldAddress ? {
        state: vworldAddress.state || '',
        city: vworldAddress.city || '',
        legalDong: vworldAddress.legalDong || '',
        buildingName: vworldAddress.poiName || '',
        roadAddress: vworldAddress.roadAddress || '',
        jibunAddress: vworldAddress.jibunAddress || '',
      } : null,
      naver: naverAddress ? {
        state: naverAddress.state || '',
        city: naverAddress.city || '',
        legalDong: naverAddress.legalDong || '',
        buildingName: naverAddress.poiName || '',
        roadAddress: naverAddress.roadAddress || '',
        jibunAddress: naverAddress.jibunAddress || '',
      } : null,
    },
  };

  if (includeRaw) {
    result.raw = {
      selected: address,
      vworld: vworldAddress,
      naver: naverAddress,
    };
  }

  return result;
}

module.exports = {
  reverseGeocode,
  fetchVworldAddress,
  fetchNaverAddress,
  translateLocation,
};
