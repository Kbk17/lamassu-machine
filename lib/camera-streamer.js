const fs = require('fs')
const { spawn } = require('child_process')

let devicePath = null
let isVerbose = false

/**
 * Set verbose mode for debugging
 * @param {boolean} verbose - Whether to enable verbose logging
 */
const setVerbose = (verbose) => {
  isVerbose = verbose
  console.log('[CAMERA-STREAMER] Verbose mode:', verbose ? 'ENABLED' : 'DISABLED')
}

/**
 * Set the camera device path
 * @param {string} path - Path to the camera device
 */
const setDevicePath = (path) => {
  console.log('[CAMERA-STREAMER] Setting device path from:', devicePath, 'to:', path)
  devicePath = path
  if (isVerbose) {
    console.log('[CAMERA-STREAMER] Device path set to:', devicePath)
  }
}

/**
 * Get the current camera device path
 * @returns {string} The camera device path
 */
const getDevicePath = () => {
  console.log('[CAMERA-STREAMER] Getting device path:', devicePath)
  return devicePath
}

/**
 * Check if the camera exists and is accessible
 * @param {string} device - Path to the camera device
 * @returns {Promise<boolean>} Promise resolving to true if camera exists
 */
const hasCamera = (device) => {
  console.log('[CAMERA-STREAMER] Checking if camera exists:', device)
  return new Promise((resolve) => {
    if (!device) {
      console.log('[CAMERA-STREAMER] No device specified')
      return resolve(false)
    }

    fs.access(device, fs.constants.R_OK, (err) => {
      if (err) {
        console.log('[CAMERA-STREAMER] Device not accessible:', device, 'Error:', err.message)
        return resolve(false)
      }
      
      console.log('[CAMERA-STREAMER] Device accessible:', device)
      resolve(true)
    })
  })
}

/**
 * Capture a frame from the camera
 * @param {Object} options - Capture options
 * @returns {Promise<Buffer>} Promise resolving to the captured frame
 */
const captureFrame = (options = {}) => {
  console.log('[CAMERA-STREAMER] Starting captureFrame with options:', JSON.stringify(options))
  return new Promise((resolve, reject) => {
    if (!devicePath) {
      console.log('[CAMERA-STREAMER] ERROR: No camera device path set')
      return reject(new Error('No camera device path set'))
    }

    // Use ffmpeg to capture a single frame
    const args = [
      '-f', 'video4linux2',
      '-i', devicePath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-'
    ]

    // Usunięto nieprawidłowy parametr -timeout
    // Zamiast tego użyjemy timeout na poziomie procesu

    if (options.resolution) {
      console.log('[CAMERA-STREAMER] Setting resolution:', options.resolution)
      args.splice(2, 0, '-s', options.resolution)
    }

    console.log('[CAMERA-STREAMER] Capturing frame with ffmpeg command:', 'ffmpeg', args.join(' '))

    try {
      const ffmpeg = spawn('ffmpeg', args)
      const chunks = []
      
      // Ustawiamy timeout dla całej operacji (10 sekund)
      console.log('[CAMERA-STREAMER] Setting operation timeout: 10 seconds')
      const timeoutId = setTimeout(() => {
        console.log('[CAMERA-STREAMER] Capture operation timed out after 10 seconds')
        
        // Próba zabicia procesu ffmpeg
        try {
          console.log('[CAMERA-STREAMER] Attempting to kill ffmpeg process')
          ffmpeg.kill('SIGKILL')
        } catch (e) {
          console.log('[CAMERA-STREAMER] Error killing ffmpeg process:', e.message)
        }
        
        reject(new Error('Capture operation timed out'))
      }, 10000)

      ffmpeg.stdout.on('data', (chunk) => {
        console.log('[CAMERA-STREAMER] Received chunk of data, size:', chunk.length)
        chunks.push(chunk)
      })

      ffmpeg.stderr.on('data', (data) => {
        const message = data.toString()
        console.log('[CAMERA-STREAMER] ffmpeg stderr:', message)
      })

      ffmpeg.on('close', (code) => {
        console.log('[CAMERA-STREAMER] ffmpeg process closed with code:', code)
        clearTimeout(timeoutId)
        
        if (code !== 0) {
          console.log('[CAMERA-STREAMER] ffmpeg exited with error code:', code)
          return reject(new Error(`ffmpeg exited with code ${code}`))
        }

        const buffer = Buffer.concat(chunks)
        console.log('[CAMERA-STREAMER] Successfully captured frame, size:', buffer.length)
        resolve(buffer)
      })

      ffmpeg.on('error', (err) => {
        console.log('[CAMERA-STREAMER] ffmpeg process error:', err.message)
        clearTimeout(timeoutId)
        reject(err)
      })
    } catch (error) {
      console.log('[CAMERA-STREAMER] Error spawning ffmpeg:', error.message)
      reject(error)
    }
  })
}

/**
 * Capture a frame from the camera with a delay
 * @param {string} device - Path to the camera device
 * @param {Object} format - Format options for the camera
 * @param {number} fps - Frames per second
 * @param {number} delay - Delay in seconds before capturing
 * @returns {Array} An array with null and a promise resolving to the captured frame
 */
