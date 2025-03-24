# Lamassu Machine - Technical Documentation

## Table of Contents
1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Detailed Project Structure](#detailed-project-structure)
4. [Key Processes](#key-processes)
5. [Transaction Flow](#transaction-flow)
6. [Server Communication](#server-communication)
7. [System Configuration](#system-configuration)
8. [Installation and Launch Procedures](#installation-and-launch-procedures)
9. [Test Modes and Debugging](#test-modes-and-debugging)
10. [Peripheral Device Management](#peripheral-device-management)

## Introduction

Lamassu Machine is a comprehensive software system designed to operate Lamassu cryptocurrency ATMs. The project enables two-way exchange between cryptocurrencies and traditional fiat currencies, handling both cash deposits (cryptocurrency purchases) and withdrawals (cryptocurrency sales). The system has been designed with a modular approach, allowing for flexible integration with various hardware components and adaptation to different regulatory requirements across jurisdictions.

## System Architecture

The Lamassu Machine system is built around a central module called "Brain", which coordinates all other components and manages business logic. The architecture is based on an event-driven model, where different components communicate by emitting and listening to events.

### Main Architectural Components:

1. **Brain** - Central control module, implemented in `lib/brain.js`
   - Manages machine state and state transitions
   - Coordinates communication between different modules
   - Handles transaction business logic

2. **Bill Validators** - Components for accepting and verifying cash
   - Supported models: CashflowSC, ID003, BNR, CCNet, F56, and others
   - Implementation in the `lib/{model}` directory, e.g., `lib/id003/`

3. **Bill Dispensers** - Components for dispensing cash
   - Supported models: F56, Puloon, HCM2, Genmega
   - Implementation in the `lib/{model}` directory, e.g., `lib/puloon/`

4. **User Interface** - Interactive frontend for customers
   - Implementation in the `ui/` directory
   - Technologies: HTML, CSS, JavaScript with Babel transpilation

5. **Communication Module (Trader)** - Manages communication with the Lamassu server
   - Implementation in `lib/trader.js`
   - Handles GraphQL queries and WebSocket connections

6. **Compliance Module** - Manages KYC/AML processes
   - Implementation in the `lib/compliance/` directory
   - Handles SMS verification, email, ID document scanning, etc.

7. **Peripheral Modules** - Components for handling additional devices
   - QR scanner (`lib/scanner.js`, `lib/scanner-newland.js`, `lib/scanner-genmega.js`)
   - Receipt printer (`lib/printer/`)
   - Camera (`lib/camera-streamer.js`)
   - LED system (`lib/leds/`)

8. **Update Module** - Manages software updates
   - Implementation in the `lib/update/` directory

## Detailed Project Structure

### Main Directories:

#### `/bin` - Executable Scripts
- `lamassu-machine` - Main executable file, application entry point
- `fake-bills.js` - Bill validator simulator for testing

#### `/lib` - Main Business Logic
- `brain.js` - Central control module
- `trader.js` - Communication with the Lamassu server
- `/compliance/` - Functions related to KYC/AML processes
- `/id003/`, `/f56/`, `/mei/`, `/ccnet/`, `/puloon/` - Drivers for various peripheral devices
- `/update/` - Functions for software updates
- `/mocks/` - Simulators for various components (for testing)

#### `/ui` - User Interface
- `/src/` - JavaScript source code for the interface
- `/html/` - HTML templates
- `/css/` - CSS/SCSS styles
- `/images/` - Graphical assets
- `/sounds/` - Sound assets
- `start.html` - Main user interface page

#### `/i18n` - Localization and Internationalization
- Translation files for various languages
- Scripts for processing and compiling translations

#### `/hardware` - Low-level Hardware Drivers
- Drivers for Lamassu-specific devices
- Configuration and communication with hardware components

#### `/deploy` - Deployment Tools
- Scripts and configurations for system deployment on devices

#### `/build-scripts` - Build Scripts
- Scripts for building and packaging the project

#### `/data` - Application Data
- Local data stores
- Configuration files for production mode

#### Other Directories:
- `/test/` - Unit and integration tests
- `/tools/` - Helper tools for developers
- `/mock_data/` - Test data
- `/verify/` - Tools for installation and operation verification

### Key Files:

- `device_config.json` - Main configuration for a specific device
- `package.json` - Definition of dependencies and npm scripts
- `setup.sh` - Initial configuration script
- `watchdog.js` - Script monitoring application operation
- `Dockerfile` - Configuration for building a Docker container

## Key Processes

### Startup Process

1. The `bin/lamassu-machine` file is run
2. Configuration is loaded from `device_config.json`
3. The Brain module (`lib/brain.js`) is initialized
4. Brain initializes other modules depending on the configuration
5. The user interface is loaded and displayed on the screen
6. The system transitions to a state waiting for user action

### Server Pairing Process

1. Administrator generates a pairing token in the Lamassu server admin panel
2. The token is entered during machine startup using the `--mockPair` flag
3. The `lib/pairing.js` module creates a key pair and exchanges them with the server
4. After successful pairing, the keys are saved and used for encrypted communication

### Software Update

1. The Lamassu server sends a notification about an available update
2. The `lib/update` module downloads the update package
3. The package is verified using Lamassu's public key
4. The update is installed and the system is restarted

## Transaction Flow

### Cryptocurrency Purchase (Cash-in)

1. **Initialization**
   - User selects cryptocurrency to purchase
   - System connects to the server to get the current exchange rate

2. **Customer Identification** (optional, depending on configuration)
   - System may require scanning an ID document
   - Verification via SMS or email
   - Checking against sanction lists

3. **Cash Deposit**
   - User inserts bills into the validator
   - Bills are verified and accepted or rejected
   - System updates the transaction amount in real-time

4. **Transaction Finalization**
   - User scans their wallet QR code or enters an address
   - System confirms the transaction with the server
   - Confirmation is printed (if configured)

### Cryptocurrency Sale (Cash-out)

1. **Initialization**
   - User selects the amount to withdraw
   - System generates an address to send cryptocurrency to

2. **Customer Identification**
   - Similar to purchase, with potentially higher requirements

3. **Payment Verification**
   - User sends cryptocurrency to the generated address
   - System waits for transaction confirmation

4. **Cash Dispensing**
   - System activates the bill dispenser
   - Cash is dispensed to the user
   - Confirmation is printed

## Server Communication

The system communicates with the Lamassu server using the following channels:

1. **GraphQL API** - Used for most operations, such as:
   - Retrieving exchange rates
   - Transmitting transaction data
   - Confirming transactions
   - Implementation in `lib/graphql-client.js`

2. **WebSocket** - Used for real-time communication:
   - Update notifications
   - Machine status monitoring
   - Implementation as part of `lib/trader.js`

3. **HTTPS** - Used for:
   - Downloading software updates
   - Sending logs and diagnostic data
   - Implementation in `lib/request.js`

Communication is secured using TLS with certificates generated during the pairing process.

## System Configuration

### `device_config.json` File

The main configuration file contains the following sections:

```json
{
  "cryptomatMaker": "centurion",       // Device manufacturer
  "cryptomatModel": "centurion",       // Device model
  "brain": {
    "dataPath": "data",               // Path to data directory
    "wifiDisabled": true              // Whether WiFi is disabled
  },
  "kioskPrinter": {                   // Printer configuration
    "model": "Sanei-SK-21",
    "address": "SANEI-SK4-21-Series"
  },
  "compliance": {                     // Compliance mechanism configuration
    "paperWallet": false
  },
  "frontFacingCamera": {              // Front camera
    "device":"/dev/video_front_camera"
  },
  "scanner": {                        // QR code scanner
    "type": "newland",
    "device": "/dev/hidraw0"
  },
  "billValidator": {                  // Bill validator
    "deviceType": "cashflowSc",
    "rs232": {
      "device": "/dev/ttyUSB1"
    }
  },
  "billDispenser": {                  // Bill dispenser
    "model": "f56",
    "device": "/dev/ttyUSB0"
  },
  "updater": {                        // Update configuration
    "caFile": "/opt/certs/lamassu.pem",
    "extractor": {
      "lamassuPubKeyFile": "/opt/certs/lamassu.pub.key"
    },
    "packageJsonDir": "/opt/lamassu-machine"
  }
}
```

### Server Configuration

Part of the configuration is managed by the Lamassu server and sent to the machine, including:
- Transaction limits
- Supported cryptocurrencies
- Compliance mechanism configuration (KYC/AML)
- User interface options

## Installation and Launch Procedures

### Installation

Detailed installation instructions can be found in the [INSTALL.md](INSTALL.md) and [INSTALL-NIX.md](INSTALL-NIX.md) files. The basic process includes:

1. Installing system dependencies
   ```bash
   sudo apt-get install build-essential cmake libgtk2.0-dev pkg-config \
       libavcodec-dev libavformat-dev libswscale-dev \
       libv4l-dev libasound2-dev gcc-4.9 g++-4.9
   ```

2. Installing Node.js dependencies
   ```bash
   export CXX="g++-4.9"
   npm install -g node-gyp node-pre-gyp
   npm install
   ```

3. Basic configuration
   ```bash
   bash ./setup.sh
   npm run build
   ```

### Launch

#### Normal Mode
```bash
node bin/lamassu-machine
```

#### Test Mode with Simulators
```bash
# Terminal 1 - bill validator simulator
node bin/fake-bills.js

# Terminal 2 - main program
node bin/lamassu-machine --mockBillValidator --mockBillDispenser --mockCam --devBoard
```

#### Pairing with Server
```bash
node bin/lamassu-machine --mockPair '<totem-from-admin>'
```

## Test Modes and Debugging

### Device Simulators

The system offers simulators for most peripheral devices:
- `--mockBillValidator` - Bill validator simulator
- `--mockBillDispenser` - Bill dispenser simulator
- `--mockCam` - Camera and QR scanner simulator
- `--mockPair` - Pairing process simulator

### User Interface Debugging

The user interface can be run in a browser in debug mode:
```
file://<lamassu-machine-dir>/ui/start.html?debug=dev
```

### Logs and Monitoring

The system generates logs at various levels of detail:
- Operational logs - information about normal operation
- Debug logs - detailed information for developers
- Error logs - information about errors and exceptions

Logs are stored locally and can be sent to the Lamassu server.

## Peripheral Device Management

### Bill Validators

The system supports various bill validator models, including:
- CashflowSC (`lib/mei/cashflow_sc.js`)
- ID003 (`lib/id003/id003.js`)
- F56 (`lib/f56/f56.js`)
- CCNet (`lib/ccnet/ccnet.js`)
- Genmega (`lib/genmega/genmega.js`)

Each driver implements a standard interface with methods:
- `connect()` - Establish connection with the device
- `disconnect()` - Close the connection
- `acceptBill()` - Start accepting bills
- `disable()` - Disable bill acceptance

### Bill Dispensers

The system supports various bill dispenser models, including:
- F56 (`lib/f56/f56-dispenser.js`)
- Puloon (`lib/puloon/puloon.js`)
- HCM2 (`lib/hcm2/hcm2.js`)

The interface includes methods:
- `dispense(notes)` - Dispense a specified number of bills
- `reset()` - Reset the device
- `getStatus()` - Check device status

### Scanners and Cameras

The system supports various types of QR code scanners:
- Standard USB scanner (`lib/scanner.js`)
- Newland scanner (`lib/scanner-newland.js`)
- Genmega scanner (`lib/scanner-genmega.js`)

Cameras are used for:
- Scanning QR codes
- Taking photos of ID documents
- Taking photos of customer's face

### Printers

The system supports receipt printers for:
- Printing transaction confirmations
- Printing paper wallets
- Printing system reports

---

This document provides a general overview of the structure and processes in the Lamassu Machine system. For detailed technical information, refer to the source code and documentation of individual components.

