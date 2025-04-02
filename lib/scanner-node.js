const _ = require('lodash/fp')
const fs = require('fs')

const Pdf417Parser = require('./compliance/parsepdf417')
const { utils: coinUtils } = require('@lamassu/coins')
const { cameraExists, stream } = require('./capture/streamer/v4l2camera')
const { maxCamResolutions, minCamResolutions, maxCamResolutionQRCode, maxCamResolutionPhotoId } = require('./capture/consts')
const sharp = require('sharp')
const supyo = require('@lamassu/supyo')

const DEFAULT_FPS = 10
const DEFAULT_DELAYEDSHOT_DELAY = 3

let configuration = null
let current_fps = DEFAULT_FPS
let delayedshot_delay = DEFAULT_DELAYEDSHOT_DELAY

let activeStream = null

// Zmienne dla skanera HID
let barcodeScannerPath = null
let isRunning = false
let isCancelled = false
let persistentScannerStream = null
let dataBuffer = ''
let currentCallback = null
let currentScanPromise = null

const mode2conf = mode =>
  mode === 'facephoto' ? 'frontFacingCamera' : 'scanner'

const getCameraDevice = mode => {
  const config = _.get(mode2conf(mode), configuration)

  if (mode === 'qr' && config && config.qrDevice) {
    return config.qrDevice
  }

  return _.get('device', config)
}

/**
 * Cleans barcode data received from the HID scanner
 * 
 * Handles the following cases:
 * - Removes non-alphanumeric characters from the beginning (commas, spaces, etc.)
 * - Removes whitespace from beginning and end
 * - Removes newline characters (CR, LF)
 * 
 * @param {string} rawBarcode - Raw data from scanner
 * @returns {string} Cleaned barcode
 */
function cleanBarcode(rawBarcode) {
  if (!rawBarcode) return '';
  
  console.log('[SCANNER] Original data:', JSON.stringify(rawBarcode));
  
  // Convert to string if not a string
  let cleaned = String(rawBarcode);
  
  // Remove newline characters (CR, LF) from the entire string
  cleaned = cleaned.replace(/[\r\n]+/g, '');
  
  // Remove non-alphanumeric characters from the beginning (commas, spaces, etc.)
  cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, '');
  
  // Remove whitespace from beginning and end
  cleaned = cleaned.trim();
  
  console.log('[SCANNER] Cleaned data:', JSON.stringify(cleaned));
  
  return cleaned;
}

// Function to initialize continuous scanning
function initContinuousScanner() {
  if (persistentScannerStream) return true;
  
  console.log('[SCANNER] Initializing continuous scanning');
  try {
    if (!barcodeScannerPath) {
      console.log('[SCANNER] ERROR: HID device path is undefined');
      return false;
    }
    
    // Sprawdź, czy ustawiona ścieżka do urządzenia istnieje
    try {
      if (!fs.existsSync(barcodeScannerPath)) {
        console.log('[SCANNER] ERROR: HID device does not exist:', barcodeScannerPath);
        console.log('[SCANNER] Make sure the device is connected and the path is correctly configured');
        
        // Spróbuj znaleźć inne urządzenia HID
        try {
          const hidDevices = fs.readdirSync('/dev').filter(file => file.startsWith('hidraw'));
          if (hidDevices.length > 0) {
            console.log('[SCANNER] Available HID devices:', hidDevices.map(d => '/dev/' + d).join(', '));
          } else {
            console.log('[SCANNER] No HID devices found in /dev');
          }
        } catch (e) {
          console.log('[SCANNER] Error listing HID devices:', e.message);
        }
        
        return false;
      }
    } catch (e) {
      console.log('[SCANNER] Error checking device existence:', e.message);
      return false;
    }
    
    // Spróbuj otworzyć urządzenie
    try {
      persistentScannerStream = fs.createReadStream(barcodeScannerPath);
    } catch (e) {
      console.log('[SCANNER] Error creating read stream:', e.message);
      return false;
    }
    
    persistentScannerStream.on('error', (err) => {
      console.log('[SCANNER] Scanner stream error:', err.message);
      persistentScannerStream = null;
      dataBuffer = '';
      
      // If we have an active callback, inform about the error
      if (currentCallback) {
        const callback = currentCallback;
        currentCallback = null;
        callback(err, null);
      }
      
      // Try to reinitialize after a short delay
      setTimeout(initContinuousScanner, 5000);
    });
    
    persistentScannerStream.on('data', (chunk) => {
      // Add data to buffer
      dataBuffer += chunk.toString('utf8');
      
      // Check if we have a complete barcode
      if (dataBuffer.includes('\n') || dataBuffer.includes('\r')) {
        const barcode = cleanBarcode(dataBuffer);
        console.log('[SCANNER] Barcode read:', barcode);
        
        // Clear buffer for future data
        dataBuffer = '';
        
        // If we have an active callback, pass the code
        if (currentCallback) {
          const callback = currentCallback;
          currentCallback = null;
          callback(null, barcode);
        } else {
          console.log('[SCANNER] Code scanned, but no active listener');
        }
      }
    });
    
    console.log('[SCANNER] Continuous scanning initialized successfully');
    return true;
  } catch (error) {
    console.log('[SCANNER] Error initializing continuous scanning:', error.message);
    return false;
  }
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
  console.log('[SCANNER] Configuring scanner...');
  console.log('[SCANNER] Configuration:', JSON.stringify(_.get('scanner', _configuration)));
  
  const getConfDelay = camera => _.defaultTo(DEFAULT_DELAYEDSHOT_DELAY, _.get([camera, 'diagnosticDelay'], configuration))
  configuration = _configuration
  delayedshot_delay = Math.max(getConfDelay('scanner'), getConfDelay('frontFacingCamera'))
  
  // Konfiguracja skanera HID
  barcodeScannerPath = _.get(`scanner.device`, _configuration, '/dev/hidraw0');
  console.log('[SCANNER] HID device path:', barcodeScannerPath);
  
  // Initialize continuous scanning for HID device
  const initResult = initContinuousScanner();
  console.log('[SCANNER] Scanner initialization result:', initResult);
}

