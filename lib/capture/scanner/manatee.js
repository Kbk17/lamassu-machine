const manatee = require('@lamassu/manatee')
const fs = require('fs')
const { SCANNER_TYPE } = require('../consts')
const { ignoreSharpError } = require('./utils')

const registerLicenses = () => {
  const license = require('../../../licenses.json').scanner.manatee.license
  const registerLicense = f => manatee.register(f, license[f].name, license[f].key)

  registerLicense('qr')
  registerLicense('pdf417')
}
registerLicenses()

const scanPDF417 = async ({ frame, width, height }) => {
  const encodedFrame = await ignoreSharpError(frame.greyscale().raw().toBuffer())
  if (!encodedFrame) return null

  const result = manatee.scanPDF417(encodedFrame, width, height)
  return result?.toString()
}

const scanQRcode = async ({ frame, width, height }) => {
  const encodedFrame = await ignoreSharpError(frame.jpeg().toBuffer())
  if (!encodedFrame) return null

  const result = manatee.scanQR(encodedFrame, width, height)
  return result?.toString()
}

module.exports = {
  TYPE: SCANNER_TYPE.IMAGE,
  scanPDF417,
  scanQRcode
}
