/**
 * USB Camera Module
 * 
 * Simple and dedicated module for handling USB camera operations.
 * Focuses solely on capturing images from the front facing camera
 * with no dependencies on scanner functionality.
 */

const fs = require('fs')
const { spawn, exec } = require('child_process')

// Module state
let cameraDevice = null
let isVerbose = false
let ffmpegChecked = false
let ffmpegAvailable = false

/**
 * Initialize the USB camera with configuration
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} Promise resolving to success status
 */
function initialize(config) {
  console.log('[USB-CAMERA] Initializing USB camera module')
  
  // Log system information for diagnostics
  try {
    exec('uname -a', (err, stdout) => {
      if (!err) {
        console.log('[USB-CAMERA] System info:', stdout.trim())
      }
    })
    
    // List video devices to help with troubleshooting
    exec('ls -la /dev/video*', (err, stdout) => {
      if (!err) {
        console.log('[USB-CAMERA] Available video devices:')
        console.log(stdout.trim())
      } else {
        console.log('[USB-CAMERA] Error listing video devices:', err.message)
      }
    })
  } catch (e) {
    console.log('[USB-CAMERA] Error getting system info:', e.message)
  }
  
  if (!config || !config.frontFacingCamera || !config.frontFacingCamera.device) {
    console.log('[USB-CAMERA] No front facing camera configured')
    return Promise.resolve(false)
  }
  
  cameraDevice = config.frontFacingCamera.device
  console.log('[USB-CAMERA] Using front-facing camera device:', cameraDevice)
  
  // Check if ffmpeg is available
  return checkFfmpegAvailability()
    .then(ffmpegOk => {
      if (!ffmpegOk) {
        console.log('[USB-CAMERA] WARNING: ffmpeg is not available, camera will not work')
        return false
      }
      
      // Check if camera is accessible
      return checkCameraAccess()
        .then(accessible => {
          if (accessible) {
            console.log('[USB-CAMERA] Camera is accessible')
            
            // Run a test capture to confirm camera operation
            return testCameraCapture()
              .then(testSuccess => {
                if (testSuccess) {
                  console.log('[USB-CAMERA] Camera test successful, camera is fully operational')
                } else {
                  console.log('[USB-CAMERA] Camera test failed, camera may not function properly')
                }
                return accessible && ffmpegOk && testSuccess
              })
              .catch(err => {
                console.log('[USB-CAMERA] Camera test failed with error:', err.message)
                return accessible && ffmpegOk
              })
          } else {
            console.log('[USB-CAMERA] WARNING: Camera is not accessible')
            return false
          }
        })
    })
    .catch(err => {
      console.log('[USB-CAMERA] Error during initialization:', err.message)
      return Promise.resolve(false)
    })
}

/**
 * Check if ffmpeg is available in the system
 * @returns {Promise<boolean>} Promise resolving to true if ffmpeg is available
 */
function checkFfmpegAvailability() {
  if (ffmpegChecked) {
    console.log('[USB-CAMERA] Using cached ffmpeg availability:', ffmpegAvailable ? 'Available' : 'Not available')
    return Promise.resolve(ffmpegAvailable)
  }
  
  console.log('[USB-CAMERA] Checking ffmpeg availability')
  
  return new Promise((resolve) => {
    // Try using command -v which works in more shells
    exec('command -v ffmpeg', (error, stdout, stderr) => {
      if (error) {
        console.log('[USB-CAMERA] First check failed, trying another method')
        
        // Try direct ffmpeg call as alternative
        exec('ffmpeg -h', (directError, directStdout, directStderr) => {
          if (directError) {
            console.log('[USB-CAMERA] ffmpeg not available:', directError.message)
            
            // Check for fswebcam as alternative
            exec('command -v fswebcam', (fsError, fsStdout) => {
              if (fsError) {
                console.log('[USB-CAMERA] fswebcam also not available')
                ffmpegChecked = true
                ffmpegAvailable = false
                return resolve(false)
              }
              
              console.log('[USB-CAMERA] fswebcam found at:', fsStdout.trim())
              // We'll still use the ffmpeg flags to track this
              ffmpegChecked = true
              ffmpegAvailable = true
              resolve(true)
            })
            
            return
          }
          
          console.log('[USB-CAMERA] ffmpeg is available (direct check)')
          ffmpegChecked = true
          ffmpegAvailable = true
          resolve(true)
        })
        
        return
      }
      
      const ffmpegPath = stdout.trim()
      console.log('[USB-CAMERA] ffmpeg found at:', ffmpegPath)
      
      // Now check if it's executable with simple -h parameter
      exec('ffmpeg -h', (versionError, versionStdout) => {
        if (versionError) {
          console.log('[USB-CAMERA] ffmpeg found but not executable:', versionError.message)
          
          // Try direct ffmpeg call as last resort
          exec('ffmpeg -version', (directError, directStdout) => {
            if (directError) {
              console.log('[USB-CAMERA] ffmpeg not executable:', directError.message)
              
              // Check for fswebcam as alternative
              exec('command -v fswebcam', (fsError, fsStdout) => {
                if (fsError) {
                  console.log('[USB-CAMERA] fswebcam also not available')
                  ffmpegChecked = true
                  ffmpegAvailable = false
                  return resolve(false)
                }
                
                console.log('[USB-CAMERA] fswebcam found at:', fsStdout.trim())
                // We'll still use the ffmpeg flags to track availability
                ffmpegChecked = true
                ffmpegAvailable = true
                resolve(true)
              })
              
              return
            }
            
            console.log('[USB-CAMERA] ffmpeg is available (direct version check)')
            ffmpegChecked = true
            ffmpegAvailable = true
            resolve(true)
          })
          
          return
        }
        
        console.log('[USB-CAMERA] ffmpeg is available and executable')
        ffmpegChecked = true
        ffmpegAvailable = true
        resolve(true)
      })
    })
  })
}

/**
 * Set verbose mode for debugging
 * @param {boolean} verbose - Whether to enable verbose logging
 */
function setVerbose(verbose) {
  isVerbose = verbose
  console.log('[USB-CAMERA] Verbose mode:', verbose ? 'enabled' : 'disabled')
}

/**
 * Check if the camera device is accessible
 * @returns {Promise<boolean>} Promise resolving to true if camera is accessible
 */
