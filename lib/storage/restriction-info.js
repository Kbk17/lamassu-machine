const pify = require('pify')
const fs = require('fs')
const writeFile = pify(fs.writeFile)
const path = require('path')

let restrictionInfo = null

function save (dataPath, level) {
  if (restrictionInfo?.level === level) return Promise.resolve()

  const newInfo = { level: level ?? 0 }
  restrictionInfo = newInfo
  return writeFile(path.resolve(dataPath, 'restriction-info.json'), JSON.stringify(newInfo))
}

function load (dataPath) {
  try {
    if (restrictionInfo) return restrictionInfo
    restrictionInfo = JSON.parse(fs.readFileSync(path.resolve(dataPath, 'restriction-info.json')))
    return restrictionInfo
  } catch (err) {
    return { level: 0, timestamp: null }
  }
}

module.exports = { save, load }