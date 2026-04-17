const { fetchVworldAddress } = require('./vworld');
const { fetchNaverAddress } = require('./naver');
const { fetchGoogleAddress } = require('./google');
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
  let googleAddress = null;

  if (!address || (preferBuildingName && !address?.poiName)) {
    naverAddress = await fetchNaverAddress(latitude, longitude, config);
  }

  const isKorean = latitude >= 33 && latitude <= 43 && longitude >= 124 && longitude <= 132;
  if (!isKorean && config.googleApiKey) {
    googleAddress = await fetchGoogleAddress(latitude, longitude, config);
  }

  if (!address && naverAddress) {
    address = { ...naverAddress };
  }

  if (!address && googleAddress) {
    address = { ...googleAddress };
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

  if (!address.country && googleAddress?.country) address.country = googleAddress.country;
  if (!address.state && googleAddress?.state) address.state = googleAddress.state;
  if (!address.city && googleAddress?.city) address.city = googleAddress.city;
  if (!address.legalDong && googleAddress?.legalDong) address.legalDong = googleAddress.legalDong;
  if (!address.roadAddress && googleAddress?.roadAddress) address.roadAddress = googleAddress.roadAddress;
  if (!address.jibunAddress && googleAddress?.jibunAddress) address.jibunAddress = googleAddress.jibunAddress;
  if (preferBuildingName && !address.poiName && googleAddress?.poiName) address.poiName = googleAddress.poiName;

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
      google: googleAddress ? {
        state: googleAddress.state || '',
        city: googleAddress.city || '',
        legalDong: googleAddress.legalDong || '',
        buildingName: googleAddress.poiName || '',
        roadAddress: googleAddress.roadAddress || '',
        jibunAddress: googleAddress.jibunAddress || '',
      } : null,
    },
  };

  if (includeRaw) {
    result.raw = {
      selected: address,
      vworld: vworldAddress,
      naver: naverAddress,
      google: googleAddress,
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