function checkCameraAccess() {
  console.log('[USB-CAMERA] Checking camera access:', cameraDevice)
  
  return new Promise((resolve) => {
    if (!cameraDevice) {
      console.log('[USB-CAMERA] No camera device configured')
      return resolve(false)
    }
    
    fs.access(cameraDevice, fs.constants.R_OK, (err) => {
      if (err) {
        console.log('[USB-CAMERA] Camera device not accessible:', cameraDevice, 'Error:', err.message)
        return resolve(false)
      }
      
      console.log('[USB-CAMERA] Camera device is accessible:', cameraDevice)
      resolve(true)
    })
  })
}

/**
 * Capture photo using fswebcam as fallback method
 * @param {string} devicePath - Path to camera device
 * @returns {Promise<Buffer>} Promise resolving to image buffer
 */
function captureWithFswebcam(devicePath) {
  console.log('[USB-CAMERA] Attempting to capture using fswebcam')
  
  return new Promise((resolve, reject) => {
    // Create a temporary file to store the image
    const tmpFile = `/tmp/webcam-${Date.now()}.jpg`
    console.log('[USB-CAMERA] Temporary file for fswebcam:', tmpFile)
    
    // Basic fswebcam command
    const fswebcamArgs = [
      '--no-banner',           // No banner text
      '-r', '1280x720',        // Resolution
      '--jpeg', '85',          // JPEG quality
      '-D', '1',               // Delay 1 second
      '-S', '3',               // Skip first 3 frames
      devicePath,              // Device
      tmpFile                  // Output file
    ]
    
    console.log('[USB-CAMERA] Executing fswebcam command:', 'fswebcam', fswebcamArgs.join(' '))
    
    const fswebcam = spawn('fswebcam', fswebcamArgs)
    let fswebcamOutput = ''
    
    fswebcam.stdout.on('data', (data) => {
      fswebcamOutput += data.toString()
      console.log('[USB-CAMERA] fswebcam stdout:', data.toString())
    })
    
    fswebcam.stderr.on('data', (data) => {
      fswebcamOutput += data.toString()
      console.log('[USB-CAMERA] fswebcam stderr:', data.toString())
    })
    
    fswebcam.on('close', (code) => {
      if (code !== 0) {
        console.log('[USB-CAMERA] fswebcam exited with error code:', code)
        console.log('[USB-CAMERA] fswebcam output:', fswebcamOutput)
        
        // Clean up temp file if it exists
        fs.unlink(tmpFile, () => {})
        
        return reject(new Error(`fswebcam exited with code ${code}`))
      }
      
      // Read the captured image file
      fs.readFile(tmpFile, (err, data) => {
        // Clean up temp file regardless of success
        fs.unlink(tmpFile, () => {})
        
        if (err) {
          console.log('[USB-CAMERA] Error reading fswebcam output file:', err.message)
          return reject(err)
        }
        
        console.log('[USB-CAMERA] Successfully captured image with fswebcam, size:', data.length, 'bytes')
        resolve(data)
      })
    })
    
    fswebcam.on('error', (err) => {
      console.log('[USB-CAMERA] Error spawning fswebcam:', err.message)
      
      // Clean up temp file if it exists
      fs.unlink(tmpFile, () => {})
      
      reject(err)
    })
  })
}

/**
 * Save captured photo to disk for debugging purposes
 * @param {Buffer} imageBuffer - The image buffer to save
 * @param {string} prefix - Prefix for the filename
 * @returns {Promise<string>} Promise resolving to the file path
 */
function saveDebugPhoto(imageBuffer, prefix = 'debug') {
  const debugDir = '/tmp/lamassu-camera-debug';
  const fileName = `${prefix}-${Date.now()}.jpg`;
  const filePath = `${debugDir}/${fileName}`;
  
  console.log(`[USB-CAMERA] Zapisuję zdjęcie diagnostyczne do ${filePath}`);
  console.log(`[USB-CAMERA] Typ bufora zdjęcia: ${Buffer.isBuffer(imageBuffer) ? 'Buffer' : typeof imageBuffer}`);
  console.log(`[USB-CAMERA] Rozmiar bufora zdjęcia: ${imageBuffer.length} bajtów`);
  
  // Utwórz katalog jeśli nie istnieje
  return new Promise((resolve, reject) => {
    try {
      // Najpierw sprawdź czy katalog istnieje
      if (!fs.existsSync(debugDir)) {
        console.log(`[USB-CAMERA] Katalog diagnostyczny nie istnieje, tworzę go: ${debugDir}`);
        try {
          fs.mkdirSync(debugDir, { recursive: true });
          console.log(`[USB-CAMERA] Pomyślnie utworzono katalog diagnostyczny: ${debugDir}`);
        } catch (mkdirErr) {
          console.log(`[USB-CAMERA] Błąd tworzenia katalogu diagnostycznego: ${mkdirErr.message}`);
          // Próbujemy ponownie asynchronicznie
          fs.mkdir(debugDir, { recursive: true }, (err) => {
            if (err) {
              console.log(`[USB-CAMERA] Asynchroniczna próba utworzenia katalogu również nieudana: ${err.message}`);
              return reject(err);
            }
            
            writeImageFile();
          });
          return; // Wracamy aby uniknąć podwójnego wywołania writeImageFile()
        }
      }
      
      writeImageFile();
    } catch (e) {
      console.log(`[USB-CAMERA] Nieoczekiwany błąd podczas sprawdzania/tworzenia katalogu diagnostycznego: ${e.message}`);
      reject(e);
    }
    
    function writeImageFile() {
      try {
        console.log(`[USB-CAMERA] Zapisuję plik obrazu o rozmiarze ${imageBuffer.length} bajtów`);
        
        // Sprawdź nagłówek JPEG
        if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
          console.log(`[USB-CAMERA] Dane mają prawidłowy nagłówek JPEG (0xFF,0xD8)`);
        } else {
          console.log(`[USB-CAMERA] OSTRZEŻENIE: Dane mogą nie być prawidłowym obrazem JPEG!`);
          console.log(`[USB-CAMERA] Pierwsze bajty: ${imageBuffer.slice(0, 16).toString('hex')}`);
          console.log(`[USB-CAMERA] Oczekiwano 0xFFD8 na początku dla prawidłowego JPEG`);
        }
        
        // Sprawdź zakończenie JPEG
        const lastBytes = imageBuffer.slice(-2).toString('hex');
        console.log(`[USB-CAMERA] Ostatnie 2 bajty: ${lastBytes}`);
        if (lastBytes === 'ffd9') {
          console.log(`[USB-CAMERA] Dane mają prawidłowe zakończenie JPEG (0xFF,0xD9)`);
        } else {
          console.log(`[USB-CAMERA] OSTRZEŻENIE: Dane mogą nie mieć prawidłowego zakończenia JPEG!`);
        }
        
        // Zapisz plik
        fs.writeFile(filePath, imageBuffer, (writeErr) => {
          if (writeErr) {
            console.log(`[USB-CAMERA] Błąd zapisywania zdjęcia diagnostycznego: ${writeErr.message}`);
            return reject(writeErr);
          }
          
          console.log(`[USB-CAMERA] Zdjęcie diagnostyczne zapisane pomyślnie: ${filePath}`);
          resolve(filePath);
          
          // Sprawdź uprawnienia do pliku
          fs.chmod(filePath, 0o644, (chmodErr) => {
            if (chmodErr) {
              console.log(`[USB-CAMERA] Ostrzeżenie: Nie udało się zmienić uprawnień pliku: ${chmodErr.message}`);
            }
          });
        });
      } catch (writeExc) {
        console.log(`[USB-CAMERA] Nieoczekiwany wyjątek podczas zapisywania pliku: ${writeExc.message}`);
        reject(writeExc);
      }
    }
  });
}

