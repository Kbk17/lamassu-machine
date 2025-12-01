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
const NETWORK = 'main'

let configuration = null
let current_fps = DEFAULT_FPS
let delayedshot_delay = DEFAULT_DELAYEDSHOT_DELAY

let activeStream = null

// Variables for HID scanner
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
 * - Removes control characters (STX, ETX, NUL, etc.)
 * - Removes non-alphanumeric characters from the beginning
 * - Removes whitespace from beginning and end
 * - Removes newline characters (CR, LF)
 * 
 * @param {string} rawBarcode - Raw data from scanner
 * @returns {string} Cleaned barcode
 */
function cleanBarcode(rawBarcode) {
  if (!rawBarcode) return '';
  
  // Don't log data for security reasons (pairing code)
  // console.log('[SCANNER] Original data:', JSON.stringify(rawBarcode));
  
  // Convert to string if not a string
  let cleaned = String(rawBarcode);
  
  // Remove all control characters (including STX, ETX, null bytes, etc.)
  cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  
  // Remove newline characters (CR, LF) from the entire string
  cleaned = cleaned.replace(/[\r\n]+/g, '');
  
  // Remove non-alphanumeric characters from the beginning 
  cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, '');
  
  // For Ethereum addresses, ensure proper format
  if (cleaned.includes('ethereum:')) {
    const ethRegex = /(ethereum:)(0x[a-fA-F0-9]{40})/;
    const match = cleaned.match(ethRegex);
    if (match) {
      cleaned = match[1] + match[2]; // Only protocol + address
    }
  }
  
  // Remove whitespace from beginning and end
  cleaned = cleaned.trim();
  
  // Escape special characters for SQL logs
  cleaned = cleaned.replace(/'/g, "''").replace(/"/g, '\\"');
  
  // Don't log data for security reasons (pairing code)
  // console.log('[SCANNER] Cleaned data:', JSON.stringify(cleaned));
  
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
    
    // Check if the configured device path exists
    try {
      if (!fs.existsSync(barcodeScannerPath)) {
        console.log('[SCANNER] ERROR: HID device does not exist:', barcodeScannerPath);
        console.log('[SCANNER] Make sure the device is connected and the path is correctly configured');
        
        // Try to find other HID devices
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
    
    // Try to open the device
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
        // Don't log code for security reasons (pairing code)
        console.log('[SCANNER] Barcode read successfully');
        
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
  
  // HID scanner configuration
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
      
      // Additional data verification
      if (barcode) {
        // Sanitize data before returning
        const sanitized = barcode.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        resolve(sanitized);
      } else {
        console.log('[SCANNER] Empty barcode received');
        resolve(null);
      }
    };
  });

  return currentScanPromise;
}

// Update cancel function to handle HID scanner as well
const cancel = () => {
  // Cancel camera
  if (activeStream) {
    activeStream.destroy();
    activeStream = null;
  }
  
  // Cancel HID scanner
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

// Check if scanner or camera are open
const isOpened = () => !!activeStream || isRunning;

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

// Function for scanning PDF417 - always uses HID scanner
const scanPDF417 = (resultCallback, idCardStillsCallback) => {
  console.log('[SCANNER] Starting PDF417 scan using HID scanner');
  
  // Check if device is configured
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

// Function for scanning QR - always uses HID scanner
const scanQR = (resultCallback) => {
  console.log('[SCANNER] Starting QR scan using HID scanner');
  
  // Check if device is configured
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
}

// Function for scanning main QR - always uses HID scanner
const scanMainQR = (cryptoCode, qrStillsCallback, resultCallback) => {
  console.log('[SCANNER] Starting main QR scan for:', cryptoCode, 'using HID scanner');
  
  // Check if device is configured
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
      
      // Additional handling for Ethereum addresses
      let processedBarcode = barcode;
      if (cryptoCode.toLowerCase() === 'eth' && barcode.includes('ethereum:')) {
        const ethRegex = /(ethereum:)(0x[a-fA-F0-9]{40})/;
        const match = barcode.match(ethRegex);
        if (match) {
          processedBarcode = match[1] + match[2];
          console.log('[SCANNER] Normalized Ethereum address:', processedBarcode);
        }
      }
      
      try {
        const network = 'main';
        console.log('[SCANNER] Parsing URL:', processedBarcode);
        const result = coinUtils.parseUrl(cryptoCode, network, processedBarcode);
        console.log('[SCANNER] Successfully parsed address for:', cryptoCode);
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

// Function for scanning private key - uses HID scanner
const scanPK = (callback) => {
  console.log('[SCANNER] Starting private key scan');
  
  // Check if device is configured
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
  scanPK,
  scanPhotoCard,
  delayedFacephoto,
  diagnosticPhotos,
  
  // Additional functions
  getBarcode
}
