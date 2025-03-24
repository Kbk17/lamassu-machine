const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const _ = require('lodash/fp')
const Pdf417Parser = require('./compliance/parsepdf417')
const { utils: coinUtils } = require('@lamassu/coins')
const cameraStreamer = require('./camera-streamer')
const usbCamera = require('./usb-camera')

const IS_VERBOSE = require('minimist')(process.argv.slice(2)).devBoard

cameraStreamer.setVerbose(IS_VERBOSE)
usbCamera.setVerbose(IS_VERBOSE)

let configuration = null
let kogoroshiya = null
const DEFAULT_FPS = 10
let current_fps = DEFAULT_FPS
const DEFAULT_DELAYEDSHOT_DELAY = 3
let delayedshot_delay = DEFAULT_DELAYEDSHOT_DELAY

const maxCamResolutions = [
  {
    width: 2592,
    height: 1944
  }
]

const minCamResolutions = [
  {
    width: 1280,
    height: 1024
  },
  {
    width: 1280,
    height: 960
  },
  {
    width: 1280,
    height: 720
  },
  {
    width: 640,
    height: 480
  }
]

const maxCamResolutionQRCode = [
  {
    width: 1920,
    height: 1080
  }
]

const maxCamResolutionPhotoId = [
  {
    width: 1280,
    height: 1024
  }
]

const outCallback2inCallback = callback =>
  (err, frame) =>
    err ? callback(err) :
    !frame ? callback(null, null) :
    callback(null, frame)

const mode2conf = mode =>
  mode === 'facephoto' ? 'frontFacingCamera' : 'scanner'

const getCameraDevice = mode => {
  const config = _.get(mode2conf(mode), configuration)

  if (mode === 'qr' && config && config.qrDevice) {
    return config.qrDevice
  }

  return _.get('device', config)
}

const getCameraConfig = mode =>
  _.get([mode2conf(mode), mode], configuration)

const setFPS = fps => { current_fps = fps }

function setConfig (formats, mode) {
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

function config (_configuration) {
  console.log('[SCANNER] Configuring scanner')
  console.log('[SCANNER] Full camera configuration:', JSON.stringify(_configuration.frontFacingCamera || {}))
  configuration = _configuration
  
  // Add camera configuration debugging
  if (_configuration.frontFacingCamera && _configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Found front camera configuration:', _configuration.frontFacingCamera.device)
  } else {
    console.log('[SCANNER] WARNING: No front camera configuration in config file')
  }
  
  // Initialize USB camera with correct configuration
  usbCamera.initialize(_configuration)
  
  // Set camera delay from configuration
  const getConfDelay = camera => _.defaultTo(DEFAULT_DELAYEDSHOT_DELAY, _.get([camera, 'diagnosticDelay'], configuration))
  delayedshot_delay = Math.max(getConfDelay('scanner'), getConfDelay('frontFacingCamera'))
  
  // If we're using a separate camera module (when Newland scanner is active)
  // Use frontFacingCamera configuration instead of scanner configuration
  if (_configuration.frontFacingCamera && _configuration.scanner && _configuration.scanner.type === 'newland') {
    console.log('[CAMERA] Using separate camera configuration for camera module')
    cameraStreamer.setDevicePath(_configuration.frontFacingCamera.device)
  } else {
    // Normal scanner configuration
    cameraStreamer.setDevicePath(_configuration.scanner?.device)
  }
  
  console.log('[CAMERA] Camera module initialized with device:', cameraStreamer.getDevicePath())
}

const isCancelledError = err => err.cancelled
const isAbortError = err => err.name === 'AbortError'
const shouldIgnoreError = err => isCancelledError(err) || isAbortError(err)

const clear_kogoroshiya = () => {
  kogoroshiya = null
}

const replace_kogoroshiya = (atarashii_kogoroshiya) => {
  if (kogoroshiya) kogoroshiya.abort()
  kogoroshiya = atarashii_kogoroshiya
}

const cancel = () => {
  replace_kogoroshiya(null)
  return false
}

const isOpened = () => !!kogoroshiya

const hasCamera = (type) => {
  // First check with the dedicated USB camera module
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Checking camera with USB camera module for type:', type)
    return usbCamera.hasCamera(type)
  }
  
  // Fallback to legacy camera streamer
  console.log('[SCANNER] Falling back to camera streamer for camera check')
  return cameraStreamer.hasCamera(configuration.scanner?.device)
}