/**
 * Capture a photo from the camera
 * @param {Object} options - Capture options
 * @returns {Promise<Buffer>} Promise resolving to image buffer
 */
function capturePhoto(options = {}) {
  console.log('[USB-CAMERA] Capturing photo from camera')
  console.log('[USB-CAMERA] Camera device:', cameraDevice)
  console.log('[USB-CAMERA] Options:', JSON.stringify(options))
  
  // First check if ffmpeg is available
  if (!ffmpegChecked) {
    return checkFfmpegAvailability().then(available => {
      if (!available) {
        throw new Error('ffmpeg is not available, cannot capture photo')
      }
      return capturePhotoWithFfmpeg(options)
    })
  } else if (!ffmpegAvailable) {
    return Promise.reject(new Error('ffmpeg is not available, cannot capture photo'))
  }
  
  return capturePhotoWithFfmpeg(options)
    .then(imageBuffer => {
      // Log details about captured image
      console.log('[USB-CAMERA] Zdjęcie przechwycone pomyślnie')
      console.log('[USB-CAMERA] Rozmiar bufora zdjęcia:', imageBuffer.length, 'bajtów')
      console.log('[USB-CAMERA] Pierwsze 20 bajtów zdjęcia:', imageBuffer.slice(0, 20).toString('hex'))
      
      // Save debug photo to disk
      if (options.saveDebug || isVerbose) {
        return saveDebugPhoto(imageBuffer, options.debugPrefix || 'capture')
          .then((savedPath) => {
            console.log('[USB-CAMERA] Zdjęcie debugowania zapisane pod ścieżką:', savedPath)
            return imageBuffer
          })
          .catch((saveErr) => {
            console.log('[USB-CAMERA] Błąd zapisywania zdjęcia debugowania:', saveErr.message)
            return imageBuffer
          });
      }
      return imageBuffer;
    })
    .catch(ffmpegError => {
      console.log('[USB-CAMERA] ffmpeg capture failed, trying fswebcam as last resort. Error:', ffmpegError.message)
      
      // Try with fswebcam as a last resort
      return captureWithFswebcam(cameraDevice)
        .then(imageBuffer => {
          // Save debug photo to disk
          if (options.saveDebug || isVerbose) {
            return saveDebugPhoto(imageBuffer, options.debugPrefix || 'fswebcam')
              .then(() => imageBuffer)
              .catch(() => imageBuffer); // Continue even if saving fails
          }
          return imageBuffer;
        })
        .catch(fswebcamError => {
          console.log('[USB-CAMERA] fswebcam also failed:', fswebcamError.message)
          // Throw the original ffmpeg error, as that's more likely the root cause
          throw ffmpegError
        })
    })
}

/**
 * Actual implementation of photo capture using ffmpeg
 * @param {Object} options - Capture options
 * @returns {Promise<Buffer>} Promise resolving to image buffer
 */
