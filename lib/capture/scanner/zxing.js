const { readBarcodesFromImageFile } = require('zxing-wasm/reader')
const { SCANNER_TYPE } = require('../consts')
const { ignoreSharpError } = require('./utils')

const scanPDF417 = async ({ frame }) => {
  const encodedFrame = await ignoreSharpError(frame.greyscale().jpeg().toBuffer())
  if (!encodedFrame) return null

  const barcode = await readBarcodesFromImageFile(new Blob([encodedFrame]), {
    formats: ['PDF417'],
    multiple: false,
    tryHarder: true,
    textMode: "HRI"
  })

  if (!barcode?.length) return null
  return barcode[0]?.text
}

const scanQRcode = async ({ frame }) => {
  const encodedFrame = await ignoreSharpError(frame.greyscale().jpeg().toBuffer())
  if (!encodedFrame) return null

  const barcode = await readBarcodesFromImageFile(new Blob([encodedFrame]), {
    formats: ['QRCode'],
    tryInvert: true,
    tryHarder: true,
    tryRotate: true,
    maxNumberOfSymbols: 1,
    eanAddOnSymbol: "Ignore"
  })

  if (!barcode?.length) return null
  return barcode[0]?.text
}

module.exports = {
  TYPE: SCANNER_TYPE.IMAGE,
  scanPDF417,
  scanQRcode
}