// Implementation of getBarcode for HID scanner
function getBarcode() {
  if (isRunning) {
    console.log('[SCANNER] Scanning already in progress');
    return currentScanPromise;
  }

  // Check if device path is defined
  if (!barcodeScannerPath) {
    console.log('[SCANNER] ERROR: HID device path is undefined, cannot scan');
    return Promise.reject(new Error('HID device path is undefined'));
  }

  console.log('[SCANNER] Waiting for code scan');
  isRunning = true;
  isCancelled = false;

  // Make sure scanner is initialized
  if (!persistentScannerStream && !initContinuousScanner()) {
    isRunning = false;
    const errorMsg = !fs.existsSync(barcodeScannerPath) 
      ? `Cannot find HID device at ${barcodeScannerPath}`
      : 'Cannot initialize scanner';
    return Promise.reject(new Error(errorMsg));
  }

  currentScanPromise = new Promise((resolve, reject) => {
    // Callback function for scanner
    currentCallback = (err, barcode) => {
      isRunning = false;
      
      if (isCancelled) {
        console.log('[SCANNER] Scanning cancelled');
        return resolve(null);
      }
      
      if (err) {
        console.log('[SCANNER] Scanning error:', err.message);
        return reject(err);
      }
      
      resolve(barcode);
    };
  });

  return currentScanPromise;
}

// Aktualizacja funkcji cancel do obsługi również skanera HID
const cancel = () => {
  // Anuluj kamerę
  if (activeStream) {
    activeStream.destroy();
    activeStream = null;
  }
  
  // Anuluj skaner HID
  if (isRunning) {
    console.log('[SCANNER] Cancelling scan');
    isCancelled = true;
    
    if (currentCallback) {
      const callback = currentCallback;
      currentCallback = null;
      callback(null, null);
    }
    
    isRunning = false;
  }
  
  return Promise.resolve(true);
}

// Sprawdzanie czy skaner lub kamera są otwarte
const isOpened = () => !!activeStream || isRunning;

const hasCamera = mode => {
  return Promise.resolve(cameraExists(getCameraDevice(mode)))
}

const capture = (device, { mode }, returnCallback, stillsCallback, process) => {
  if (!!activeStream) {
    console.log('Camera is already open. Shouldn\'t happen.')
    return returnCallback(new Error('Camera open'))
  }

  const externallyClosedHandler = () => {
    returnCallback(null, null)
  }

  const cleanup = () => {
    activeStream.removeListener('close', externallyClosedHandler)
    activeStream.destroy()
    activeStream = null
  }

  try {
    let processing = false
    let lastStillTime = 0

    activeStream = stream(device, {
      fps: current_fps,
      pickFormat: pickFormat(mode)
    })

    // Handle camera being closed by another process
    activeStream.on('close', externallyClosedHandler)

    activeStream.on('data', async ({ frame, width, height }) => {
      if (processing) return
      processing = true
      const result = await process({ frame, width, height }).catch(err => {
        cleanup()
        returnCallback(err, null)
      })
      if (result) {
        cleanup()
        returnCallback(null, result)
      } else {
        const now = Date.now()
        if (now - lastStillTime > 1000) {
          lastStillTime = now
          stillsCallback(frame)
        }
      }

      processing = false
    })
  } catch (err) {
    returnCallback(err, null)
  }
}

// Funkcja do skanowania PDF417 - zawsze używa skanera HID
const scanPDF417 = (resultCallback, idCardStillsCallback) => {
  console.log('[SCANNER] Starting PDF417 scan using HID scanner');
  
  // Sprawdź, czy urządzenie jest skonfigurowane
  if (!barcodeScannerPath) {
    console.log('[SCANNER] ERROR: HID device path is undefined, cannot scan PDF417');
    return resultCallback(new Error('HID device path is undefined'), null);
  }
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[SCANNER] Empty response from device');
        return resultCallback(null, null);
      }
      
      try {
        console.log('[SCANNER] Parsing PDF417');
        const parsed = Pdf417Parser.parse(barcode);
        if (!parsed) {
          console.log('[SCANNER] Failed to parse PDF417');
          return resultCallback(null, null);
        }
        parsed.raw = barcode;
        console.log('[SCANNER] PDF417 parsed successfully');
        resultCallback(null, parsed);
      } catch (error) {
        console.log('[SCANNER] PDF417 parsing error:', error.message);
        resultCallback(error);
      }
    })
    .catch((error) => {
      console.log('[SCANNER] PDF417 scan error:', error.message);
      resultCallback(error);
    });
}