function capturePhotoWithFfmpeg(options = {}) {
  console.log('[USB-CAMERA] Wykonuję zdjęcie za pomocą ffmpeg')
  console.log('[USB-CAMERA] Opcje przechwytywania:', JSON.stringify(options))
  
  return new Promise((resolve, reject) => {
    if (!cameraDevice) {
      console.log('[USB-CAMERA] BŁĄD: Nie skonfigurowano urządzenia kamery')
      return reject(new Error('Nie skonfigurowano urządzenia kamery'))
    }
    
    // Logowanie zmiennej PATH dla pomocy w rozwiązywaniu problemów
    console.log('[USB-CAMERA] Aktualna ścieżka PATH:', process.env.PATH || 'Niedostępna')
    
    // Sprawdź czy urządzenie kamery istnieje przed próbą wykonania zdjęcia
    fs.access(cameraDevice, fs.constants.R_OK, (deviceErr) => {
      if (deviceErr) {
        console.log('[USB-CAMERA] BŁĄD: Urządzenie kamery niedostępne przed wykonaniem zdjęcia:', deviceErr.message)
        return reject(new Error(`Urządzenie kamery niedostępne: ${deviceErr.message}`))
      }
      
      console.log('[USB-CAMERA] Urządzenie kamery istnieje i jest dostępne do odczytu')
      
      // Używamy prostszych opcji ffmpeg, które mają większe szanse na działanie
      const args = [
        '-y',                   // Nadpisuj pliki wyjściowe bez pytania
        '-hide_banner',         // Ukryj banner ffmpeg dla czytelności logów
        '-loglevel', 'warning', // Pokaż tylko ostrzeżenia i błędy
        '-f', 'video4linux2',   // Format wejściowy - video4linux2
        '-i', cameraDevice,     // Urządzenie wejściowe
        '-vframes', '1',        // Przechwyć tylko jedną klatkę
        '-q:v', '3',            // Wysoka jakość obrazu (1-31, gdzie 1 to najlepsza)
        '-f', 'image2pipe',     // Format wyjściowy - pipe
        '-'                     // Wyjście na stdout
      ]
      
      // Dodaj rozdzielczość jeśli podano
      if (options.resolution) {
        console.log('[USB-CAMERA] Ustawiam rozdzielczość:', options.resolution)
        args.splice(5, 0, '-s', options.resolution)
      }
      
      // Pełna komenda do debugowania
      const fullCommand = `ffmpeg ${args.join(' ')}`;
      console.log('[USB-CAMERA] Wykonuję komendę ffmpeg:', fullCommand)
      
      try {
        console.log('[USB-CAMERA] Uruchamiam proces ffmpeg')
        const ffmpeg = spawn('ffmpeg', args)
        const chunks = []
        let stderrOutput = '';
        let dataReceived = false;
        
        // Ustaw timeout aby zapobiec zawieszeniu - 12 sekund
        const timeoutId = setTimeout(() => {
          console.log('[USB-CAMERA] Operacja przechwytywania przekroczyła limit czasu (12 sekund)')
          console.log('[USB-CAMERA] Dane otrzymane: ' + (dataReceived ? 'TAK' : 'NIE'))
          console.log('[USB-CAMERA] Ostatnie dane stderr:', stderrOutput)
          try {
            ffmpeg.kill('SIGKILL')
            console.log('[USB-CAMERA] Wysłano SIGKILL do procesu ffmpeg')
          } catch (e) {
            console.log('[USB-CAMERA] Błąd podczas zabijania procesu ffmpeg:', e.message)
          }
          reject(new Error('Operacja przechwytywania przekroczyła limit czasu'))
        }, 12000)
        
        ffmpeg.stdout.on('data', (chunk) => {
          dataReceived = true;
          console.log('[USB-CAMERA] Otrzymano dane stdout o rozmiarze:', chunk.length, 'bajtów')
          if (chunk.length > 0) {
            console.log('[USB-CAMERA] Pierwsze 32 bajty danych:', chunk.slice(0, 32).toString('hex'))
          }
          chunks.push(chunk)
        })
        
        ffmpeg.stderr.on('data', (data) => {
          const message = data.toString()
          stderrOutput += message;
          // Zawsze logujemy stderr dla debugowania problemów z kamerą
          console.log('[USB-CAMERA] ffmpeg stderr:', message)
        })
        
        ffmpeg.on('close', (code) => {
          clearTimeout(timeoutId)
          console.log('[USB-CAMERA] Proces ffmpeg zakończony z kodem:', code)
          console.log('[USB-CAMERA] Dane otrzymane w stdout: ' + (dataReceived ? 'TAK' : 'NIE'))
          console.log('[USB-CAMERA] Ilość otrzymanych fragmentów danych:', chunks.length)
          
          if (code !== 0) {
            console.log('[USB-CAMERA] ffmpeg zakończony z błędem, kod:', code)
            console.log('[USB-CAMERA] Pełne dane stderr:', stderrOutput)
            
            // Próba awaryjnego wykonania zdjęcia z prostszymi opcjami
            console.log('[USB-CAMERA] Pierwsza próba nieudana. Próbuję z prostszymi opcjami...')
            
            const fallbackArgs = [
              '-f', 'video4linux2',
              '-i', cameraDevice,
              '-vframes', '1',
              '-y',
              '-f', 'image2pipe',
              '-'
            ]
            
            const fallbackCommand = `ffmpeg ${fallbackArgs.join(' ')}`;
            console.log('[USB-CAMERA] Próbuję awaryjną komendę:', fallbackCommand)
            
            const fallbackFfmpeg = spawn('ffmpeg', fallbackArgs)
            const fallbackChunks = []
            let fallbackDataReceived = false;
            let fallbackStderrOutput = '';
            
            fallbackFfmpeg.stdout.on('data', (chunk) => {
              fallbackDataReceived = true;
              console.log('[USB-CAMERA] Otrzymano dane awaryjne o rozmiarze:', chunk.length)
              fallbackChunks.push(chunk)
            })
            
            fallbackFfmpeg.stderr.on('data', (data) => {
              const message = data.toString()
              fallbackStderrOutput += message
              console.log('[USB-CAMERA] Awaryjny stderr ffmpeg:', message)
            })
            
            fallbackFfmpeg.on('close', (fallbackCode) => {
              console.log('[USB-CAMERA] Awaryjny proces ffmpeg zakończony z kodem:', fallbackCode)
              console.log('[USB-CAMERA] Dane otrzymane w awaryjnym trybie: ' + (fallbackDataReceived ? 'TAK' : 'NIE'))
              console.log('[USB-CAMERA] Pełny stderr awaryjnego procesu:', fallbackStderrOutput)
              
              if (fallbackCode === 0 && fallbackChunks.length > 0) {
                console.log('[USB-CAMERA] Awaryjne przechwytywanie udane, łączę fragmenty...')
                const buffer = Buffer.concat(fallbackChunks)
                console.log('[USB-CAMERA] Rozmiar bufora awaryjnego:', buffer.length, 'bajtów')
                
                if (buffer.length === 0) {
                  console.log('[USB-CAMERA] BŁĄD: Bufor awaryjny jest pusty.')
                  return reject(new Error('Awaryjne przechwytywanie zwróciło pusty bufor'))
                }
                
                // Opcjonalnie zapisz kopię diagnostyczną
                if (options.saveDebug || isVerbose) {
                  saveDebugPhoto(buffer, (options.debugPrefix || 'capture') + '-fallback')
                    .then((path) => console.log('[USB-CAMERA] Zapisano awaryjne zdjęcie pod ścieżką:', path))
                    .catch((err) => console.log('[USB-CAMERA] Błąd zapisywania awaryjnego zdjęcia:', err.message))
                }
                
                return resolve(buffer)
              }
              
              console.log('[USB-CAMERA] Awaryjne przechwytywanie również nie powiodło się')
              return reject(new Error('Nie udało się przechwycić zdjęcia z kamery'))
            })
          } else if (chunks.length === 0 || (chunks.length > 0 && chunks[0].length === 0)) {
            console.log('[USB-CAMERA] ffmpeg zakończony pomyślnie, ale nie otrzymano żadnych danych')
            return reject(new Error('Brak danych wyjściowych z kamery'))
          } else {
            console.log('[USB-CAMERA] Sukces! Łączę fragmenty danych...')
            const buffer = Buffer.concat(chunks)
            console.log('[USB-CAMERA] Rozmiar połączonego bufora:', buffer.length, 'bajtów')
            
            // Weryfikujemy czy mamy poprawny obraz JPEG
            if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
              console.log('[USB-CAMERA] Bufor zawiera prawidłowy nagłówek JPEG')
            } else {
              console.log('[USB-CAMERA] OSTRZEŻENIE: Bufor nie zawiera prawidłowego nagłówka JPEG!')
              if (buffer.length >= 4) {
                console.log('[USB-CAMERA] Pierwsze 4 bajty:', buffer.slice(0, 4).toString('hex'))
              }
            }
            
            // Opcjonalnie zapisz kopię diagnostyczną
            if (options.saveDebug || isVerbose) {
              saveDebugPhoto(buffer, options.debugPrefix || 'capture')
                .then((path) => console.log('[USB-CAMERA] Zapisano zdjęcie pod ścieżką:', path))
                .catch((err) => console.log('[USB-CAMERA] Błąd zapisywania zdjęcia:', err.message))
            }
            
            return resolve(buffer)
          }
        })
        
        ffmpeg.on('error', (error) => {
          clearTimeout(timeoutId)
          console.log('[USB-CAMERA] Błąd procesu ffmpeg:', error.message)
          reject(error)
        })
      } catch (spawnError) {
        console.log('[USB-CAMERA] Błąd podczas uruchamiania procesu ffmpeg:', spawnError.message)
        reject(new Error(`Błąd podczas uruchamiania ffmpeg: ${spawnError.message}`))
      }
    })
  })
}

