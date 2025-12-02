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

// Helper function to convert text to buffer
const textToBuffer = (text) => Buffer.from(text)

// Function to print to USB device
const printToUSB = (device, buffer) => {
  return new Promise((resolve, reject) => {
    try {
      console.log('[PRINTER] Using CUPS to print to:', device)
      
      // Save data to temporary file
      const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.bin`)
      fs.writeFileSync(tempFile, buffer)
      
      // Send to printer via CUPS
      exec(`lp -d "${device}" ${tempFile}`, (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tempFile) // Remove temporary file
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
  
  // Default values for receiptConfig
  const config = receiptConfig || {}
  
  return new Promise((resolve, reject) => {
    try {
      // Check if data exists
      if (!data) {
        console.error('[PRINTER] Error: data is undefined')
        return reject(new Error('Data is undefined'))
      }
      
      const cmd = []

      // Printer initialization
      cmd.push(initialize)
      
      // Receipt header with extra spacing
      cmd.push(alignCenter)
      cmd.push(fontSizeLarge)
      cmd.push(emphasizedOn)
      cmd.push('POTWIERDZENIE\n')
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      cmd.push('\n') // Extra spacing after header
      
      // Operator data from back office
      if (data.operatorInfo) {
        if (data.operatorInfo.name) {
          cmd.push(data.operatorInfo.name + '\n')
        }
        
        if (data.operatorInfo.website && config.operatorWebsite) {
          cmd.push(data.operatorInfo.website + '\n')
        }
        
        if (data.operatorInfo.email && config.operatorEmail) {
          cmd.push(data.operatorInfo.email + '\n')
        }
        
        if (data.operatorInfo.phone && config.operatorPhone) {
          cmd.push('Tel: ' + data.operatorInfo.phone + '\n')
        }
        
        if (data.operatorInfo.companyNumber && config.companyNumber) {
          cmd.push(data.operatorInfo.companyNumber + '\n')
        }
        
        cmd.push('\n')
      }
      
      if (data.location && config.machineLocation) {
        cmd.push('Lokalizacja: ' + data.location + '\n')
      }
      
      cmd.push('\n')
      
      // Transaction details
      cmd.push(alignLeft)
      
      if (data.time) {
        cmd.push('Data: ' + data.time + '\n')
      } else if (data.timestamp) {
        cmd.push('Data: ' + data.timestamp + '\n')
      } else {
        cmd.push('Data: ' + new Date().toISOString() + '\n')
      }
      
      if (data.session) {
        cmd.push('ID Transakcji: ' + data.session + '\n')
      } else if (data.txId) {
        cmd.push('ID Transakcji: ' + data.txId + '\n')
      }
      
      // Display customer data only if enabled in config and not "Anonymous"
      if (config.customerNameOrPhoneNumber) {
        if (data.customer && data.customer !== 'Anonymous') {
          cmd.push('Klient: ' + data.customer + '\n')
        } else if (data.customerName && data.customerName !== 'Anonymous') {
          cmd.push('Klient: ' + data.customerName + '\n')
        }
        
        if (data.customerPhone) {
          cmd.push('Telefon: ' + data.customerPhone + '\n')
        }
      }
      
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push(emphasizedOn)
      
      if (data.direction === 'cashIn' || data.direction === 'Cash-in') {
        cmd.push('ZAKUP\n')
      } else if (data.direction === 'cashOut' || data.direction === 'Cash-out') {
        cmd.push('SPRZEDAZ\n') // Without Polish characters
      }
      
      cmd.push(emphasizedOff)
      cmd.push('\n')
      cmd.push(alignLeft)
      
      if (data.fiat) {
        cmd.push('Kwota FIAT: ' + data.fiat + '\n')
      }
      
      if (data.crypto) {
        cmd.push('Kwota krypto: ' + data.crypto + '\n')
      }
      
      if (data.rate && config.exchangeRate) {
        cmd.push('Kurs wymiany: ' + data.rate + '\n')
      }
      
      // Print address with spaces every 4 characters (only if addressQRCode is enabled)
      if (data.address && config.addressQRCode) {
        cmd.push('\n')
        cmd.push(alignCenter)
        cmd.push(emphasizedOn)
        cmd.push('--- ADRES PORTFELA ---\n')
        cmd.push(emphasizedOff)
        
        // Format address with spaces every 4 characters
        let formattedAddress = '';
        for (let i = 0; i < data.address.length; i++) {
          formattedAddress += data.address[i];
          if ((i + 1) % 4 === 0 && i !== data.address.length - 1) {
            formattedAddress += ' ';
          }
        }
        
        // Print formatted address in multiple lines for readability
        const maxLineLength = 32; // Maximum line length for printer
        for (let i = 0; i < formattedAddress.length; i += maxLineLength) {
          cmd.push(formattedAddress.substring(i, i + maxLineLength) + '\n');
        }
        
        cmd.push('--- KONIEC ADRESU ---\n')
        cmd.push(alignLeft)
        cmd.push(lineFeed)
      }
      
      if (data.confirmations !== undefined) {
        cmd.push('Potwierdzenia: ' + data.confirmations + '\n')
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
      cmd.push('Dziekujemy za skorzystanie z naszych uslug!\n') // Without Polish characters
      
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
      // Check if data exists
      if (!data) {
        console.error('[PRINTER] Error: data is undefined')
        return reject(new Error('Data is undefined'))
      }
      
      const cmd = []

      // Printer initialization
      cmd.push(initialize)
      
      // Header
      cmd.push(alignCenter)
      cmd.push(fontSizeLarge)
      cmd.push(emphasizedOn)
      cmd.push('POKWITOWANIE\n')
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      cmd.push('\n')
      
      // Operator data from back office
      if (data.operatorInfo) {
        if (data.operatorInfo.name) {
          cmd.push(data.operatorInfo.name + '\n')
        }
        
        if (data.operatorInfo.phone) {
          cmd.push('Tel: ' + data.operatorInfo.phone + '\n')
        }
        
        if (data.operatorInfo.email) {
          cmd.push(data.operatorInfo.email + '\n')
        }
        
        if (data.operatorInfo.website) {
          cmd.push(data.operatorInfo.website + '\n')
        }
        
        if (data.operatorInfo.companyNumber) {
          cmd.push(data.operatorInfo.companyNumber + '\n')
        }
        
        cmd.push('\n')
      }
      
      // Transaction details
      cmd.push(alignLeft)
      
      if (data.batch) {
        if (data.batch.created) {
          cmd.push('Data: ' + data.batch.created + '\n')
        }
        
        if (data.batch.id && data.batch.operationType) {
          cmd.push('Tryb: automatyczny\n')
          cmd.push('ID Partii: ' + data.batch.id + '\n')
        } else {
          cmd.push('Tryb: reczny\n')
        }
        
        if (data.batch.deviceId) {
          cmd.push('ID Maszyny: ' + data.batch.deviceId + '\n')
        }
        
        if (data.batch.machineName) {
          cmd.push('Nazwa maszyny: ' + data.batch.machineName + '\n')
        }
        
        if (data.batch.billCount) {
          cmd.push('\n')
          cmd.push('Liczba banknotow: ' + data.batch.billCount + '\n')
        }
        
        if (data.batch.fiatTotals) {
          cmd.push('\n')
          cmd.push('Suma wedlug waluty:\n')
          cmd.push('---------------------\n')
          const totals = Object.keys(data.batch.fiatTotals).map(key => 
            key + ': ' + data.batch.fiatTotals[key]
          ).join(' | ')
          cmd.push(totals + '\n')
        }
        
        if (data.batch.billsByDenomination) {
          cmd.push('\n')
          cmd.push('Banknoty wg nominalu:\n')
          cmd.push('---------------------\n')
          Object.keys(data.batch.billsByDenomination).forEach(key => {
            cmd.push(key + ': ' + data.batch.billsByDenomination[key] + '\n')
          })
        }
      } else {
        // Fallback for legacy data format
        if (data.timestamp) {
          cmd.push('Data: ' + data.timestamp + '\n')
        } else {
          cmd.push('Data: ' + new Date().toISOString() + '\n')
        }
        
        if (data.txId) {
          cmd.push('ID Transakcji: ' + data.txId + '\n')
        }
        
        if (data.customerName) {
          cmd.push('Klient: ' + data.customerName + '\n')
        }
        
        if (data.customerPhone) {
          cmd.push('Telefon: ' + data.customerPhone + '\n')
        }
        
        cmd.push('\n')
        cmd.push(alignCenter)
        cmd.push(emphasizedOn)
        
        if (data.direction === 'cashIn' || data.direction === 'Cash-in') {
          cmd.push('WPLATA\n')
        } else if (data.direction === 'cashOut' || data.direction === 'Cash-out') {
          cmd.push('WYPLATA\n')
        }
        
        cmd.push(emphasizedOff)
        cmd.push('\n')
        cmd.push(alignLeft)
        
        if (data.fiat) {
          cmd.push('Kwota FIAT: ' + data.fiat + '\n')
        }
        
        if (data.crypto) {
          cmd.push('Kwota krypto: ' + data.crypto + '\n')
        }
        
        if (data.rate) {
          cmd.push('Kurs wymiany: ' + data.rate + '\n')
        }
        
        if (data.bills && data.bills.length > 0) {
          cmd.push('\nWprowadzone banknoty:\n')
          data.bills.forEach(bill => {
            cmd.push('- ' + bill.fiat + ' ' + bill.currency + '\n')
          })
        }
        
        // Signature field for cash out
        if (data.direction === 'cashOut') {
          cmd.push('\n\n')
          cmd.push('Podpis klienta: ______________________\n')
          cmd.push('\n')
          cmd.push('Potwierdzam odbior powyzszej kwoty.\n')
        }
      }
      
      // Footer
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push('Dziekujemy za skorzystanie z naszych uslug!\n')
      
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
      // Check if wallet exists
      if (!wallet) {
        console.error('[PRINTER] Error: wallet is undefined')
        return reject(new Error('Wallet is undefined'))
      }
      
      // Check if wallet has required properties
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
      cmd.push((code || '') + ' PORTFEL PAPIEROWY\n')
      cmd.push(emphasizedOff)
      cmd.push(fontSizeNormal)
      cmd.push('\n')
      
      // Wallet details
      cmd.push(alignLeft)
      cmd.push('Data: ' + new Date().toISOString() + '\n')
      cmd.push('Waluta: ' + (code || 'Nieznana') + '\n\n')
      
      // Print public address as text
      cmd.push(alignCenter)
      cmd.push(emphasizedOn)
      cmd.push('--- ADRES PUBLICZNY ---\n')
      cmd.push(emphasizedOff)
      
      // Format address with spaces every 4 characters
      let formattedAddress = '';
      for (let i = 0; i < wallet.address.length; i++) {
        formattedAddress += wallet.address[i];
        if ((i + 1) % 4 === 0 && i !== wallet.address.length - 1) {
          formattedAddress += ' ';
        }
      }
      
      // Print formatted address in multiple lines for readability
      const maxLineLength = 32; // Maximum line length for printer
      for (let i = 0; i < formattedAddress.length; i += maxLineLength) {
        cmd.push(formattedAddress.substring(i, i + maxLineLength) + '\n');
      }
      
      cmd.push('--- KONIEC ADRESU PUBLICZNEGO ---\n')
      cmd.push(alignLeft)
      cmd.push('\n\n')
      
      // Print private key as text
      cmd.push(alignCenter)
      cmd.push(emphasizedOn)
      cmd.push('--- KLUCZ PRYWATNY ---\n')
      cmd.push(emphasizedOff)
      
      // Format private key with spaces every 4 characters
      let formattedPrivateKey = '';
      for (let i = 0; i < wallet.privateKey.length; i++) {
        formattedPrivateKey += wallet.privateKey[i];
        if ((i + 1) % 4 === 0 && i !== wallet.privateKey.length - 1) {
          formattedPrivateKey += ' ';
        }
      }
      
      // Print formatted private key in multiple lines
      for (let i = 0; i < formattedPrivateKey.length; i += maxLineLength) {
        cmd.push(formattedPrivateKey.substring(i, i + maxLineLength) + '\n');
      }
      
      cmd.push('--- KONIEC KLUCZA PRYWATNEGO ---\n')
      cmd.push(alignLeft)
      cmd.push(lineFeed)
      
      // Footer
      cmd.push('\n')
      cmd.push(alignCenter)
      cmd.push('Dziekujemy za skorzystanie z naszych uslug!\n')
      
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
      
      // Always check printer status via CUPS
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