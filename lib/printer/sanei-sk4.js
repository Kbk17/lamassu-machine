const _ = require('lodash/fp')
const fs = require('fs')
const { exec } = require('child_process')
const path = require('path')
const os = require('os')

// ESC/POS commands for Sanei SK4-21 printer
const lineFeed = Buffer.from([0x0a])
const finalLineFeed = Buffer.from([0x1b, 0x64, 0x05])  // ESC d 5 - feed 5 lines
const fullCut = Buffer.from([0x1d, 0x56, 0x41, 0x03])  // GS V A 3 - full cut with 3 lines feed
const initialize = Buffer.from([0x1b, 0x40])  // ESC @ - printer initialization
const alignCenter = Buffer.from([0x1b, 0x61, 0x01])  // ESC a 1 - center alignment
const alignLeft = Buffer.from([0x1b, 0x61, 0x00])  // ESC a 0 - left alignment
const emphasizedOn = Buffer.from([0x1b, 0x45, 0x01])  // ESC E 1 - enable bold
const emphasizedOff = Buffer.from([0x1b, 0x45, 0x00])  // ESC E 0 - disable bold
const fontSizeNormal = Buffer.from([0x1d, 0x21, 0x00])  // GS ! 0 - normal font size
const fontSizeLarge = Buffer.from([0x1d, 0x21, 0x11])  // GS ! 17 - double height and width

// Funkcja do drukowania kodu QR
const printQRCode = (cmd, str) => {
  // Sprawdź, czy str istnieje i jest stringiem
  if (!str || typeof str !== 'string') {
    console.error('[PRINTER] Error: Invalid QR code data:', str)
    return
  }
  
  try {
    // Format komend ESC/POS dla kodów QR używany przez drukarki Epson
    // Ten format jest najbardziej rozpowszechniony i powinien działać na większości drukarek
    
    // Drukujemy tekst przed kodem QR
    cmd.push(alignCenter)
    cmd.push('Scan this QR code:\n')
    
    // Inicjalizacja drukarki
    cmd.push(initialize)
    
    // 1. Wybór modelu kodu QR (model 2)
    cmd.push(Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]))
    
    // 2. Ustawienie rozmiaru kodu QR (rozmiar 4)
    cmd.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04]))
    
    // 3. Ustawienie poziomu korekcji błędów (poziom L: 48)
    cmd.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30]))
    
    // 4. Przesłanie danych do kodu QR
    // Ograniczamy długość danych do 100 znaków, aby zmieścić się na paragonie
    const qrData = str.substring(0, 100)
    const dataLength = qrData.length + 3
    const pL = dataLength % 256
    const pH = Math.floor(dataLength / 256)
    
    cmd.push(Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]))
    cmd.push(Buffer.from(qrData))
    
    // 5. Drukowanie kodu QR
    cmd.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]))
    
    // Dodanie linii odstępu po kodzie QR
    cmd.push(lineFeed)
    cmd.push(lineFeed)
    
    // Drukujemy pełny tekst pod kodem QR
    cmd.push(fontSizeNormal)
    cmd.push(alignLeft)
    
    // Drukujemy adres w kilku liniach, aby był czytelny
    const maxLineLength = 32 // Maksymalna długość linii dla drukarki
    for (let i = 0; i < str.length; i += maxLineLength) {
      cmd.push(str.substring(i, i + maxLineLength) + '\n')
    }
    
    cmd.push(lineFeed)
  } catch (err) {
    console.error('[PRINTER] Error generating QR code:', err.message)
    
    // Fallback - drukujemy tylko tekst
    cmd.push(alignCenter)
    cmd.push(emphasizedOn)
    cmd.push('--- ADDRESS DATA ---\n')
    cmd.push(emphasizedOff)
    
    // Drukujemy adres w kilku liniach, aby był czytelny
    const maxLineLength = 32 // Maksymalna długość linii dla drukarki
    for (let i = 0; i < str.length; i += maxLineLength) {
      cmd.push(str.substring(i, i + maxLineLength) + '\n')
    }
    
    cmd.push('--- END ADDRESS DATA ---\n')
    cmd.push(alignLeft)
    cmd.push(lineFeed)
  }
}

// Helper function to convert text to buffer
const textToBuffer = (text) => Buffer.from(text)

