'use strict'

/*
 * How to use:
 * 1. Copy `update.tar` into `/opt/lamassu-updates/download/`
 * 2. Run `node manual_update.js PLATFORM MODEL true`
 */

const fs = require('fs')
const path = require('path')

const codeRoot = __dirname
const DEVICE_CONFIG_PATH = path.join(codeRoot, 'device_config.json')

const deviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_PATH))

const config = deviceConfig.updater.extractor
config.skipVerify = true

const extractor = require(path.join(codeRoot, 'lib/update/extractor')).factory(config)

const fileInfo = {
  rootPath: '/opt/lamassu-updates/extract',
  filePath: '/opt/lamassu-updates/download/update.tar'
}

process.on('SIGTERM', function () {
  // Immune
})

const extract = (fileInfo) =>
  new Promise((resolve, reject) =>
    extractor.extract(fileInfo, err => err ? reject(err) : resolve())
  )

const upgrade = () => {
  const lmm = require(path.join(fileInfo.rootPath, 'package', 'lamassu-machine-manager.js'))
  return lmm.upgrade(true)
}

extract(fileInfo)
  .then(upgrade)
  .catch(console.log)
