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
}

/**
 * Set the camera device path
 * @param {string} path - Path to the camera device
 */
const setDevicePath = (path) => {
  devicePath = path
  if (isVerbose) {
    console.log('[CAMERA-STREAMER] Device path set to:', devicePath)
  }
}

/**
 * Get the current camera device path
 * @returns {string} The camera device path
 */
const getDevicePath = () => devicePath

/**
 * Check if the camera exists and is accessible
 * @param {string} device - Path to the camera device
 * @returns {Promise<boolean>} Promise resolving to true if camera exists
 */
const hasCamera = (device) => {
  return new Promise((resolve) => {
    if (!device) {
      if (isVerbose) {
        console.log('[CAMERA-STREAMER] No device specified')
      }
      return resolve(false)
    }

    fs.access(device, fs.constants.R_OK, (err) => {
      if (err) {
        if (isVerbose) {
          console.log('[CAMERA-STREAMER] Device not accessible:', device, err.message)
        }
        return resolve(false)
      }
      
      if (isVerbose) {
        console.log('[CAMERA-STREAMER] Device accessible:', device)
      }
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
  return new Promise((resolve, reject) => {
    if (!devicePath) {
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

    if (options.resolution) {
      args.splice(2, 0, '-s', options.resolution)
    }

    if (isVerbose) {
      console.log('[CAMERA-STREAMER] Capturing frame with ffmpeg:', args.join(' '))
    }

    const ffmpeg = spawn('ffmpeg', args)
    const chunks = []

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk)
    })

    ffmpeg.stderr.on('data', (data) => {
      if (isVerbose) {
        console.log('[CAMERA-STREAMER] ffmpeg stderr:', data.toString())
      }
    })

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}`))
      }

      const buffer = Buffer.concat(chunks)
      if (isVerbose) {
        console.log('[CAMERA-STREAMER] Captured frame, size:', buffer.length)
      }
      resolve(buffer)
    })

    ffmpeg.on('error', (err) => {
      reject(err)
    })
  })
}

module.exports = {
  setVerbose,
  setDevicePath,
  getDevicePath,
  hasCamera,
  captureFrame
} 