const maybeTmpdir = save =>
  !save ?
    Promise.resolve(null) :
    fs.mkdtemp(path.join(os.tmpdir(), 'failed-scans-'))
      .catch(err => {
        console.error(err)
        return null /* cameraStreamer ignores the tmpdir if null */
      })

const scanQR = (_saveFailedScans, callback) => {
  const saveFailedScans = _saveFailedScans ?
    /* NOTE: _saveFailedScans() MUST NOT reject */
    dirs => _saveFailedScans(dirs).then(() => Promise.all(_.map(rmrf, dirs))) :
    () => Promise.resolve(null)
  maybeTmpdir(saveFailedScans)
    .then(tmpdir => {
      const tmpdirs = tmpdir ? [tmpdir] : []
      const [korose, promise] = cameraStreamer.scanQR(getCameraDevice('qr'), pickFormat('qr'), current_fps, tmpdir)
      replace_kogoroshiya(korose)
      promise
        .then(result => {
          clear_kogoroshiya()
          saveFailedScans(tmpdirs)
            .then(() => callback(null, result ? result.toString() : result))
        })
        .catch(error => {
          clear_kogoroshiya()
          saveFailedScans(tmpdirs)
            .then(() => shouldIgnoreError(error) ? callback(null, null) : callback(error, null))
        })
    })
}

const rmrf = dir =>
  fs.rm(dir, { force: true, recursive: true, maxRetries: 5 })
    .catch(err => console.log("Error removing failed scans directory (", dir, "): ", err))

const scanPDF417 = (callback, idCardStillsCallback) => {
  /* NOTE: idCardStillsCallback() MUST NOT reject */
  const saveFailedScans = dirs => idCardStillsCallback(dirs).then(() => Promise.all(_.map(rmrf, dirs)))

  const mode = 'photoId'
  const device = getCameraDevice(mode)
  const pickfmt = pickFormat(mode)

  const resolveScan = (tmpdirs, promise) =>
    promise
      .then(result => {
        clear_kogoroshiya()
        return result
      })
      .then(result => Promise.all([
        result ? Pdf417Parser.parse(result) : null,
        saveFailedScans(tmpdirs)
      ]))
      .then(([parsed, _]) => {
        callback(null, parsed)
      })
      .catch(err => {
        clear_kogoroshiya()
        saveFailedScans(tmpdirs)
          .then(() => shouldIgnoreError(err) ? callback(null, null) : callback(err, null))
      })

  maybeTmpdir(true)
    .then(tmpdir => {
      const tmpdirs = tmpdir ? [tmpdir] : []
      const [korose, promise] = cameraStreamer.scanPDF417(device, pickfmt, current_fps, tmpdir)
      replace_kogoroshiya(korose)
      return resolveScan(tmpdirs, promise)
    })
}

const detectFace = (mode, minsizeDef, cutoffDef, callback) => {
  const device = getCameraDevice(mode)
  const modeConfig = getCameraConfig(mode)
  const minsize = _.defaultTo(minsizeDef, _.get(['minFaceSize'], modeConfig))
  const cutoff = _.defaultTo(cutoffDef, _.get(['threshold'], modeConfig))
  const [korose, promise] = cameraStreamer.detectFace(device, pickFormat(mode), current_fps, minsize, cutoff)
  replace_kogoroshiya(korose)
  promise
    .then(frame => {
      clear_kogoroshiya()
      callback(null, frame)
    })
    .catch(error => {
      clear_kogoroshiya()
      shouldIgnoreError(error) ? callback(null, null) : callback(error, null)
    })
}

const scanPhoto = callback => detectFace('photoId', 180, 20, callback)
const scanFacephoto = callback => detectFace('facephoto', 180, 20, callback)

const scanPairingCode = callback =>
  scanQR(null, outCallback2inCallback(callback))

const scanMainQR = (cryptoCode, saveFailedScans, callback) =>
  scanQR(saveFailedScans, (err, result) => {
    if (err) return callback(err)
    if (!result) return callback(null, null)

    console.log('DEBUG55: %s', result)

    const network = 'main'
    try {
      callback(null, coinUtils.parseUrl(cryptoCode, network, result))
    } catch (error) {
      callback(error)
    }
  })

const scanPhotoCard = callback => {
  console.log('[SCANNER] Scanning photo card')
  
  // Use dedicated USB camera if available
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for photo card')
    return usbCamera.delayedPhoto(callback)
  }
  
  // Fallback to legacy method
  return scanPhoto(outCallback2inCallback(callback))
}