// Function to print to USB device
const printToUSB = (device, buffer) => {
  return new Promise((resolve, reject) => {
    try {
      console.log('[PRINTER] Using CUPS to print to:', device)
      
      // Zapisz dane do pliku tymczasowego
      const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.bin`)
      fs.writeFileSync(tempFile, buffer)
      
      // Wyślij do drukarki przez CUPS
      exec(`lp -d "${device}" ${tempFile}`, (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tempFile) // Usuń plik tymczasowy
        } catch (e) {
          console.error('[PRINTER] Error removing temp file:', e.message)
        }
        
        if (error) {
          console.error('[PRINTER] CUPS print error:', error.message)
          return reject(new Error(`CUPS printing failed: ${error.message}`))
        }
        
        console.log('[PRINTER] Successfully printed via CUPS')
        resolve()
      })
    } catch (err) {
      console.error('[PRINTER] Error in printToUSB:', err.message)
      reject(err)
    }
  })
}

// Function to build buffer from commands and text
const buildBuffer = (commands) => {
  return Buffer.concat(commands.map(cmd => {
    if (Buffer.isBuffer(cmd)) return cmd
    if (Array.isArray(cmd)) return Buffer.from(cmd)
    return textToBuffer(cmd)
  }))
}

// Function to print receipt
const printReceipt = (data, printerCfg, receiptConfig) => {
  const device = printerCfg.address || 'SANEI-SK4-21-Series'
  console.log('[PRINTER] Printing receipt on device:', device)
  
  return new Promise((resolve, reject) => {
    try {
      // Sprawdź, czy data istnieje
      if (!data) {
        console.error('[PRINTER] Error: data is undefined')
        return reject(new Error('Data is undefined'))
      }
      
      const cmd = []

      // Printer initialization
      cmd.push(initialize)
      
      // Receipt header
      cmd.push(alignCenter)
      cmd.push(fontSizeLarge)
      cmd.push(emphasizedOn)
      
      // Sprawdź, czy data.operatorInfo istnieje
      if (data.operatorInfo && data.operatorInfo.name) {
        cmd.push(data.operatorInfo.name + '\n')
      } else {
        cmd.push('Receipt\n')
      }
      
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      
      if (data.operatorInfo && data.operatorInfo.address) {
        cmd.push(data.operatorInfo.address + '\n')
      }
      
      if (data.operatorInfo && data.operatorInfo.city) {
        cmd.push(data.operatorInfo.city + '\n')
      }
      
      if (data.operatorInfo && data.operatorInfo.phone) {
        cmd.push('Tel: ' + data.operatorInfo.phone + '\n')
      }
      
      if (data.operatorInfo && data.operatorInfo.email) {
        cmd.push('Email: ' + data.operatorInfo.email + '\n')
      }
      
      if (data.operatorInfo && data.operatorInfo.website) {
        cmd.push('Web: ' + data.operatorInfo.website + '\n')
      }
      
      cmd.push('\n')
      
      // Transaction details
      cmd.push(alignLeft)
      
      if (data.time) {
        cmd.push('Date: ' + data.time + '\n')
      } else if (data.timestamp) {
        cmd.push('Date: ' + data.timestamp + '\n')
      } else {
        cmd.push('Date: ' + new Date().toISOString() + '\n')
      }
      
      if (data.session) {
        cmd.push('Transaction ID: ' + data.session + '\n')
      } else if (data.txId) {
        cmd.push('Transaction ID: ' + data.txId + '\n')
      }
      
      if (data.customer) {
        cmd.push('Customer: ' + data.customer + '\n')
      } else if (data.customerName) {
        cmd.push('Customer: ' + data.customerName + '\n')
      }
      
      if (data.customerPhone) {
        cmd.push('Phone: ' + data.customerPhone + '\n')
      }
      
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push(emphasizedOn)
      
      if (data.direction === 'cashIn') {
        cmd.push('PURCHASE\n')
      } else if (data.direction === 'cashOut') {
        cmd.push('SALE\n')
      }
      
      cmd.push(emphasizedOff)
      cmd.push('\n')
      cmd.push(alignLeft)
      
      if (data.fiat) {
        cmd.push('Fiat amount: ' + data.fiat + '\n')
      }
      
      if (data.crypto) {
        cmd.push('Crypto amount: ' + data.crypto + '\n')
      }
      
      if (data.rate) {
        cmd.push('Exchange rate: ' + data.rate + '\n')
      }
      
      if (data.address) {
        cmd.push('\nAddress: ' + data.address + '\n')
      }
      
      if (data.confirmations !== undefined) {
        cmd.push('Confirmations: ' + data.confirmations + '\n')
      }
      
      // Drukowanie kodu QR adresu, jeśli jest dostępny
      // Domyślnie włącz drukowanie kodu QR, jeśli adres jest dostępny
      const shouldPrintQR = receiptConfig ? receiptConfig.addressQRCode !== false : true
      
      if (data.address && shouldPrintQR) {
        try {
          console.log('[PRINTER] Printing QR code for address:', data.address)
          cmd.push('\n')
          cmd.push(alignCenter)
          cmd.push('Scan QR code for address:\n')
          printQRCode(cmd, data.address)
          cmd.push('\n')
        } catch (err) {
          console.error('[PRINTER] Error printing QR code:', err.message)
          // Kontynuuj drukowanie paragonu nawet jeśli drukowanie kodu QR się nie powiedzie
        }
      }
      
      // Custom receipt message
      if (receiptConfig && receiptConfig.receiptMessage) {
        cmd.push('\n')
        cmd.push(alignCenter)
        cmd.push(receiptConfig.receiptMessage + '\n')
      }
      
      // Footer
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push('Thank you for using our services!\n')
      
      // Ending and cutting
      cmd.push(finalLineFeed)
      cmd.push(fullCut)
      
      // Convert commands to buffer
      const buffer = buildBuffer(cmd)
      
      printToUSB(device, buffer)
        .then(() => {
          console.log('[PRINTER] Receipt printed successfully')
          resolve()
        })
        .catch(err => {
          console.error('[PRINTER] Error printing receipt:', err.message)
          reject(err)
        })
    } catch (err) {
      console.error('[PRINTER] Critical error during receipt preparation:', err.message)
      reject(err)
    }
  })
}

// Function to print cashbox receipt
const printCashboxReceipt = (data, printerCfg) => {
  const device = printerCfg.address || 'SANEI-SK4-21-Series'
  console.log('[PRINTER] Printing cashbox receipt on device:', device)
  
  return new Promise((resolve, reject) => {
    try {
      const cmd = []

      // Printer initialization
      cmd.push(initialize)
      
      // Header
      cmd.push(alignCenter)
      cmd.push(fontSizeLarge)
      cmd.push(emphasizedOn)
      cmd.push('CASHBOX RECEIPT\n')
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      cmd.push('\n')
      
      // Transaction details
      cmd.push(alignLeft)
      
      if (data.timestamp) {
        cmd.push('Date: ' + data.timestamp + '\n')
      } else {
        cmd.push('Date: ' + new Date().toISOString() + '\n')
      }
      
      if (data.txId) {
        cmd.push('Transaction ID: ' + data.txId + '\n')
      }
      
      if (data.operatorInfo && data.operatorInfo.name) {
        cmd.push('Operator: ' + data.operatorInfo.name + '\n')
      }
      
      if (data.customerName) {
        cmd.push('Customer: ' + data.customerName + '\n')
      }
      
      if (data.customerPhone) {
        cmd.push('Phone: ' + data.customerPhone + '\n')
      }
      
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push(emphasizedOn)
      
      if (data.direction === 'cashIn') {
        cmd.push('CASH IN\n')
      } else if (data.direction === 'cashOut') {
        cmd.push('CASH OUT\n')
      }
      
      cmd.push(emphasizedOff)
      cmd.push('\n')
      cmd.push(alignLeft)
      
      if (data.fiat) {
        cmd.push('Fiat amount: ' + data.fiat + '\n')
      }
      
      if (data.crypto) {
        cmd.push('Crypto amount: ' + data.crypto + '\n')
      }
      
      if (data.rate) {
        cmd.push('Exchange rate: ' + data.rate + '\n')
      }
      
      if (data.bills && data.bills.length > 0) {
        cmd.push('\nBills inserted:\n')
        data.bills.forEach(bill => {
          cmd.push('- ' + bill.fiat + ' ' + bill.currency + '\n')
        })
      }
      
      // Signature field for cash out
      if (data.direction === 'cashOut') {
        cmd.push('\n\n')
        cmd.push('Customer signature: ______________________\n')
        cmd.push('\n')
        cmd.push('I confirm receipt of the above amount.\n')
      }
      
      // Ending and cutting
      cmd.push(finalLineFeed)
      cmd.push(fullCut)
      
      // Convert commands to buffer
      const buffer = buildBuffer(cmd)
      
      printToUSB(device, buffer)
        .then(() => {
          console.log('[PRINTER] Cashbox receipt printed successfully')
          resolve()
        })
        .catch(err => {
          console.error('[PRINTER] Error printing cashbox receipt:', err.message)
          reject(err)
        })
    } catch (err) {
      console.error('[PRINTER] Critical error during cashbox receipt preparation:', err.message)
      reject(err)
    }
  })
}

// Function to print paper wallet
const printWallet = (wallet, printerCfg, code) => {
  const device = printerCfg.address || 'SANEI-SK4-21-Series'
  console.log('[PRINTER] Printing paper wallet on device:', device)
  
  return new Promise((resolve, reject) => {
    try {
      // Sprawdź, czy wallet istnieje
      if (!wallet) {
        console.error('[PRINTER] Error: wallet is undefined')
        return reject(new Error('Wallet is undefined'))
      }
      
      // Sprawdź, czy wallet ma wymagane właściwości
      if (!wallet.address || !wallet.privateKey) {
        console.error('[PRINTER] Error: wallet is missing required properties')
        return reject(new Error('Wallet is missing required properties'))
      }
      
      const cmd = []

      // Printer initialization
      cmd.push(initialize)
      
      // Header
      cmd.push(alignCenter)
      cmd.push(fontSizeLarge)
      cmd.push(emphasizedOn)
      cmd.push('PAPER WALLET\n')
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      cmd.push('\n')
      
      // Wallet details
      cmd.push(alignLeft)
      cmd.push('Date: ' + new Date().toISOString() + '\n')
      cmd.push('Currency: ' + (code || 'Unknown') + '\n\n')
      
      cmd.push(alignCenter)
      cmd.push('PUBLIC ADDRESS\n')
      cmd.push(wallet.address + '\n\n')
      
      // Drukowanie kodu QR adresu publicznego
      try {
        console.log('[PRINTER] Printing QR code for public address:', wallet.address)
        cmd.push('Scan QR code for public address:\n')
        printQRCode(cmd, wallet.address)
        cmd.push('\n\n')
      } catch (err) {
        console.error('[PRINTER] Error printing QR code for public address:', err.message)
        cmd.push('\n\n')
      }
      
      cmd.push('PRIVATE KEY\n')
      cmd.push(wallet.privateKey + '\n\n')
      
      // Drukowanie kodu QR klucza prywatnego
      try {
        console.log('[PRINTER] Printing QR code for private key')
        cmd.push('Scan QR code for private key:\n')
        printQRCode(cmd, wallet.privateKey)
        cmd.push('\n')
      } catch (err) {
        console.error('[PRINTER] Error printing QR code for private key:', err.message)
        cmd.push('\n')
      }
      
      // Ending and cutting
      cmd.push(finalLineFeed)
      cmd.push(fullCut)
      
      // Convert commands to buffer
      const buffer = buildBuffer(cmd)
      
      printToUSB(device, buffer)
        .then(() => {
          console.log('[PRINTER] Paper wallet printed successfully')
          resolve()
        })
        .catch(err => {
          console.error('[PRINTER] Error printing paper wallet:', err.message)
          reject(err)
        })
    } catch (err) {
      console.error('[PRINTER] Critical error during paper wallet preparation:', err.message)
      reject(err)
    }
  })
}

// Function to check printer status
const checkStatus = (printerCfg, timeout = 5000) => {
  return new Promise((resolve) => {
    console.log('[PRINTER] Checking Sanei SK4-21 printer status')
    
    try {
      const printerName = printerCfg?.address || 'SANEI-SK4-21-Series'
      
      // Zawsze sprawdzaj status drukarki przez CUPS
      console.log('[PRINTER] Checking printer status via CUPS for:', printerName)
      
      exec(`lpstat -p "${printerName}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('[PRINTER] CUPS status error:', error.message)
          return resolve({ status: 'error', message: `Cannot check printer status: ${error.message}`, hasErrors: true })
        }
        
        if (stdout.includes('disabled') || stdout.includes('error')) {
          console.error('[PRINTER] Printer is disabled or has errors:', stdout)
          return resolve({ status: 'error', message: 'Printer is disabled or has errors', hasErrors: true })
        }
        
        console.log('[PRINTER] Printer is available via CUPS')
        return resolve({ status: 'ok', hasErrors: false })
      })
    } catch (err) {
      console.error('[PRINTER] Error checking printer status:', err.message)
      resolve({ status: 'error', message: err.message, hasErrors: true })
    }
  })
}

module.exports = {
  printReceipt,
  printCashboxReceipt,
  printWallet,
  checkStatus
}