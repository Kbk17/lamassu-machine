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
  
  // Logging all video devices for diagnostics
  try {
    exec('ls -la /dev/video*', (err, stdout, stderr) => {
      if (!err) {
        console.log('[USB-CAMERA] Available video devices:');
        console.log(stdout.trim());
      } else {
        console.log('[USB-CAMERA] Error listing video devices:', err.message);
        console.log('[USB-CAMERA] stderr:', stderr);
        
        // Try alternative method
        exec('find /dev -name "video*"', (findErr, findOutput) => {
          if (!findErr && findOutput) {
            console.log('[USB-CAMERA] Video devices found by find:');
            console.log(findOutput.trim());
          }
        });
      }
    });
  } catch (e) {
    console.log('[USB-CAMERA] Error detecting video devices:', e.message);
  }
  
  if (!config || !config.frontFacingCamera || !config.frontFacingCamera.device) {
    console.log('[USB-CAMERA] Nie skonfigurowano przedniej kamery')
    return Promise.resolve(false)
  }
  
  const configuredDevice = config.frontFacingCamera.device
  console.log('[USB-CAMERA] Skonfigurowane urządzenie przedniej kamery w konfiguracji:', configuredDevice)
  
  // Używaj WYŁĄCZNIE urządzenia kamery skonfigurowanego w pliku
  if (fs.existsSync(configuredDevice)) {
    console.log('[USB-CAMERA] Używam skonfigurowanego urządzenia kamery:', configuredDevice)
    cameraDevice = configuredDevice
  } else {
    console.log('[USB-CAMERA] UWAGA: Skonfigurowane urządzenie kamery nie istnieje:', configuredDevice)
    console.log('[USB-CAMERA] UWAGA: Nie używam alternatywnych urządzeń, zgodnie z wymaganiem')
    return Promise.resolve(false)
  }
  
  console.log('[USB-CAMERA] OSTATECZNIE WYBRANE urządzenie kamery:', cameraDevice)
  
  // Sprawdź, czy ffmpeg jest dostępny - jeśli ffmpeg jest dostępny, uznajemy to za wystarczający warunek
  return checkFfmpegAvailability()
    .then(ffmpegOk => {
      if (!ffmpegOk) {
        console.log('[USB-CAMERA] UWAGA: ffmpeg jest niedostępny, kamera nie będzie działać')
        return false
      }
      
      // Test dostępu do wybranego urządzenia kamery
      try {
        fs.accessSync(cameraDevice, fs.constants.R_OK | fs.constants.W_OK)
        console.log('[USB-CAMERA] Urządzenie kamery jest dostępne z uprawnieniami odczytu/zapisu')
      } catch (accessErr) {
        console.log('[USB-CAMERA] Błąd dostępu do urządzenia kamery:', accessErr.message)
      }
      
      // Jeśli urządzenie istnieje i ffmpeg jest dostępny, uznajemy kamerę za gotową do użycia
      console.log('[USB-CAMERA] Inicjalizacja kamery udana: urządzenie istnieje i ffmpeg jest dostępny')
      
      // Dodaj test kamery przy inicjalizacji
      setTimeout(() => {
        console.log('[USB-CAMERA] Wykonuję testowe zdjęcie startowe...')
        takeFacePhoto((err, buffer) => {
          if (err) {
            console.log('[USB-CAMERA] BŁĄD testowego zdjęcia startowego:', err.message)
          } else if (buffer) {
            console.log('[USB-CAMERA] Testowe zdjęcie startowe udane, rozmiar:', buffer.length, 'bajtów')
            
            // Zapisz kopię diagnostyczną
            saveDebugPhoto(buffer, 'startup-test')
              .then(path => console.log('[USB-CAMERA] Zapisano testowe zdjęcie startowe pod ścieżką:', path))
              .catch(saveErr => console.log('[USB-CAMERA] Błąd zapisu testowego zdjęcia startowego:', saveErr.message))
          } else {
            console.log('[USB-CAMERA] Brak błędu, ale też brak bufora przy testowym zdjęciu startowym')
          }
        }, { saveDebug: true, debugPrefix: 'startup-test' })
      }, 5000) // Daj systemowi 5 sekund na ustabilizowanie się
      
      // Wykonaj testowe zdjęcie, aby sprawdzić czy kamera działa
      return testCameraCapture()
        .then(testResult => {
          if (testResult) {
            console.log('[USB-CAMERA] Test kamery udany!')
          } else {
            console.log('[USB-CAMERA] Test kamery nieudany, ale kontynuuję')
          }
          return true
        })
        .catch(err => {
          console.log('[USB-CAMERA] Błąd testu kamery:', err.message)
          return true
        })
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
  // Check if buffer is valid
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    console.log(`[USB-CAMERA] ERROR: Invalid buffer for saving, type:`, 
                imageBuffer ? (Buffer.isBuffer(imageBuffer) ? 'Empty Buffer' : typeof imageBuffer) : 'null/undefined');
    return Promise.reject(new Error('Invalid image buffer'));
  }

  const debugDir = '/tmp/lamassu-camera-debug';
  const fileName = `${prefix}-${Date.now()}.jpg`;
  const filePath = `${debugDir}/${fileName}`;
  
  console.log(`[USB-CAMERA] Saving diagnostic photo to ${filePath}`);
  console.log(`[USB-CAMERA] Photo buffer type: ${Buffer.isBuffer(imageBuffer) ? 'Buffer' : typeof imageBuffer}`);
  console.log(`[USB-CAMERA] Photo buffer size: ${imageBuffer.length} bytes`);
  
  // Create directory if it doesn't exist
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
  console.log('[USB-CAMERA] Taking photo using ffmpeg')
  console.log('[USB-CAMERA] Capture options:', JSON.stringify(options))
  
  return new Promise((resolve, reject) => {
    if (!cameraDevice) {
      console.log('[USB-CAMERA] ERROR: No camera device configured')
      return reject(new Error('No camera device configured'))
    }
    
    // Logging PATH variable for troubleshooting
    console.log('[USB-CAMERA] Current PATH:', process.env.PATH || 'Not available')
    
    // Check if camera device exists before trying to take a photo
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
    console.log('[USB-CAMERA] Aktualne urządzenie kamery:', cameraDevice)
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
  
  // Funkcja bezpiecznego wywoływania callback
  const safeCallback = (err, data) => {
    try {
      callback(err, data)
    } catch (callbackErr) {
      console.log('[USB-CAMERA] BŁĄD w funkcji callback:', callbackErr.message)
    }
  }
  
  console.log('[USB-CAMERA] Używam urządzenia kamery z konfiguracji:', cameraDevice)
  
  // Sprawdź czy urządzenie istnieje - tylko sprawdzenie, bez alternatyw
  try {
    if (!fs.existsSync(cameraDevice)) {
      console.log('[USB-CAMERA] BŁĄD: Skonfigurowane urządzenie kamery nie istnieje:', cameraDevice)
      return safeCallback(new Error('Skonfigurowane urządzenie kamery nie istnieje'), null)
    }
    
    console.log('[USB-CAMERA] Skonfigurowane urządzenie kamery istnieje i zostanie użyte')
  } catch (fsErr) {
    console.log('[USB-CAMERA] Błąd podczas sprawdzania urządzenia kamery:', fsErr.message)
    return safeCallback(fsErr, null)
  }
  
  // Funkcja wewnętrzna do wykonania i przetworzenia zdjęcia
  function captureAndProcess() {
    console.log('[USB-CAMERA] Rozpoczynam proces wykonywania zdjęcia z urządzenia:', cameraDevice)
    
    // Zawsze zapisuj zdjęcia diagnostyczne
    const captureOptions = {
      ...options,
      saveDebug: true,
      debugPrefix: options.debugPrefix || 'facephoto'
    }
    
    // Używamy usprawnionej wersji capturePhotoWithFfmpeg, która obsługuje więcej opcji
    capturePhotoWithFfmpeg({ 
      device: cameraDevice,
      timeout: 15000,
      resolution: '1280x720',
      saveDebug: true
    })
    .then(buffer => {
      if (!buffer || buffer.length < 1000) {
        console.log('[USB-CAMERA] OSTRZEŻENIE: Otrzymano za mały bufor:', buffer ? buffer.length : 0, 'bajtów')
        return safeCallback(new Error('Bufor obrazu jest za mały'), null)
      }
      
      console.log('[USB-CAMERA] Zdjęcie wykonane pomyślnie, rozmiar:', buffer.length, 'bajtów')
      
      // Tworzenie kopii bufora do przesłania przez callback
      try {
        const bufferCopy = Buffer.from(buffer)
        console.log('[USB-CAMERA] Stworzono kopię bufora o rozmiarze:', bufferCopy.length, 'bajtów')
        safeCallback(null, bufferCopy)
      } catch (bufferErr) {
        console.log('[USB-CAMERA] Błąd kopiowania bufora:', bufferErr.message)
        safeCallback(null, buffer)
      }
    })
    .catch(err => {
      console.log('[USB-CAMERA] Błąd podczas wykonywania zdjęcia:', err.message)
      safeCallback(err, null)
    })
  }
  
  // Uruchom proces natychmiast lub z opóźnieniem
  if (delay > 0) {
    console.log('[USB-CAMERA] Uruchamiam wykonanie zdjęcia z opóźnieniem:', delay, 'ms')
    setTimeout(captureAndProcess, delay)
  } else {
    captureAndProcess()
  }
}

/**
 * Take face photo for Terms & Conditions display
 * @param {Function} callback - Callback function(err, imageBuffer)
 */
function takeFacePhotoTC(callback) {
  // Diagnostics - start
  try {
    fs.appendFileSync('/tmp/tc-camera-execution.log', 'takeFacePhotoTC called: ' + new Date().toISOString() + '\n');
  } catch (e) {}

  console.log('!!! [USB-CAMERA] TAKING T&C PHOTO - START - ' + new Date().toISOString());
  console.log('!!! [USB-CAMERA] tmp directory exists:', fs.existsSync('/tmp'));
  try {
    console.log('!!! [USB-CAMERA] /tmp permissions:', fs.statSync('/tmp').mode.toString(8));
  } catch (e) {
    console.log('!!! [USB-CAMERA] Error checking /tmp permissions:', e.message);
  }
  
  // Check if diagnostic directory exists, if not - try to create it
  const debugDir = '/tmp/lamassu-camera-debug';
  if (!fs.existsSync(debugDir)) {
    console.log(`!!! [USB-CAMERA] Katalog diagnostyczny nie istnieje, próbuję go utworzyć: ${debugDir}`);
    try {
      fs.mkdirSync(debugDir, { recursive: true });
      console.log(`!!! [USB-CAMERA] Pomyślnie utworzono katalog diagnostyczny: ${debugDir}`);
    } catch (mkdirErr) {
      console.log(`!!! [USB-CAMERA] Błąd tworzenia katalogu diagnostycznego: ${mkdirErr.message}`);
    }
  }
  
  // Sprawdź czy urządzenie kamery jest skonfigurowane
  if (!cameraDevice) {
    console.log('!!! [USB-CAMERA] BŁĄD: Nie skonfigurowano urządzenia kamery dla T&C');
    try {
      // Próba wykrycia dostępnych urządzeń wideo
      exec('ls -la /dev/video*', (err, stdout) => {
        if (!err) {
          console.log('!!! [USB-CAMERA] Dostępne urządzenia wideo:');
          console.log(stdout.trim());
        }
        callback(new Error('Nie skonfigurowano urządzenia kamery'), null);
      });
    } catch (e) {
      callback(new Error('Nie skonfigurowano urządzenia kamery'), null);
    }
    return;
  }
  
  // Sprawdź czy ffmpeg jest dostępny
  if (!ffmpegAvailable && ffmpegChecked) {
    console.log('!!! [USB-CAMERA] BŁĄD: ffmpeg nie jest dostępny, kamera nie będzie działać');
    callback(new Error('ffmpeg nie jest dostępny'), null);
    return;
  }
  
  // Załadowanie modułu facephoto
  let facephoto;
  try {
    facephoto = require('./compliance/flows/facephoto');
    console.log('!!! [USB-CAMERA] Moduł facephoto załadowany pomyślnie');
  } catch (facephotoErr) {
    console.log('!!! [USB-CAMERA] Błąd ładowania modułu facephoto:', facephotoErr.message);
  }
  
  // Bezpieczny wrapper dla callback
  const safeCallback = (err, buffer) => {
    try {
      // Log the result before calling callback
      try {
        fs.appendFileSync('/tmp/tc-camera-execution.log', `Callback wywoływany: błąd=${err ? 'TAK' : 'NIE'}, bufor=${buffer ? (buffer.length + ' bajtów') : 'BRAK'}\n`);
      } catch (e) {}
      
      // Try to save to facephoto module
      if (!err && buffer) {
        try {
          if (facephoto) {
            const savedBuffer = facephoto.setTCData(buffer);
            console.log('!!! [USB-CAMERA] Zdjęcie zapisane w module facephoto, rozmiar:', 
                      savedBuffer ? savedBuffer.length : 'brak danych');
          } else {
            console.log('!!! [USB-CAMERA] Moduł facephoto niedostępny, nie można zapisać zdjęcia');
          }
        } catch (faceErr) {
          console.log('!!! [USB-CAMERA] Błąd zapisu do modułu facephoto:', faceErr.message);
        }
      }
      
      callback(err, buffer);
    } catch (callbackErr) {
      console.log('!!! [USB-CAMERA] Błąd w callback takeFacePhotoTC:', callbackErr.message);
    }
  };
  
  // Wykonaj zdjęcie używając normalnej metody takeFacePhoto
  takeFacePhoto(safeCallback, {
    saveDebug: true,
    debugPrefix: 'tc-photo',
    cameraDebug: true
  });

  // Dodaj na końcu (przed return) dodatkową diagnostykę
  try {
    fs.appendFileSync('/tmp/tc-camera-execution.log', 'takeFacePhotoTC zakończony: ' + new Date().toISOString() + '\n');
  } catch (e) {}
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
  console.log('[USB-CAMERA] getDelayMS: Zwracam stałe opóźnienie 3000ms dla T&C')
  return 3000 // Stałe 3-sekundowe opóźnienie dla T&C
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

// Adding alternative photo capture method using fswebcam
function capturePhotoWithFswebcam(options = {}) {
  console.log('!!! [USB-CAMERA] USING FSWEBCAM TO CAPTURE PHOTO - ' + new Date().toISOString())
  
  return new Promise((resolve, reject) => {
    try {
      // Create temporary file
      const tmpFile = `/tmp/fswebcam-tc-${Date.now()}.jpg`
      console.log('!!! [USB-CAMERA] fswebcam temporary file:', tmpFile)
      
      // fswebcam parameters
      const fswebcamArgs = [
        '--no-banner',
        '-r', '1280x720',
        '--jpeg', '85',
        '-D', '1',
        cameraDevice,
        tmpFile
      ]
      
      console.log('!!! [USB-CAMERA] Calling command:', 'fswebcam', fswebcamArgs.join(' '))
      
      // Run fswebcam
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
        console.log('!!! [USB-CAMERA] fswebcam finished with code:', code)
        console.log('!!! [USB-CAMERA] fswebcam output:', fswebcamOutput)
        
        if (code === 0) {
          // Read file
          try {
            const imageData = fs.readFileSync(tmpFile)
            console.log('!!! [USB-CAMERA] Read image from fswebcam, size:', imageData.length, 'bytes')
            
            // Try to preserve a copy for diagnostics
            try {
              const debugPath = `/tmp/fswebcam-tc-debug-${Date.now()}.jpg`
              fs.copyFileSync(tmpFile, debugPath)
              console.log('!!! [USB-CAMERA] Saved fswebcam copy to:', debugPath)
            } catch (copyErr) {
              console.log('!!! [USB-CAMERA] Failed to save fswebcam copy:', copyErr.message)
            }
            
            // Remove temp file
            try {
              fs.unlinkSync(tmpFile)
            } catch (unlinkErr) {
              console.log('!!! [USB-CAMERA] Failed to remove temp file:', unlinkErr.message)
            }
            
            let facephoto;
            try {
              facephoto = require('./compliance/flows/facephoto');
              console.log('!!! [USB-CAMERA] facephoto module loaded successfully');
            } catch (facephotoErr) {
              console.log('!!! [USB-CAMERA] Failed to load facephoto module:', facephotoErr.message);
            }
            
            if (imageData && imageData.length >= 1000 && facephoto) {
              try {
                const savedBuffer = facephoto.setTCData(imageData);
                console.log('!!! [USB-CAMERA] Image saved to facephoto, size:', 
                           savedBuffer ? savedBuffer.length : 'no data');
              } catch (facephotoErr) {
                console.log('!!! [USB-CAMERA] Error saving to facephoto:', facephotoErr.message);
              }
            }
            
            return resolve(imageData)
          } catch (readErr) {
            console.log('!!! [USB-CAMERA] Error reading fswebcam file:', readErr.message)
            reject(readErr)
          }
        } else {
          console.log('!!! [USB-CAMERA] fswebcam finished with error, code:', code)
          reject(new Error(`fswebcam finished with code ${code}`))
        }
      })
      
      fswebcam.on('error', (err) => {
        console.log('!!! [USB-CAMERA] Error starting fswebcam:', err.message)
        reject(err)
      })
    } catch (err) {
      console.log('!!! [USB-CAMERA] General fswebcam error:', err.message)
      reject(err)
    }
  })
}

// Adding diagnostic logging to file
function logToFile(message) {
  try {
    const fs = require('fs');
    fs.appendFileSync('/tmp/tc-camera-debug.log', '[USB-CAMERA] ' + message + '\n');
  } catch (e) {
    console.log('[USB-CAMERA] Error writing to diagnostic file:', e.message);
  }
}

// Modified alternative photo taking function that tries different locations
function takeFacePhotoTCAlternative(callback) {
  console.log('!!! [USB-CAMERA] RUNNING ALTERNATIVE METHOD FOR T&C PHOTO')
  logToFile('RUNNING ALTERNATIVE METHOD FOR T&C - ' + new Date().toISOString());
  
  // Let's add facephoto module import
  // ... (reszta funkcji takeFacePhotoTCAlternative)
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
  capturePhotoWithFswebcam, // Eksport funkcji pomocniczej
  logToFile            // Funkcja do logowania diagnostycznego
} 