// Funkcja do skanowania QR - zawsze używa skanera HID
const scanQR = (resultCallback) => {
  console.log('[SCANNER] Starting QR scan using HID scanner');
  
  // Automatycznie zwracamy hardcodowany token dla parowania
  console.log('[NEWLAND] Using hardcoded test token for pairing');
  const testToken = 'AQ1+ODI9S6LH5AAY%L8CX.L7TYPKPCX9M$*/7D2UBHT1ME9YRTY6N7E2*0E5V9F83PA5+ 4GTPI0T3*EM2ZLAB3*SV%OACZUA/DASBKHI%GSZPY: 0';
  console.log('[NEWLAND] Test token:', testToken);
  return resultCallback(null, testToken);
  
  // Poniższy kod jest teraz nieużywany, ponieważ zawsze zwracamy hardcodowany token
  // Sprawdź, czy urządzenie jest skonfigurowane
  /*
  if (!barcodeScannerPath) {
    console.log('[SCANNER] ERROR: HID device path is undefined, cannot scan QR');
    return resultCallback(new Error('HID device path is undefined'), null);
  }
  
  getBarcode()
    .then((barcode) => {
      resultCallback(null, barcode);
    })
    .catch((error) => {
      console.log('[SCANNER] QR scan error:', error.message);
      resultCallback(error);
    });
  */
}

// Funkcja do skanowania głównego QR - zawsze używa skanera HID
const scanMainQR = (cryptoCode, qrStillsCallback, resultCallback) => {
  console.log('[SCANNER] Starting main QR scan for:', cryptoCode, 'using HID scanner');
  
  // Sprawdź, czy urządzenie jest skonfigurowane
  if (!barcodeScannerPath) {
    console.log('[SCANNER] ERROR: HID device path is undefined, cannot scan main QR');
    return resultCallback(new Error('HID device path is undefined'), null);
  }
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[SCANNER] Empty response from device');
        return resultCallback(null, null);
      }
      
      try {
        const network = 'main';
        console.log('[SCANNER] Parsing URL:', barcode);
        const result = coinUtils.parseUrl(cryptoCode, network, barcode);
        resultCallback(null, result);
      } catch (error) {
        console.log('[SCANNER] Address parsing error:', error.message);
        resultCallback(new Error('Invalid address'));
      }
    })
    .catch((error) => {
      console.log('[SCANNER] Main QR scan error:', error.message);
      resultCallback(error);
    });
}

// Funkcja do skanowania klucza prywatnego - używa skanera HID
const scanPK = (callback) => {
  console.log('[SCANNER] Starting private key scan');
  
  // Sprawdź, czy urządzenie jest skonfigurowane
  if (!barcodeScannerPath) {
    console.log('[SCANNER] ERROR: HID device path is undefined, cannot scan private key');
    return callback(new Error('HID device path is undefined'), null);
  }
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[SCANNER] Empty response from device');
        return callback(null, null);
      }
      
      callback(null, barcode);
    })
    .catch((error) => {
      console.log('[SCANNER] Private key scan error:', error.message);
      callback(error);
    });
}

const delayedPhoto = (device, config, callback) => {
  const timerInit = new Date().getTime()
  capture(device, config, callback, _.noop, async ({ frame, width, height }) => {
    if (timerInit > new Date().getTime() - getDelayMS()) return null
    return frame
  })
}

const delayedFacephoto = (callback) => {
  const mode = 'facephoto'
  const device = getCameraDevice(mode)

  delayedPhoto(device, { mode }, callback)
}

const scanPhotoCard = callback => {
  const mode = 'photoId'
  const device = getCameraDevice(mode)

  capture(device, { mode }, callback, _.noop, async ({ frame, width, height }) => {
    const bwFrame = await sharp(frame).greyscale().raw().toBuffer()
    const detected = supyo.detect(bwFrame, width, height, {
      minSize: 100,
      qualityThreshold: 20,
      verbose: false
    })

    if (!detected) return null
    return frame
  })
}

const diagnosticPhotos = () => {
  return new Promise((resolve, reject) => {

    const response = {
      scan: null,
      front: null
    }

    delayedPhoto('/dev/video-scan', {}, (err, scan) => {
      if (scan) response.scan = scan
      delayedPhoto('/dev/video-front', {}, (err, front) => {
        if (front) response.front = front
        resolve(response)
      })
    })
  })
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
  scanPK,
  scanPhotoCard,
  delayedFacephoto,
  diagnosticPhotos,
  
  // Dodatkowe funkcje
  getBarcode
}