/**
 * Test if camera capture actually works with the configured device
 * @returns {Promise<boolean>} Promise resolving to true if capture works
 */
function testCameraCapture() {
  console.log('[USB-CAMERA] Testing camera capture')
  
  // Simplified capture test with minimal options
  return new Promise((resolve) => {
    if (!cameraDevice) {
      console.log('[USB-CAMERA] No camera device for test')
      return resolve(false)
    }
    
    // Super simple command - just like ffplay would use
    const args = [
      '-f', 'video4linux2',
      '-i', cameraDevice,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-'
    ]
    
    console.log('[USB-CAMERA] Test capture command:', 'ffmpeg', args.join(' '))
    
    try {
      const proc = spawn('ffmpeg', args)
      const chunks = []
      let received = false
      
      // Set a shorter timeout for the test
      const testTimeout = setTimeout(() => {
        console.log('[USB-CAMERA] Test capture timed out')
        try {
          proc.kill('SIGKILL')
        } catch (e) {}
        resolve(false)
      }, 5000)
      
      proc.stdout.on('data', (chunk) => {
        console.log('[USB-CAMERA] Test capture received data chunk:', chunk.length, 'bytes')
        chunks.push(chunk)
        received = true
      })
      
      proc.on('close', (code) => {
        clearTimeout(testTimeout)
        if (code === 0 && received) {
          const buffer = Buffer.concat(chunks)
          console.log('[USB-CAMERA] Test capture successful, received', buffer.length, 'bytes')
          resolve(true)
        } else {
          console.log('[USB-CAMERA] Test capture failed with code:', code)
          resolve(false)
        }
      })
      
      proc.on('error', () => {
        clearTimeout(testTimeout)
        console.log('[USB-CAMERA] Test capture process error')
        resolve(false)
      })
    } catch (error) {
      console.log('[USB-CAMERA] Error spawning test capture process:', error.message)
      resolve(false)
    }
  })
}

/**
 * Take a face photo with optional delay
 * @param {Function} callback - Callback function(err, imageBuffer)
 * @param {Object} options - Optional parameters
 */
