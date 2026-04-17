const https = require('https');

function fetchJson(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return finish(null);
          finish(JSON.parse(data));
        } catch (e) {
          finish(null);
        }
      });
      res.on('error', () => finish(null));
    });

    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (e) {}
      finish(null);
    });
    req.on('error', () => finish(null));
  });
}

module.exports = { fetchJson };