const takeFacephoto = callback => {
  console.log('[SCANNER] Taking face photo')
  
  // Use dedicated USB camera if available
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for face photo')
    return usbCamera.takeFacePhoto(callback)
  }
  
  // Fallback to legacy method
  return scanFacephoto(outCallback2inCallback(callback))
}

const delayedshot = (mode, device) => {
  // Use dedicated USB camera for face photos
  if (mode === 'facephoto' && configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for delayed shot (facephoto)')
    return new Promise((resolve, reject) => {
      usbCamera.takeFacePhoto((err, buffer) => {
        if (err) return reject(err)
        resolve(buffer)
      }, { delay: delayedshot_delay * 1000 })
    })
  }
  
  // Fallback to legacy camera streamer method
  const [korose, promise] = cameraStreamer.delayedshot(device || getCameraDevice(mode), pickFormat(mode), current_fps, delayedshot_delay)
  replace_kogoroshiya(korose)
  return promise
    .then(frame => {
      clear_kogoroshiya()
      return frame
    })
    .catch(err => {
      clear_kogoroshiya()
      return shouldIgnoreError(err) ? Promise.resolve(null) : Promise.reject(err)
    })
}

const delayedFacephoto = callback => {
  console.log('[SCANNER] Taking delayed face photo')
  
  // Use dedicated USB camera if available
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for delayed face photo')
    return usbCamera.delayedFacephoto(callback)
  }
  
  // Fallback to legacy method
  return delayedshot('facephoto')
    .then(it => callback(null, it))
    .catch(err => callback(err, null))
}

const delayedPhoto = callback => {
  console.log('[SCANNER] Taking delayed photo')
  
  // Use dedicated USB camera if available
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for delayed photo')
    return usbCamera.delayedPhoto(callback)
  }
  
  // Fallback to legacy method
  return delayedshot('photoId')
    .then(it => callback(null, it))
    .catch(err => callback(err, null))
}

const diagnosticPhotos = () => {
  console.log('[SCANNER] Taking diagnostic photos')
  
  // Use dedicated USB camera if available
  if (configuration.frontFacingCamera && configuration.frontFacingCamera.device) {
    console.log('[SCANNER] Using USB camera for diagnostic photos')
    return usbCamera.diagnosticPhotos()
  }
  
  // Fallback to legacy method
  cameraStreamer.setVerbose(true)

  const response = {
    scan: null,
    front: null
  }

  return delayedshot('', '/dev/video-scan')
    .then((scan) => {
      if (scan) {
        response.scan = scan.toString('base64')
      }
    })
    .catch(() => {})
    .then(() => delayedshot('', '/dev/video-front'))
    .then((front) => {
      if (front) {
        response.front = front.toString('base64')
      }
    })
    .catch(() => {})
    .then(() => {
      cameraStreamer.setVerbose(IS_VERBOSE)
      return response
    })
}

const getDelayMS = () => {
  console.log('[SCANNER] getDelayMS: Zwracam domyślne opóźnienie 3000ms dla T&C')
  // Zawsze zwracaj stałą wartość 3000ms dla T&C (3 sekundy)
  return 3000;
}

// Funkcja do bezpiecznego zapisu zdjęcia w module facephoto
function safeSetTCData(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 1000) {
    console.log('[SCANNER] Invalid photo buffer for saving in facephoto');
    return null;
  }
  
  try {
    const facephoto = require('./compliance/flows/facephoto');
    const savedBuffer = facephoto.setTCData(buffer);
    console.log('[SCANNER] TC photo saved in facephoto module, size:', 
                savedBuffer ? savedBuffer.length : 'no data');
    return savedBuffer;
  } catch (saveErr) {
    console.log('[SCANNER] Error saving photo in facephoto module:', saveErr.message);
    return null;
  }
}