function takeFacePhoto(callback, options = {}) {
  if (options.cameraDebug) {
    console.log('!!! [USB-CAMERA] SZCZEGÓŁOWE ROZPOCZĘCIE ZDJĘCIA - ' + new Date().toISOString())
    console.log('!!! [USB-CAMERA] Opcje:', JSON.stringify(options))
    console.log('!!! [USB-CAMERA] Urządzenie kamery:', cameraDevice || 'Nieskonfigurowane')
    console.log('!!! [USB-CAMERA] ffmpeg sprawdzony:', ffmpegChecked ? 'TAK' : 'NIE')
    console.log('!!! [USB-CAMERA] ffmpeg dostępny:', ffmpegAvailable ? 'TAK' : 'NIE')
  } else {
    console.log('[USB-CAMERA] Rozpoczynam wykonywanie zdjęcia twarzy')
    console.log('[USB-CAMERA] Opcje:', JSON.stringify(options))
  }
  
  // Upewnij się, że callback jest funkcją
  if (typeof callback !== 'function') {
    console.log('[USB-CAMERA] BŁĄD: callback nie jest funkcją')
    return Promise.reject(new Error('Callback musi być funkcją'))
  }
  
  const delay = options.delay || 0
  
  // Sprawdź czy mamy skonfigurowane urządzenie kamery
  if (!cameraDevice) {
    console.log('[USB-CAMERA] BŁĄD: Nie skonfigurowano urządzenia kamery')
    return callback(new Error('Nie skonfigurowano urządzenia kamery'), null)
  }
  
  if (options.cameraDebug) {
    console.log('!!! [USB-CAMERA] Używam urządzenia kamery:', cameraDevice)
  } else {
    console.log('[USB-CAMERA] Używam urządzenia kamery:', cameraDevice)
  }
  
  // Sprawdź dostępność ffmpeg
  checkFfmpegAvailability()
    .then(ffmpegOk => {
      if (options.cameraDebug) {
        console.log('!!! [USB-CAMERA] Status ffmpeg:', ffmpegOk ? 'Dostępny' : 'Niedostępny')
      } else {
        console.log('[USB-CAMERA] Status ffmpeg:', ffmpegOk ? 'Dostępny' : 'Niedostępny')
      }
      
      if (!ffmpegOk) {
        console.log('[USB-CAMERA] BŁĄD: ffmpeg niedostępny, nie można wykonać zdjęcia')
        return callback(new Error('ffmpeg niedostępny'), null)
      }
      
      // Sprawdź dostęp do kamery
      return checkCameraAccess()
        .then(accessible => {
          if (options.cameraDebug) {
            console.log('!!! [USB-CAMERA] Status dostępu do kamery:', accessible ? 'Dostępna' : 'Niedostępna')
          } else {
            console.log('[USB-CAMERA] Status dostępu do kamery:', accessible ? 'Dostępna' : 'Niedostępna')
          }
          
          if (!accessible) {
            console.log('[USB-CAMERA] BŁĄD: Kamera niedostępna, nie można wykonać zdjęcia')
            return callback(new Error('Kamera niedostępna'), null)
          }
          
          // Jeśli ustawiono opóźnienie, poczekaj
          if (delay > 0) {
            if (options.cameraDebug) {
              console.log(`!!! [USB-CAMERA] Oczekiwanie ${delay}ms przed wykonaniem zdjęcia`)
            } else {
              console.log(`[USB-CAMERA] Oczekiwanie ${delay}ms przed wykonaniem zdjęcia`)
            }
            setTimeout(() => captureAndProcess(), delay)
          } else {
            captureAndProcess()
          }
        })
    })
    .catch(err => {
      console.log('[USB-CAMERA] BŁĄD podczas sprawdzania wymagań:', err.message)
      callback(err, null)
    })
  
  // Funkcja wewnętrzna do wykonania i przetworzenia zdjęcia
  function captureAndProcess() {
    if (options.cameraDebug) {
      console.log('!!! [USB-CAMERA] Rozpoczynam proces wykonywania zdjęcia - ' + new Date().toISOString())
    } else {
      console.log('[USB-CAMERA] Rozpoczynam proces wykonywania zdjęcia')
    }
    
    // Zawsze zapisuj zdjęcia diagnostyczne
    const captureOptions = {
      ...options,
      saveDebug: true,
      debugPrefix: options.debugPrefix || 'facephoto'
    }
    
    if (options.cameraDebug) {
      console.log('!!! [USB-CAMERA] Wywołuję capturePhoto z opcjami:', JSON.stringify(captureOptions))
    }
    
    // Próba alternatywnej metody zapisu zdjęcia do pliku
    if (options.cameraDebug && options.debugPrefix === 'tc-photo') {
      console.log('!!! [USB-CAMERA] UŻYWAM ALTERNATYWNEJ METODY PRZECHWYTYWANIA DLA T&C')
      try {
        // Użyj prostego polecenia do zapisu obrazu do pliku
        const tmpFile = '/tmp/tc-photo-direct-' + Date.now() + '.jpg';
        console.log('!!! [USB-CAMERA] Zapisuję obraz bezpośrednio do pliku:', tmpFile)
        
        const ffmpegArgs = [
          '-y', 
          '-f', 'video4linux2',
          '-i', cameraDevice,
          '-vframes', '1',
          tmpFile
        ];
        
        console.log('!!! [USB-CAMERA] Uruchamiam komendę:', 'ffmpeg', ffmpegArgs.join(' '))
        
        const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
        let ffmpegStderr = '';
        
        ffmpegProc.stderr.on('data', (data) => {
          ffmpegStderr += data.toString();
        });
        
        ffmpegProc.on('close', (code) => {
          console.log('!!! [USB-CAMERA] Proces ffmpeg zakończony z kodem:', code)
          
          if (code === 0) {
            try {
              const imageBuffer = fs.readFileSync(tmpFile);
              console.log('!!! [USB-CAMERA] Odczytano plik obrazu, rozmiar:', imageBuffer.length, 'bajtów')
              callback(null, imageBuffer);
            } catch (readErr) {
              console.log('!!! [USB-CAMERA] Błąd odczytu pliku obrazu:', readErr.message)
              callback(readErr, null);
            }
          } else {
            console.log('!!! [USB-CAMERA] Błąd ffmpeg, stderr:', ffmpegStderr)
            callback(new Error('Błąd ffmpeg, kod: ' + code), null);
          }
        });
        
        ffmpegProc.on('error', (err) => {
          console.log('!!! [USB-CAMERA] Błąd uruchomienia procesu ffmpeg:', err.message)
          callback(err, null);
        });
        
        return; // Nie wykonuj standardowej metody
      } catch (altErr) {
        console.log('!!! [USB-CAMERA] Błąd alternatywnej metody:', altErr.message)
        // Jeśli alternatywna metoda zawiedzie, kontynuuj ze standardową
      }
    }
    
    // Standardowa metoda
    capturePhoto(captureOptions)
      .then(buffer => {
        if (options.cameraDebug) {
          console.log('!!! [USB-CAMERA] Zdjęcie wykonane pomyślnie, rozmiar:', buffer.length, 'bajtów')
          console.log('!!! [USB-CAMERA] Format zdjęcia: JPEG (buffer)')
          console.log('!!! [USB-CAMERA] MD5 hash zdjęcia:', require('crypto').createHash('md5').update(buffer).digest('hex'))
        } else {
          console.log('[USB-CAMERA] Zdjęcie wykonane pomyślnie, rozmiar:', buffer.length, 'bajtów')
          console.log('[USB-CAMERA] Format zdjęcia: JPEG (buffer)')
        }
        
        // Weryfikacja poprawności bufora zdjęcia
        if (buffer.length < 1000) {
          console.log('[USB-CAMERA] OSTRZEŻENIE: Zdjęcie jest bardzo małe, prawdopodobnie uszkodzone')
          return callback(new Error('Zdjęcie jest zbyt małe, aby było prawidłowe'), null)
        }
        
        // Sprawdź nagłówek JPEG
        if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
          console.log('[USB-CAMERA] OSTRZEŻENIE: Dane nie mają prawidłowego nagłówka JPEG')
          console.log('[USB-CAMERA] Pierwsze bajty:', buffer.slice(0, 16).toString('hex'))
        }
        
        if (options.cameraDebug) {
          console.log('!!! [USB-CAMERA] Przekazuję zdjęcie do callback - ' + new Date().toISOString())
        } else {
          console.log('[USB-CAMERA] Przekazuję zdjęcie do callback')
        }
        callback(null, buffer)
      })
      .catch(err => {
        console.log('[USB-CAMERA] BŁĄD podczas wykonywania zdjęcia:', err.message)
        callback(err, null)
      })
  }
}

/**
 * Take face photo for Terms & Conditions display
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
function takeFacePhotoTC(callback) {
  console.log('!!! [USB-CAMERA] ROZPOCZYNAM WYKONYWANIE ZDJĘCIA DLA T&C - ' + new Date().toISOString())
  console.log('!!! [USB-CAMERA] Urządzenie kamery:', cameraDevice || 'Nieskonfigurowane')
  console.log('!!! [USB-CAMERA] ffmpeg dostępny:', ffmpegAvailable ? 'TAK' : 'NIE')
  console.log('!!! [USB-CAMERA] isVerbose:', isVerbose ? 'TAK' : 'NIE')
  
  // Sprawdź czy callback jest poprawną funkcją
  if (typeof callback !== 'function') {
    console.log('!!! [USB-CAMERA] KRYTYCZNY BŁĄD: callback nie jest funkcją!')
    return;
  }
  
  try {
    // Dodajemy flagi dla debugowania
    const options = { 
      saveDebug: true, 
      debugPrefix: 'tc-photo',
      cameraDebug: true
    };
    
    console.log('!!! [USB-CAMERA] Wywołuję takeFacePhoto z opcjami:', JSON.stringify(options))
    return takeFacePhoto((err, buffer) => {
      console.log('!!! [USB-CAMERA] CALLBACK Z takeFacePhoto WYWOŁANY - ' + new Date().toISOString())
      console.log('!!! [USB-CAMERA] Błąd:', err ? 'TAK: ' + err.message : 'NIE')
      console.log('!!! [USB-CAMERA] Buffer:', buffer ? 'TAK, rozmiar: ' + buffer.length + ' bajtów' : 'NIE')
      
      if (buffer) {
        // Spróbuj zapisać obraz do pliku dla diagnostyki
        const debugPath = '/tmp/tc-photo-debug-' + Date.now() + '.jpg';
        try {
          fs.writeFileSync(debugPath, buffer);
          console.log('!!! [USB-CAMERA] Zapisano kopię zdjęcia do:', debugPath);
        } catch (saveErr) {
          console.log('!!! [USB-CAMERA] Nie udało się zapisać kopii zdjęcia:', saveErr.message);
        }
      }
      
      callback(err, buffer);
    }, options);
  } catch (error) {
    console.log('!!! [USB-CAMERA] KRYTYCZNY BŁĄD w takeFacePhotoTC:', error.message)
    console.log('!!! [USB-CAMERA] Stack trace:', error.stack)
    callback(error, null)
  }
}

/**
 * Take photo of ID document with delay
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
function delayedPhoto(callback) {
  console.log('[USB-CAMERA] Taking delayed ID photo')
  return takeFacePhoto(callback, { delay: 1000 })
}

/**
 * Check if camera is available for specified type
 * @param {string} type - Camera type (facephoto, photoId, etc.)
 * @returns {Promise<boolean>} Promise resolving to true if camera exists
 */
