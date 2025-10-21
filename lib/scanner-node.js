const _ = require('lodash/fp')

const Pdf417Parser = require('./compliance/parsepdf417')
const { utils: coinUtils } = require('@lamassu/coins')
const { cameraExists, stream } = require('./capture/streamer/v4l2camera')
const { maxCamResolutions, minCamResolutions, maxCamResolutionQRCode, maxCamResolutionPhotoId } = require('./capture/consts')
const pdf417Scanner = require('./capture/scanner/manatee')
const qrScanner = require('./capture/scanner/zxing')
const liveview = require('./capture/liveview/http')
const { ignoreSharpError } = require('./capture/scanner/utils')

const sharp = require('sharp')
const supyo = require('@lamassu/supyo')

const DEFAULT_FPS = 10
const DEFAULT_DELAYEDSHOT_DELAY = 3
const NETWORK = 'main'

let configuration = null
let current_fps = DEFAULT_FPS
let delayedshot_delay = DEFAULT_DELAYEDSHOT_DELAY

let activeStream = null

const mode2conf = mode =>
  mode === 'facephoto' ? 'frontFacingCamera' : 'scanner'

const getCameraDevice = mode => {
  const config = _.get(mode2conf(mode), configuration)

  if (mode === 'qr' && config && config.qrDevice) {
    return config.qrDevice
  }

  return _.get('device', config)
}

const getDelayMS = () => delayedshot_delay * 1000

const setFPS = fps => { current_fps = fps }

function setConfig(formats, mode) {
  const isQRCodeMode = mode === 'qr'
  const isPhotoIdMode = mode === 'photoId'

  const pixelRes = format => format.width * format.height
  const isSuitableRes = res => {
    const currentRes = pixelRes(res)

    const isAboveMinAcceptableResolutions = _.some(_.flow(pixelRes, _.gte(currentRes)))
    const isUnderMaxAcceptableResolutions = _.some(_.flow(pixelRes, _.lte(currentRes)))

    const maxResolutions = isQRCodeMode ? maxCamResolutionQRCode :
      isPhotoIdMode ? maxCamResolutionPhotoId :
        maxCamResolutions
    return isUnderMaxAcceptableResolutions(maxResolutions) &&
      isAboveMinAcceptableResolutions(minCamResolutions)
  }

  const format = _.flow(
    _.orderBy(pixelRes, ['desc']),
    _.find(isSuitableRes),
  )(formats)

  if (!format) throw new Error('Unsupported cam resolution!')
  return format
}

const pickFormat = mode => formats => setConfig(formats, mode)

function config(_configuration) {
  const getConfDelay = camera => _.defaultTo(DEFAULT_DELAYEDSHOT_DELAY, _.get([camera, 'diagnosticDelay'], configuration))
  configuration = _configuration
  delayedshot_delay = Math.max(getConfDelay('scanner'), getConfDelay('frontFacingCamera'))
  if (configuration?.liveviewEnabled)
    liveview.start()
}

const cancel = () => {
  activeStream?.destroy()
  activeStream = null
}

const isOpened = () => !!activeStream

const hasCamera = mode => {
  return Promise.resolve(cameraExists(getCameraDevice(mode)))
}

// new v4l2camera(device) might take up to a second to finish
// we can't halt brain.js immediately after opening a camera
// possible side effects include UI not properly rendering
const deferStream = (device, options) => {
  return new Promise((resolve, reject) => {
    process.nextTick(() => {
      try {
        resolve(stream(device, options))
      } catch (e) {
        reject(e)
      }
    })
  })
}


const noopStillsCallback = () => {}