const delayedshot = (device, format, fps, delay) => {
  console.log('[CAMERA-STREAMER] Starting delayedshot with device:', device, 'format:', JSON.stringify(format), 'fps:', fps, 'delay:', delay)
  
  // Save the original device path
  const originalDevice = devicePath
  console.log('[CAMERA-STREAMER] Original device path:', originalDevice)
  
  // If a specific device is provided, use it temporarily
  if (device && device !== devicePath) {
    console.log('[CAMERA-STREAMER] Temporarily switching to device:', device)
    setDevicePath(device)
  }
  
  // Check if we have a valid device path
  if (!devicePath) {
    console.log('[CAMERA-STREAMER] ERROR: No device path set for delayedshot')
    return [null, Promise.reject(new Error('No camera device path set'))]
  }
  
  console.log(`[CAMERA-STREAMER] Taking delayed photo with ${delay}s delay, from device: ${devicePath}`)
  
  // Create a promise that will resolve after capturing the frame
  const promise = new Promise((resolve, reject) => {
    // Check if the camera exists and is accessible
    console.log('[CAMERA-STREAMER] Checking if camera is accessible:', devicePath)
    hasCamera(devicePath)
      .then(cameraExists => {
        if (!cameraExists) {
          console.log('[CAMERA-STREAMER] Camera device not accessible:', devicePath)
          return reject(new Error(`Camera device not accessible: ${devicePath}`))
        }
        
        console.log(`[CAMERA-STREAMER] Camera accessible, waiting ${delay} seconds before capture`)
        // Wait for the specified delay
        setTimeout(() => {
          console.log('[CAMERA-STREAMER] Delay complete, capturing frame')
          // Capture the frame
          captureFrame({ resolution: format ? `${format.width}x${format.height}` : null })
            .then(buffer => {
              console.log('[CAMERA-STREAMER] Frame captured successfully in delayedshot')
              // If we temporarily changed the device, restore the original
              if (device && device !== originalDevice) {
                console.log('[CAMERA-STREAMER] Restoring original device path:', originalDevice)
                setDevicePath(originalDevice)
              }
              resolve(buffer)
            })
            .catch(err => {
              console.log('[CAMERA-STREAMER] Error capturing frame in delayedshot:', err.message)
              // If we temporarily changed the device, restore the original
              if (device && device !== originalDevice) {
                console.log('[CAMERA-STREAMER] Restoring original device path after error:', originalDevice)
                setDevicePath(originalDevice)
              }
              reject(err)
            })
        }, delay * 1000)
      })
      .catch(err => {
        console.log('[CAMERA-STREAMER] Error checking camera accessibility:', err.message)
        reject(err)
      })
  })
  
  return [null, promise]
}

/**
 * Detect faces in a frame from the camera
 * This is a stub implementation that just captures a frame
 * without actual face detection, since face detection would require
 * additional dependencies like OpenCV
 * @param {string} device - Path to the camera device
 * @param {Object} format - Format options for the camera
 * @param {number} fps - Frames per second
 * @param {number} minsize - Minimum face size
 * @param {number} cutoff - Detection threshold
 * @returns {Array} An array with null and a promise resolving to the captured frame
 */
const detectFace = (device, format, fps, minsize, cutoff) => {
  console.log('[CAMERA-STREAMER] Starting detectFace with device:', device, 'format:', JSON.stringify(format), 'fps:', fps, 'minsize:', minsize, 'cutoff:', cutoff)
  
  // In this simplified implementation, we just capture a frame
  // without doing actual face detection
  
  // Save the original device path
  const originalDevice = devicePath
  console.log('[CAMERA-STREAMER] Original device path for face detection:', originalDevice)
  
  // If a specific device is provided, use it temporarily
  if (device && device !== devicePath) {
    console.log('[CAMERA-STREAMER] Temporarily using device for face detection:', device)
    setDevicePath(device)
  }
  
  // Check if we have a valid device path
  if (!devicePath) {
    console.log('[CAMERA-STREAMER] ERROR: No device path set for face detection')
    return [null, Promise.reject(new Error('No camera device path set'))]
  }
  
  console.log(`[CAMERA-STREAMER] Taking photo for face detection from device: ${devicePath}`)
  
  // Create a promise that will resolve after capturing the frame
  const promise = captureFrame({ resolution: format ? `${format.width}x${format.height}` : null })
    .then(buffer => {
      console.log('[CAMERA-STREAMER] Face detection frame captured successfully, size:', buffer.length)
      // If we temporarily changed the device, restore the original
      if (device && device !== originalDevice) {
        console.log('[CAMERA-STREAMER] Restoring original device path after face detection:', originalDevice)
        setDevicePath(originalDevice)
      }
      return buffer
    })
    .catch(err => {
      console.log('[CAMERA-STREAMER] Error capturing frame for face detection:', err.message)
      // If we temporarily changed the device, restore the original
      if (device && device !== originalDevice) {
        console.log('[CAMERA-STREAMER] Restoring original device path after face detection error:', originalDevice)
        setDevicePath(originalDevice)
      }
      throw err
    })
  
  return [null, promise]
}

module.exports = {
  setVerbose,
  setDevicePath,
  getDevicePath,
  hasCamera,
  captureFrame,
  delayedshot,
  detectFace
} 