function hasCamera(type) {
  console.log('[USB-CAMERA] Checking if camera exists for:', type)
  
  // Check both ffmpeg and camera access
  return checkFfmpegAvailability()
    .then(ffmpegOk => {
      if (!ffmpegOk) {
        console.log('[USB-CAMERA] ffmpeg not available, camera considered not available')
        return false
      }
      
      return checkCameraAccess()
    })
}

/**
 * Take diagnostic photos from all cameras
 * @returns {Promise<Object>} Object with base64 encoded photos
 */
function diagnosticPhotos() {
  console.log('[USB-CAMERA] Wykonywanie zdjęć diagnostycznych...')
  
  return new Promise((resolve) => {
    // Przygotuj obiekt odpowiedzi
    const response = {
      scan: null,
      front: null
    }
    
    // Sprawdź i zaloguj konfigurację kamery
    console.log('[USB-CAMERA] Urządzenie kamery używane do diagnostyki:', cameraDevice)
    console.log('[USB-CAMERA] Status ffmpeg:', ffmpegAvailable ? 'Dostępny' : 'Niedostępny')
    
    // Jeśli kamera nie jest dostępna, zwróć puste dane
    if (!cameraDevice || !ffmpegAvailable) {
      console.log('[USB-CAMERA] Brak kamery lub ffmpeg, zwracam puste dane diagnostyczne')
      return resolve(response)
    }
    
    // Wykonaj diagnostyczne zdjęcie i zwróć je
    return takeDiagnosticPhoto({ saveDebug: true, debugPrefix: 'diagnostic-front' })
      .then(frontBuffer => {
        console.log('[USB-CAMERA] Zdjęcie diagnostyczne wykonane pomyślnie, rozmiar:', frontBuffer.length, 'bajtów')
        response.front = frontBuffer.toString('base64')
        console.log('[USB-CAMERA] Pomyślnie przekonwertowano zdjęcie do base64, rozmiar:', response.front.length, 'znaków')
        return resolve(response)
      })
      .catch(err => {
        console.log('[USB-CAMERA] Błąd podczas wykonywania zdjęcia diagnostycznego:', err.message)
        return resolve(response)
      })
  })
}

/**
 * Take diagnostic photo
 * @param {Object} options - Capture options
 * @returns {Promise<string>} Base64 encoded photo
 */
function takeDiagnosticPhoto(options = {}) {
  console.log('[USB-CAMERA] Taking diagnostic photo')
  
  // Check ffmpeg first
  return checkFfmpegAvailability()
    .then(ffmpegOk => {
      if (!ffmpegOk) {
        console.log('[USB-CAMERA] ffmpeg not available, diagnostic photo not possible')
        return null
      }
      
      return capturePhoto(options)
        .then(buffer => {
          console.log('[USB-CAMERA] Diagnostic photo captured, converting to base64')
          return buffer.toString('base64')
        })
        .catch(err => {
          console.log('[USB-CAMERA] ERROR in takeDiagnosticPhoto:', err.message)
          return null
        })
    })
}

/**
 * Get delay in milliseconds for compatibility
 * @returns {number} Delay in milliseconds
 */
function getDelayMS() {
  return 3000 // Standard delay used in scanner modules
}

