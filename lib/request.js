// for now, make this b/w compat with trader.js calls

const got = require('got')
const uuid = require('uuid')

const PORT = 3000
const RETRY_INTERVAL = 5000
const RETRY_TIMEOUT = 60000

function retrier (timeout) {
  const maxRetries = timeout / RETRY_INTERVAL

  return (retry, err) => {
    if (err.statusCode && err.statusCode === 403) return 0
    if (retry >= maxRetries) return 0

    return RETRY_INTERVAL
  }
}

function request ({ configVersion, settingsVersion }, { clientCert, connectionInfo }, options) {
  if (!connectionInfo) return Promise.resolve()
  const { ca, host } = connectionInfo
  const requestId = uuid.v4()
  const date = new Date().toISOString()
  const headers = {date, 'request-id': requestId}
  if (options.body) headers['content-type'] = 'application/json'
  if (configVersion) headers['config-version'] = configVersion
  if (settingsVersion) headers['settings-version'] = settingsVersion
  const repeatUntilSuccess = !options.noRetry
  const retryTimeout = options.retryTimeout || RETRY_TIMEOUT
  const timeout = options.timeout || 10000

  const retries = repeatUntilSuccess
    ? retrier(retryTimeout)
    : null

  const gotOptions = {
    protocol: 'https:',
    host,
    port: PORT,
    agent: false,
    cert: clientCert.cert,
    key: clientCert.key,
    ca: ca,
    rejectUnauthorized: true,
    method: options.method,
    path: options.path,
    body: options.body,
    retries,
    timeout,
    headers,
    json: true
  }

  return got(options.path, gotOptions)
}

module.exports = request
