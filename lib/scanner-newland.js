const _ = require('lodash/fp')
const { utils: coinUtils } = require('@lamassu/coins')
const fs = require('fs')
const Pdf417Parser = require('./compliance/parsepdf417')

let barcodeScannerPath = null
let isRunning = false
let isCancelled = false
let configuration = null
let currentScanPromise = null
const DEFAULT_DELAY_MS = 3000 // 3 seconds
let persistentScannerStream = null
let dataBuffer = ''
let currentCallback = null

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

// Modify the config function to initialize continuous scanning
function config (_configuration) {
  console.log('[NEWLAND] Configuring Newland scanner');
  console.log('[NEWLAND] Configuration:', JSON.stringify(_configuration.scanner || {}));
  configuration = _configuration;
  barcodeScannerPath = _.get(`scanner.device`, _configuration, '/dev/hidraw1');
  console.log('[NEWLAND] Device path:', barcodeScannerPath);
  
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

// Modify cancel function to cancel current wait
function cancel() {
  console.log('[NEWLAND] Cancelling scan');
  isCancelled = true;
  
  if (currentCallback) {
    const callback = currentCallback;
    currentCallback = null;
    callback(null, null);
  }
  
  isRunning = false;
  return Promise.resolve(true);
}

// Check if scanner is open
function isOpened() {
  return isRunning
}

function getDelayMS() {
  return DEFAULT_DELAY_MS
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

// Functions related to camera - use the new usb-camera module for camera functions
function scanPhotoCard(callback) {
  console.log('[NEWLAND] Newland scanner delegating scanPhotoCard to USB camera')
  
  try {
    // Use the dedicated USB camera module
    const usbCamera = require('./usb-camera')
    
    // Pass existing configuration to camera handler if not already configured
    if (configuration) {
      usbCamera.initialize(configuration)
    }
    
    // Let the USB camera handle the photo capture
    usbCamera.delayedPhoto(callback)
  } catch (error) {
    console.log('[NEWLAND] Error using USB camera for scanPhotoCard:', error.message)
    callback(error, null)
  }
}

function hasCamera(type) {
  console.log('[NEWLAND] Checking camera availability for type:', type)
  
  try {
    // Use the dedicated USB camera module
    const usbCamera = require('./usb-camera')
    return usbCamera.hasCamera(type)
  } catch (error) {
    console.log('[NEWLAND] Error checking camera availability:', error.message)
    return Promise.resolve(false)
  }
}

function delayedFacephoto(callback) {
  console.log('[NEWLAND] Newland scanner delegating delayedFacephoto to USB camera')
  
  try {
    // Use the dedicated USB camera module
    const usbCamera = require('./usb-camera')
    
    // Pass existing configuration to camera if not already configured
    if (configuration) {
      usbCamera.initialize(configuration)
    }
    
    // Let the USB camera handle the photo capture
    usbCamera.delayedFacephoto(callback)
  } catch (error) {
    console.log('[NEWLAND] Error using USB camera for delayedFacephoto:', error.message)
    callback(error, null)
  }
}

function takeFacePhoto(callback) {
  console.log('[NEWLAND] Newland scanner delegating takeFacePhoto to USB camera')
  
  try {
    // Use the dedicated USB camera module
    const usbCamera = require('./usb-camera')
    
    // Pass existing configuration to camera if not already configured
    if (configuration) {
      usbCamera.initialize(configuration)
    }
    
    // Let the USB camera handle the photo capture
    usbCamera.takeFacePhoto(callback)
  } catch (error) {
    console.log('[NEWLAND] Error using USB camera for takeFacePhoto:', error.message)
    callback(error, null)
  }
}

function takeFacePhotoTC(callback) {
  console.log('[NEWLAND] Delegating face photo TC to usb-camera module')
  
  try {
    // Use dedicated usb-camera module
    const usbCamera = require('./usb-camera')
    
    // Make sure module is initialized with configuration
    if (configuration) {
      usbCamera.initialize(configuration)
    }
    
    // Call function from usb-camera module
    usbCamera.takeFacePhotoTC(callback)
  } catch (error) {
    console.log('[NEWLAND] Error when using usb-camera for takeFacePhotoTC:', error.message)
    callback(error, null)
  }
}

function diagnosticPhotos() {
  console.log('[NEWLAND] Newland scanner delegating diagnosticPhotos to USB camera')
  
  try {
    // Use the dedicated USB camera module
    const usbCamera = require('./usb-camera')
    
    // Return promise from USB camera
    return usbCamera.diagnosticPhotos()
  } catch (error) {
    console.log('[NEWLAND] Error using USB camera for diagnostics:', error.message)
    return Promise.resolve({ scan: null, front: null })
  }
}

module.exports = {
  config,
  scanQR,
  scanMainQR,
  scanPDF417,
  scanPhotoCard,
  scanPK,
  cancel,
  isOpened,
  getDelayMS,
  hasCamera,
  delayedFacephoto,
  takeFacephoto: takeFacePhoto,
  takeFacePhotoTC,
  diagnosticPhotos,
  getBarcode
}