/**
 * Alias function with lowercase 'p' for compatibility with legacy code
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
function takeFacephoto(callback) {
  console.log('[USB-CAMERA] Wywołano takeFacephoto (funkcja kompatybilności z małą literą p)')
  return takeFacePhoto(callback, {
    saveDebug: true,
    debugPrefix: 'facephoto-legacy'
  })
}

/**
 * Take a face photo with delay for compatibility with existing code
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
function delayedFacephoto(callback) {
  console.log('[USB-CAMERA] Running delayedFacephoto (compatibility method)')
  return takeFacePhoto(callback, { 
    delay: 1000,
    saveDebug: true,
    debugPrefix: 'delayed-facephoto'
  })
}

// Dodaję alternatywną metodę przechwytywania zdjęcia za pomocą fswebcam
function capturePhotoWithFswebcam(options = {}) {
  console.log('!!! [USB-CAMERA] UŻYWAM FSWEBCAM DO PRZECHWYCENIA ZDJĘCIA - ' + new Date().toISOString())
  
  return new Promise((resolve, reject) => {
    try {
      // Stwórz plik tymczasowy
      const tmpFile = `/tmp/fswebcam-tc-${Date.now()}.jpg`
      console.log('!!! [USB-CAMERA] Plik tymczasowy fswebcam:', tmpFile)
      
      // Parametry fswebcam
      const fswebcamArgs = [
        '--no-banner',
        '-r', '1280x720',
        '--jpeg', '85',
        '-D', '1',
        cameraDevice,
        tmpFile
      ]
      
      console.log('!!! [USB-CAMERA] Wywołuję komendę:', 'fswebcam', fswebcamArgs.join(' '))
      
      // Uruchom fswebcam
      const fswebcam = spawn('fswebcam', fswebcamArgs)
      let fswebcamOutput = ''
      
      fswebcam.stdout.on('data', (data) => {
        fswebcamOutput += data.toString()
        console.log('!!! [USB-CAMERA] fswebcam stdout:', data.toString())
      })
      
      fswebcam.stderr.on('data', (data) => {
        fswebcamOutput += data.toString()
        console.log('!!! [USB-CAMERA] fswebcam stderr:', data.toString())
      })
      
      fswebcam.on('close', (code) => {
        console.log('!!! [USB-CAMERA] fswebcam zakończony z kodem:', code)
        console.log('!!! [USB-CAMERA] fswebcam output:', fswebcamOutput)
        
        if (code === 0) {
          // Odczytaj plik
          try {
            const imageData = fs.readFileSync(tmpFile)
            console.log('!!! [USB-CAMERA] Odczytano obraz fswebcam, rozmiar:', imageData.length, 'bajtów')
            
            // Spróbuj zachować kopię dla diagnostyki
            try {
              const debugPath = `/tmp/fswebcam-tc-debug-${Date.now()}.jpg`
              fs.copyFileSync(tmpFile, debugPath)
              console.log('!!! [USB-CAMERA] Zapisano kopię fswebcam do:', debugPath)
            } catch (copyErr) {
              console.log('!!! [USB-CAMERA] Nie udało się zapisać kopii fswebcam:', copyErr.message)
            }
            
            // Usuń plik tymczasowy
            try {
              fs.unlinkSync(tmpFile)
            } catch (unlinkErr) {
              console.log('!!! [USB-CAMERA] Nie udało się usunąć pliku tymczasowego:', unlinkErr.message)
            }
            
            resolve(imageData)
          } catch (readErr) {
            console.log('!!! [USB-CAMERA] Błąd odczytu pliku fswebcam:', readErr.message)
            reject(readErr)
          }
        } else {
          console.log('!!! [USB-CAMERA] fswebcam zakończony z błędem, kod:', code)
          reject(new Error(`fswebcam zakończony z kodem ${code}`))
        }
      })
      
      fswebcam.on('error', (err) => {
        console.log('!!! [USB-CAMERA] Błąd uruchomienia fswebcam:', err.message)
        reject(err)
      })
    } catch (err) {
      console.log('!!! [USB-CAMERA] Błąd generalny fswebcam:', err.message)
      reject(err)
    }
  })
}

// Dodaję alternatywną metodę wykonywania zdjęcia dla TC (używaną gdy inne zawodzą)
function takeFacePhotoTCAlternative(callback) {
  console.log('!!! [USB-CAMERA] URUCHAMIAM ALTERNATYWNĄ METODĘ WYKONYWANIA ZDJĘCIA DLA T&C')
  
  // Sprawdź dostępność fswebcam
  exec('command -v fswebcam', (err, stdout) => {
    if (err) {
      console.log('!!! [USB-CAMERA] fswebcam niedostępny, próbuję ffmpeg z zapisem do pliku')
      tryWithFfmpeg()
    } else {
      console.log('!!! [USB-CAMERA] fswebcam dostępny:', stdout.trim())
      capturePhotoWithFswebcam()
        .then(buffer => {
          console.log('!!! [USB-CAMERA] Zdjęcie fswebcam gotowe, przekazuję do callback')
          callback(null, buffer)
        })
        .catch(error => {
          console.log('!!! [USB-CAMERA] Błąd zdjęcia fswebcam, próbuję metodę ffmpeg:', error.message)
          tryWithFfmpeg()
        })
    }
  })
  
  function tryWithFfmpeg() {
    try {
      const tmpFile = `/tmp/ffmpeg-tc-${Date.now()}.jpg`
      console.log('!!! [USB-CAMERA] Używam ffmpeg z zapisem do pliku:', tmpFile)
      
      const ffmpegArgs = [
        '-y',
        '-f', 'video4linux2',
        '-i', cameraDevice,
        '-vframes', '1',
        tmpFile
      ]
      
      console.log('!!! [USB-CAMERA] Uruchamiam komendę ffmpeg:', ffmpegArgs.join(' '))
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs)
      let ffmpegOutput = ''
      
      ffmpeg.stderr.on('data', (data) => {
        ffmpegOutput += data.toString()
        console.log('!!! [USB-CAMERA] ffmpeg stderr:', data.toString())
      })
      
      ffmpeg.on('close', (code) => {
        console.log('!!! [USB-CAMERA] ffmpeg zakończony z kodem:', code)
        
        if (code === 0) {
          try {
            const imageData = fs.readFileSync(tmpFile)
            console.log('!!! [USB-CAMERA] Odczytano obraz ffmpeg, rozmiar:', imageData.length, 'bajtów')
            
            // Zachowaj kopię dla diagnostyki
            try {
              const debugPath = `/tmp/ffmpeg-tc-debug-${Date.now()}.jpg`
              fs.copyFileSync(tmpFile, debugPath)
              console.log('!!! [USB-CAMERA] Zapisano kopię ffmpeg do:', debugPath)
            } catch (copyErr) {
              console.log('!!! [USB-CAMERA] Nie udało się zapisać kopii ffmpeg:', copyErr.message)
            }
            
            // Usuń plik tymczasowy
            try {
              fs.unlinkSync(tmpFile)
            } catch (unlinkErr) {
              console.log('!!! [USB-CAMERA] Nie udało się usunąć pliku tymczasowego:', unlinkErr.message)
            }
            
            callback(null, imageData)
          } catch (readErr) {
            console.log('!!! [USB-CAMERA] Błąd odczytu pliku ffmpeg:', readErr.message)
            callback(readErr, null)
          }
        } else {
          console.log('!!! [USB-CAMERA] ffmpeg zakończony z błędem, stderr:', ffmpegOutput)
          callback(new Error(`ffmpeg zakończony z kodem ${code}`), null)
        }
      })
      
      ffmpeg.on('error', (err) => {
        console.log('!!! [USB-CAMERA] Błąd uruchomienia ffmpeg:', err.message)
        callback(err, null)
      })
    } catch (err) {
      console.log('!!! [USB-CAMERA] Błąd generalny ffmpeg:', err.message)
      callback(err, null)
    }
  }
}

module.exports = {
  initialize,
  setVerbose,
  checkCameraAccess,
  capturePhoto,
  takeFacePhoto,
  takeFacephoto,        // Lowercase 'p' version for compatibility
  takeFacePhotoTC,      // For Terms & Conditions photos
  takeFacePhotoTCAlternative, // Alternatywna metoda dla T&C
  delayedFacephoto,     // Delayed face photo function
  delayedPhoto,         // For ID document photos
  takeDiagnosticPhoto,
  diagnosticPhotos,     // For diagnostic photos from all cameras
  hasCamera,            // Check camera availability
  getDelayMS,           // Get standard delay
  capturePhotoWithFswebcam // Eksport funkcji pomocniczej
} 