/**
 * Takes a face photo for Terms & Conditions
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
const takeFacePhotoTC = callback => {
  console.log('[SCANNER] Delegating takeFacePhotoTC function to USB camera module - ' + new Date().toISOString())
  
  // Check if callback is a function
  if (typeof callback !== 'function') {
    console.log('[SCANNER] ERROR: callback is not a function in takeFacePhotoTC')
    return
  }
  
  // Save log to file to make sure function is being called
  try {
    const fs = require('fs')
    fs.appendFileSync('/tmp/tc-scanner-debug.log', `[SCANNER] takeFacePhotoTC called: ${new Date().toISOString()}\n`)
  } catch (err) {
    console.log('[SCANNER] Błąd zapisu do pliku debug:', err.message)
  }
  
  // Tworzymy funkcję bezpiecznego callback, która zapewni, że zostanie wywołana tylko raz
  let callbackCalled = false
  const safeCallback = (err, buffer) => {
    if (callbackCalled) {
      console.log('[SCANNER] UWAGA: Callback już był wywołany, ignoruję ponowne wywołanie')
      return
    }
    
    callbackCalled = true
    
    // Loguj wynik
    try {
      const fs = require('fs')
      fs.appendFileSync('/tmp/tc-scanner-debug.log', 
                       `[SCANNER] takeFacePhotoTC callback executed: ${new Date().toISOString()}, ` +
                       `error: ${err ? 'YES: ' + err.message : 'NO'}, ` +
                       `buffer: ${buffer ? 'YES, size: ' + buffer.length : 'NO'}\n`)
    } catch (logErr) {
      console.log('[SCANNER] Błąd zapisu logu wyniku:', logErr.message)
    }
    
    // Zapisz zdjęcie w module facephoto
    if (!err && buffer && buffer.length > 0) {
      safeSetTCData(buffer);
    }
    
    callback(err, buffer)
  }
  
  // Ustaw timeout bezpieczeństwa
  const timeoutId = setTimeout(() => {
    console.log('[SCANNER] TIMEOUT: Przekroczono czas oczekiwania na zdjęcie (20 sekund)')
    safeCallback(new Error('Timeout podczas wykonywania zdjęcia z modułu USB camera'), null)
  }, 20000) // 20 sekund
  
  // Korzystamy z modułu usb-camera.js do wykonania zdjęcia
  try {
    usbCamera.takeFacePhotoTC((err, buffer) => {
      // Wyczyść timeout
      clearTimeout(timeoutId)
      
      if (!err && buffer && buffer.length > 0) {
        console.log('[SCANNER] Zdjęcie T&C wykonane pomyślnie, rozmiar:', buffer.length, 'bajtów')
        safeCallback(null, buffer)
      } else {
        console.log('[SCANNER] Błąd wykonania zdjęcia T&C:', err ? err.message : 'Brak danych obrazu')
        
        // Spróbuj alternatywnej metody
        try {
          console.log('[SCANNER] Próba użycia alternatywnej metody wykonania zdjęcia')
          usbCamera.takeFacePhotoTCAlternative((altErr, altBuffer) => {
            if (!altErr && altBuffer && altBuffer.length > 0) {
              console.log('[SCANNER] Alternatywna metoda powiodła się, rozmiar:', altBuffer.length, 'bajtów')
              safeCallback(null, altBuffer)
            } else {
              console.log('[SCANNER] Alternatywna metoda również nie powiodła się:', 
                           altErr ? altErr.message : 'Brak danych obrazu')
              
              // Jeśli obie metody zawiodły, zwróć oryginalny błąd
              safeCallback(err || new Error('Nie udało się wykonać zdjęcia T&C'), null)
            }
          })
        } catch (altErr) {
          console.log('[SCANNER] BŁĄD podczas wywołania alternatywnej metody:', altErr.message)
          safeCallback(err || altErr, null)
        }
      }
    })
  } catch (error) {
    console.log('[SCANNER] BŁĄD podczas wywołania usbCamera.takeFacePhotoTC:', error.message)
    
    // Wyczyść timeout
    clearTimeout(timeoutId)
    
    // W przypadku złapania wyjątku, spróbuj alternatywnej metody
    try {
      console.log('[SCANNER] Próba użycia alternatywnej metody po złapaniu wyjątku')
      usbCamera.takeFacePhotoTCAlternative(safeCallback)
    } catch (altErr) {
      console.log('[SCANNER] BŁĄD również w alternatywnej metodzie:', altErr.message)
      safeCallback(altErr, null)
    }
  }
}

module.exports = {
  config,
  setFPS,
  scanPairingCode,
  scanMainQR,
  scanPDF417,
  scanPhotoCard,
  takeFacephoto,
  cancel,
  isOpened,
  scanPK: scanPairingCode,
  hasCamera,
  takeFacePhotoTC,
  delayedFacephoto,
  delayedPhoto,
  diagnosticPhotos,
  getDelayMS,
}