const capture = async ({
  device,
  mode,
  resultCallback,
  stillsCallback = noopStillsCallback,
  processCallback,
}) => {
  if (!!activeStream) {
    console.log('Camera is already open. Shouldn\'t happen.')
    return resultCallback(new Error('Camera open'))
  }

  const externallyClosedHandler = () => {
    resultCallback(null, null)
    activeStream = null
  }

  const cleanup = () => {
    activeStream?.removeListener('close', externallyClosedHandler)
    cancel()
  }

  try {
    let processing = false
    let lastStillTime = 0

    activeStream = await deferStream(device, {
      fps: current_fps,
      pickFormat: pickFormat(mode)
    })

    // Handle camera being closed by another process
    activeStream.on('close', externallyClosedHandler)

    activeStream.on('data', async ({ frame, width, height }) => {
      liveview.trySend(frame)

      if (processing) return
      processing = true
      const result = await processCallback({
        frame: sharp(frame, { failOn: 'truncated' }),
        width,
        height
      })
      .catch(err => {
        cleanup()
        resultCallback(err, null)
      })

      if (result) {
        cleanup()
        resultCallback(null, result)
      } else {
        const now = Date.now()
        if (now - lastStillTime > 1000) {
          lastStillTime = now
          stillsCallback(Buffer.from(frame))
        }
      }

      processing = false
    })
  } catch (err) {
    resultCallback(err, null)
  }
}

const scanPDF417 = ({ resultCallback, stillsCallback }) => {
  const mode = 'photoId'
  const device = getCameraDevice(mode)

  const processCallback = async ({ frame, width, height }) => {
    const result = await pdf417Scanner.scanPDF417({ frame, width, height })
    return result ? Pdf417Parser.parse(result) : null
  }

  capture({ device, mode, resultCallback, stillsCallback, processCallback })
}

const scanQR = ({ resultCallback }) => {
  const mode = 'qr'
  const device = getCameraDevice(mode)

  const processCallback = async ({ frame, width, height }) => {
    return qrScanner.scanQRcode({ frame, width, height })
  }

  capture({ device, mode, resultCallback, processCallback })
}

const scanMainQR = ({ resultCallback, cryptoCode, stillsCallback }) => {
  const mode = 'qr'
  const device = getCameraDevice(mode)

  const processCallback = async ({ frame, width, height }) => {
    const code = await qrScanner.scanQRcode({ frame, width, height })
    if (!code) return null
    return coinUtils.parseUrl(cryptoCode, NETWORK, code)
  }

  capture({ device, mode, resultCallback, stillsCallback, processCallback })
}

const delayedPhoto = ({ device, mode, resultCallback }) => {
  const timerInit = new Date().getTime()
  const processCallback = async ({ frame, width, height }) => {
    if (timerInit > new Date().getTime() - getDelayMS()) return null
    return frame.toBuffer()
  }

  capture({ device, mode, resultCallback, processCallback })
}

const delayedFacephoto = (resultCallback) => {
  const mode = 'facephoto'
  const device = getCameraDevice(mode)
  delayedPhoto({ device, mode, resultCallback })
}

const scanPhotoCard = resultCallback => {
  const mode = 'photoId'
  const device = getCameraDevice(mode)

  const processCallback = async ({ frame, width, height }) => {
    const bwFrame = await ignoreSharpError(frame.clone().greyscale().raw().toBuffer())
    if (!bwFrame) return null

    const detected = supyo.detect(bwFrame, width, height, {
      minSize: 100,
      qualityThreshold: 20,
      verbose: false
    })

    if (!detected) return null
    return frame.clone().toBuffer()
  }

  capture({ device, mode, resultCallback, processCallback })
}

const diagnosticPhotos = () => {
  const response = {
    scan: null,
    front: null
  }

  const delayOne = (device, field) => (
    new Promise((resolve) => {
      const resultCallback = (err, frame) => {
        if (err) console.log(`Error running diagnostic on ${device}:`, err)
        if (frame) response[field] = frame
        resolve(response)
      }
      delayedPhoto({ device, resultCallback })
    })
  )

  return delayOne('/dev/video-scan', 'scan')
    .then(() => delayOne('/dev/video-front', 'front'))
}

module.exports = {
  config,
  setFPS,
  getDelayMS,
  cancel,
  isOpened,
  hasCamera,

  scanQR,
  scanMainQR,
  scanPDF417,
  scanPhotoCard,
  delayedFacephoto,
  diagnosticPhotos,
}
