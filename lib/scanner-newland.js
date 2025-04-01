const _ = require('lodash/fp')
const { utils: coinUtils } = require('@lamassu/coins')
const fs = require('fs')
const Pdf417Parser = require('./compliance/parsepdf417')
const { cameraExists, stream } = require('./capture/streamer/v4l2camera')
const { maxCamResolutions, minCamResolutions, maxCamResolutionQRCode, maxCamResolutionPhotoId } = require('./capture/consts')
const sharp = require('sharp')
const supyo = require('@lamassu/supyo')

let barcodeScannerPath = null
let isRunning = false
let isCancelled = false
let configuration = null
let scannerStream = null
let currentScanPromise = null
const DEFAULT_DELAY_MS = 3000 // 3 seconds
let persistentScannerStream = null
let dataBuffer = ''
let currentCallback = null
let cancelInProgress = false

// Zmienne i stałe dla obsługi kamery
const DEFAULT_FPS = 10
const DEFAULT_DELAYEDSHOT_DELAY = 3
let current_fps = DEFAULT_FPS
let delayedshot_delay = DEFAULT_DELAYEDSHOT_DELAY
let activeStream = null

// Globalny lock dla operacji związanych z interakcją użytkownika
global.uiActionLock = global.uiActionLock || false;

/**
 * Cleans barcode data received from the Newland scanner
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
  
  console.log('[NEWLAND] Original data:', JSON.stringify(rawBarcode));
  
  // Convert to string if not a string
  let cleaned = String(rawBarcode);
  
  // Remove newline characters (CR, LF) from the entire string
  cleaned = cleaned.replace(/[\r\n]+/g, '');
  
  // Remove non-alphanumeric characters from the beginning (commas, spaces, etc.)
  // More aggressive cleaning - removes all non-alphanumeric characters from the beginning
  cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, '');
  
  // Remove whitespace from beginning and end
  cleaned = cleaned.trim();
  
  console.log('[NEWLAND] Cleaned data:', JSON.stringify(cleaned));
  
  return cleaned;
}

// Function to initialize continuous scanning
function initContinuousScanner() {
  if (persistentScannerStream) return true;
  
  console.log('[NEWLAND] Initializing continuous scanning');
  try {
    if (!fs.existsSync(barcodeScannerPath)) {
      console.log('[NEWLAND] ERROR: HID device does not exist:', barcodeScannerPath);
      return false;
    }
    
    persistentScannerStream = fs.createReadStream(barcodeScannerPath);
    
    persistentScannerStream.on('error', (err) => {
      console.log('[NEWLAND] Scanner stream error:', err.message);
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
        console.log('[NEWLAND] Barcode read:', barcode);
        
        // Clear buffer for future data
        dataBuffer = '';
        
        // If we have an active callback, pass the code
        if (currentCallback) {
          const callback = currentCallback;
          currentCallback = null;
          callback(null, barcode);
        } else {
          console.log('[NEWLAND] Code scanned, but no active listener');
        }
      }
    });
    
    console.log('[NEWLAND] Continuous scanning initialized successfully');
    return true;
  } catch (error) {
    console.log('[NEWLAND] Error initializing continuous scanning:', error.message);
    return false;
  }
}

// Funkcje pomocnicze do obsługi kamery
const mode2conf = mode =>
  mode === 'facephoto' ? 'frontFacingCamera' : 'scanner'

const getCameraDevice = mode => {
  const configPath = mode2conf(mode);
  const config = _.get(configPath, configuration);
  
  if (!config) {
    console.log(`[NEWLAND] No configuration found for mode: ${mode}, path: ${configPath}`);
    return null;
  }
  
  // Dla trybu 'qr' może być specjalna konfiguracja
  if (mode === 'qr' && config && config.qrDevice) {
    console.log(`[NEWLAND] Using qrDevice for mode: ${mode}: ${config.qrDevice}`);
    return config.qrDevice;
  }

  const devicePath = _.get('device', config);
  console.log(`[NEWLAND] Device for mode: ${mode}: ${devicePath}`);
  return devicePath;
}

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

// Zmodyfikowana funkcja config do obsługi obu urządzeń
function config(_configuration) {
  console.log('[NEWLAND] Configuring Newland scanner and cameras');
  configuration = _configuration;
  
  // Konfiguracja skanera Newland
  barcodeScannerPath = _.get(`scanner.device`, _configuration, '/dev/hidraw1');
  console.log('[NEWLAND] Scanner device path:', barcodeScannerPath);
  
  // Sprawdź i zaloguj konfigurację kamery przedniej
  const frontFacingCameraConfig = _.get('frontFacingCamera', _configuration);
  if (frontFacingCameraConfig) {
    console.log('[NEWLAND] Front facing camera configuration found:', JSON.stringify(frontFacingCameraConfig));
    const frontCameraDevice = _.get('device', frontFacingCameraConfig);
    if (frontCameraDevice) {
      console.log('[NEWLAND] Front facing camera device:', frontCameraDevice);
    } else {
      console.log('[NEWLAND] WARNING: Front facing camera configured but no device specified');
    }
  } else {
    console.log('[NEWLAND] No front facing camera configuration found');
  }
  
  // Konfiguracja kamery
  const getConfDelay = camera => _.defaultTo(DEFAULT_DELAYEDSHOT_DELAY, _.get([camera, 'diagnosticDelay'], configuration));
  delayedshot_delay = Math.max(getConfDelay('scanner'), getConfDelay('frontFacingCamera'));
  
  // Initialize continuous scanning
  initContinuousScanner();
}

// New implementation of getBarcode without timeout
function getBarcode() {
  if (isRunning) {
    console.log('[NEWLAND] Scanning already in progress');
    return currentScanPromise;
  }

  console.log('[NEWLAND] Waiting for code scan');
  isRunning = true;
  isCancelled = false;

  // Make sure scanner is initialized
  if (!persistentScannerStream && !initContinuousScanner()) {
    isRunning = false;
    return Promise.reject(new Error('Cannot initialize scanner'));
  }

  currentScanPromise = new Promise((resolve, reject) => {
    // Callback function for scanner
    currentCallback = (err, barcode) => {
      isRunning = false;
      
      if (isCancelled) {
        console.log('[NEWLAND] Scanning cancelled');
        return resolve(null);
      }
      
      if (err) {
        console.log('[NEWLAND] Scanning error:', err.message);
        return reject(err);
      }
      
      resolve(barcode);
    };
  });

  return currentScanPromise;
}

// Zmodyfikowana funkcja cancel do obsługi zarówno kamery jak i skanera
function cancel() {
  // Jeśli globalny lock jest aktywny, ignorujemy wszystkie żądania
  if (global.uiActionLock) {
    console.log('[NEWLAND] UI action lock active, ignoring cancel request');
    return Promise.resolve(false);
  }
  
  // Aktywujemy globalny lock
  global.uiActionLock = true;
  
  // Anuluj operację skanera
  console.log('[NEWLAND] Cancelling scan');
  isCancelled = true;
  
  if (currentCallback) {
    const callback = currentCallback;
    currentCallback = null;
    callback(null, null);
  }
  
  isRunning = false;
  
  // Anuluj operację kamery
  if (activeStream) {
    console.log('[NEWLAND] Cancelling camera stream');
    activeStream.destroy();
    activeStream = null;
  }
  
  // Zachowujemy lock aktywny przez 1 sekundę
  setTimeout(() => {
    global.uiActionLock = false;
    console.log('[NEWLAND] UI action lock released');
  }, 1000);
  
  return Promise.resolve(true);
}

// Check if scanner or camera is open
function isOpened() {
  return isRunning || !!activeStream;
}

function getDelayMS() {
  return delayedshot_delay * 1000;
}

// Funkcja capture dla obsługi kamery
const capture = (device, { mode }, returnCallback, stillsCallback, process) => {
  if (!!activeStream) {
    console.log('[NEWLAND] Camera is already open. Shouldn\'t happen.');
    return returnCallback(new Error('Camera open'));
  }

  const externallyClosedHandler = () => {
    returnCallback(null, null);
  }

  const cleanup = () => {
    activeStream.removeListener('close', externallyClosedHandler);
    activeStream.destroy();
    activeStream = null;
  }

  try {
    let processing = false;
    let lastStillTime = 0;

    activeStream = stream(device, {
      fps: current_fps,
      pickFormat: pickFormat(mode)
    });

    // Handle camera being closed by another process
    activeStream.on('close', externallyClosedHandler);

    activeStream.on('data', async ({ frame, width, height }) => {
      if (processing) return;
      processing = true;
      const result = await process({ frame, width, height }).catch(err => {
        cleanup();
        returnCallback(err, null);
      });
      if (result) {
        cleanup();
        returnCallback(null, result);
      } else {
        const now = Date.now();
        if (now - lastStillTime > 1000) {
          lastStillTime = now;
          stillsCallback(frame);
        }
      }

      processing = false;
    });
  } catch (err) {
    returnCallback(err, null);
  }
}

// Function to scan QR
function scanQR(callback) {
  console.log('[NEWLAND] Starting QR scan')
  
  getBarcode()
    .then((barcode) => {
      callback(null, barcode)
    })
    .catch((error) => {
      callback(error)
    })
}

// Function to scan main QR with cryptocurrency address
function scanMainQR(cryptoCode, shouldSaveAttempt, callback) {
  console.log('[NEWLAND] Starting main QR scan for:', cryptoCode)
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[NEWLAND] Empty response from device')
        return callback(null, null)
      }
      
      try {
        const network = 'main'
        console.log('[NEWLAND] Parsing URL:', barcode)
        const result = coinUtils.parseUrl(cryptoCode, network, barcode)
        callback(null, result)
      } catch (error) {
        console.log('[NEWLAND] Address parsing error:', error.message)
        callback(new Error('Invalid address'))
      }
    })
    .catch((error) => {
      callback(error)
    })
}

// Function to scan PDF417
function scanPDF417(callback, stillsCallback) {
  console.log('[NEWLAND] Starting PDF417 scan')
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[NEWLAND] Empty response from device')
        return callback(null, null)
      }
      
      try {
        console.log('[NEWLAND] Parsing PDF417')
        const parsed = Pdf417Parser.parse(barcode)
        if (!parsed) {
          console.log('[NEWLAND] Failed to parse PDF417')
          return callback(null, null)
        }
        parsed.raw = barcode
        console.log('[NEWLAND] PDF417 parsed successfully')
        callback(null, parsed)
      } catch (error) {
        console.log('[NEWLAND] PDF417 parsing error:', error.message)
        callback(error)
      }
    })
    .catch((error) => {
      callback(error)
    })
}

// Function to scan private key
function scanPK(callback) {
  console.log('[NEWLAND] Starting private key scan')
  
  getBarcode()
    .then((barcode) => {
      if (!barcode) {
        console.log('[NEWLAND] Empty response from device')
        return callback(null, null)
      }
      
      callback(null, barcode)
    })
    .catch((error) => {
      callback(error)
    })
}

// Sprawdzenie czy urządzenie ma dostęp do kamery
function hasCamera(mode) {
  console.log(`[NEWLAND] Checking camera for mode: ${mode}`);
  const device = getCameraDevice(mode);
  if (!device) {
    console.log(`[NEWLAND] No camera device configured for mode: ${mode}`);
    return Promise.resolve(false);
  }
  
  return Promise.resolve(cameraExists(device))
    .then(exists => {
      console.log(`[NEWLAND] Camera exists for mode ${mode}, device ${device}: ${exists}`);
      return exists;
    })
    .catch(err => {
      console.log(`[NEWLAND] Error checking camera for mode ${mode}: ${err.message}`);
      return false;
    });
}

// Funkcja wykonująca zdjęcia z opóźnieniem
const delayedPhoto = (device, config, callback) => {
  if (!device) {
    console.log('[NEWLAND] No camera device specified for delayed photo');
    return callback(new Error('No camera device specified'), null);
  }
  
  const timerInit = new Date().getTime();
  capture(device, config, callback, _.noop, async ({ frame, width, height }) => {
    if (timerInit > new Date().getTime() - getDelayMS()) return null;
    return frame;
  });
}

// Funkcja wykonująca zdjęcie twarzy
const delayedFacephoto = (callback) => {
  console.log('[NEWLAND] Attempting delayed facephoto capture');
  const mode = 'facephoto';
  const device = getCameraDevice(mode);
  
  if (!device) {
    console.log('[NEWLAND] No camera device configured for facephoto');
    return callback(new Error('No camera device configured for facephoto'), null);
  }
  
  console.log(`[NEWLAND] Using device for facephoto: ${device}`);
  delayedPhoto(device, { mode }, (err, result) => {
    if (err) {
      console.log(`[NEWLAND] Error in facephoto: ${err.message}`);
      return callback(err, null);
    }
    
    if (!result) {
      console.log('[NEWLAND] No result from facephoto');
      return callback(null, null);
    }
    
    console.log('[NEWLAND] Facephoto captured successfully');
    callback(null, result);
  });
}

// Funkcja do skanowania dokumentu tożsamości
function scanPhotoCard(callback) {
  console.log('[NEWLAND] Attempting to scan photo card');
  const mode = 'photoId';
  const device = getCameraDevice(mode);
  
  if (!device) {
    console.log('[NEWLAND] No camera device configured for photoId');
    return callback(new Error('No camera device configured for photoId'), null);
  }
  
  console.log(`[NEWLAND] Using device for photoId: ${device}`);
  capture(device, { mode }, callback, _.noop, async ({ frame, width, height }) => {
    try {
      console.log('[NEWLAND] Processing photo card image');
      const bwFrame = await sharp(frame).greyscale().raw().toBuffer();
      const detected = supyo.detect(bwFrame, width, height, {
        minSize: 100,
        qualityThreshold: 20,
        verbose: false
      });

      if (!detected) {
        console.log('[NEWLAND] No ID card detected in image');
        return null;
      }
      
      console.log('[NEWLAND] ID card detected in image');
      return frame;
    } catch (err) {
      console.log(`[NEWLAND] Error processing photo card: ${err.message}`);
      return null;
    }
  });
}

// Funkcja do wykonywania zdjęć diagnostycznych
function diagnosticPhotos() {
  return new Promise((resolve, reject) => {
    const response = {
      scan: null,
      front: null
    };
    
    // Sprawdź czy urządzenia są skonfigurowane
    const scanDevice = getCameraDevice('scanner');
    const frontDevice = getCameraDevice('facephoto');
    
    if (!scanDevice && !frontDevice) {
      console.log('[NEWLAND] No camera devices configured for diagnostic photos');
      return resolve(response);
    }
    
    // Zrób zdjęcie ze skanera, jeśli jest dostępny
    if (scanDevice) {
      delayedPhoto(scanDevice, { mode: 'scanner' }, (err, scan) => {
        if (scan) response.scan = scan;
        
        // Zrób zdjęcie z kamery przedniej, jeśli jest dostępna
        if (frontDevice) {
          delayedPhoto(frontDevice, { mode: 'facephoto' }, (err, front) => {
            if (front) response.front = front;
            resolve(response);
          });
        } else {
          resolve(response);
        }
      });
    } else if (frontDevice) {
      // Jeśli jest tylko kamera przednia
      delayedPhoto(frontDevice, { mode: 'facephoto' }, (err, front) => {
        if (front) response.front = front;
        resolve(response);
      });
    } else {
      resolve(response);
    }
  });
}

function scanPairingCode(callback) {
  console.log('[NEWLAND] Using hardcoded test token for pairing')
  
  
  const testToken = '8AE2G*TL0:+X:1PX4*I/M%AWK$XZCEZ%E:E*IMBGY*6NBTFJYHL7Q%%EE3MUEFORQ*F46H2W$6UQ/OE.L2QMO9.25YSC QGKVPXE/7IETI8KRLG.D:';
  
  console.log('[NEWLAND] Test token:', testToken);
  callback(null, testToken);
}



module.exports = {
  config,
  setFPS,
  getDelayMS,
  cancel,
  isOpened,
  hasCamera,
  
  // Skanowanie kodów
  scanQR,
  scanMainQR,
  scanPDF417,
  scanPK,
  scanPairingCode,
  
  // Funkcje związane z kamerą
  scanPhotoCard,
  delayedFacephoto,
  diagnosticPhotos,
  
  // Dodatkowe funkcje
  getBarcode
}