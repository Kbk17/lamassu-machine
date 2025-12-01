'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

let isOffline = false

function loadCerts() {
  const config = JSON.parse(fs.readFileSync('/opt/lamassu-machine/device_config.json'));
  if (fs.existsSync(config.updater.caFile)) {
    return {
      ca: fs.readFileSync(config.updater.caFile),
      cert: fs.readFileSync(path.resolve('/opt/lamassu-machine', config.brain.dataPath, 'client.pem')),
      key: fs.readFileSync(path.resolve('/opt/lamassu-machine', config.brain.dataPath, 'client.key'))
    };
  }
}

let loaded_certs = null;
const certs = () => {
  if (!loaded_certs)
    loaded_certs = loadCerts()
  return loaded_certs;
}

function report(err, res, cb) {
  console.log(res);
  if (isOffline)
    return cb()

  const data = JSON.stringify({
    error: err ? err : null,
    result: res
  });

  const { cert, key } = certs()

  const options = {
    host: 'updates.lamassu.is',
    port: 8000,
    path: '/report',
    method: 'POST',
    key,
    cert,
    rejectUnauthorized: true,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  options.agent = new https.Agent(options);

  // Set up the request
  const req = https.request(options, function(res) {
    res.setEncoding('utf8');
    res.resume();
    res.on('end', cb);
  });

  req.on('error', function(err) { console.log(err); cb(); });
  req.write(data);
  req.end();
};

const setOffline = () => {
  isOffline = true
}

module.exports = {
  report,
  setOffline,
}
