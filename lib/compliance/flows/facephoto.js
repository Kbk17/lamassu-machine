const xstate = require('xstate')
const _ = require('lodash/fp')

const actionEmitter = require('../../action-emitter')

const KEY = 'facephoto'

const facephotoMachine = xstate.Machine({
  key: KEY,
  initial: 'idle',
  strict: true,
  states: {
    idle: { on: { START: 'takeFacephoto' } },
    takeFacephoto: {
      onEntry: ['timeoutToScannerCancel', 'transitionScreen', 'takeFacephoto'],
      on: {
        PHOTO_TAKEN: { 'authorizing': { actions: ['transitionScreen', 'authorizeFacephotoData'] } },
        SCAN_ERROR: { 'facephotoFailed': { actions: ['timeoutToFail', 'transitionScreen'] } }
      }
    },
    retryTakeFacephoto: {
      onEntry: ['timeoutToScannerCancel', 'transitionScreen', 'retryTakeFacephoto'],
      on: {
        PHOTO_TAKEN: { 'authorizing': { actions: ['transitionScreen', 'authorizeFacephotoData'] } },
        SCAN_ERROR: { 'facephotoFailed': { actions: ['timeoutToFail', 'transitionScreen'] } }
      }
    },
    authorizing: {
      on: {
        AUTHORIZED: 'success',
        BLOCKED_ID: { 'facephotoVerificationFailed': { actions: ['timeoutToFail', 'transitionScreen'] } }
      }
    },
    facephotoFailed: {
      on: {
        FAIL: 'failure',
        RETRY: 'retryTakeFacephoto'
      }
    },
    facephotoVerificationFailed: { on: { FAIL: 'failure' } },
    failure: { onEntry: ['failure'] },
    success: { onEntry: ['success'] }
  }
})

let currentStateValue
let data
let dataTC = null

function getTCData () { return dataTC }

function setTCData (value) { 
  console.log('[FACEPHOTO] Zapisywanie danych zdjęcia T&C, rozmiar:', value ? value.length : 'brak danych')
  dataTC = value 
  return dataTC
}

function cleanTCData () { dataTC = null }

function getData () { return data }

function setData (_data) {
  if (!_data) {
    console.log('[FACEPHOTO] UWAGA: Próba zapisania pustych danych zdjęcia')
    return null
  }
  
  console.log('[FACEPHOTO] Zapisywanie danych zdjęcia, rozmiar:', _data.length, 'bajtów')
  
  // Upewnij się, że zapisujemy kopię bufora, a nie referencję
  try {
    data = Buffer.from(_data)
    console.log('[FACEPHOTO] Dane zapisane pomyślnie, rozmiar bufora:', data.length, 'bajtów')
  } catch (error) {
    console.log('[FACEPHOTO] BŁĄD podczas kopiowania bufora zdjęcia:', error.message)
    data = _data  // Awaryjnie używamy oryginalnego bufora
  }
  
  return data
}

function getState () { return currentStateValue }

function start () {
  actionEmitter.emit('facephoto', { action: 'START' })
}

function timeoutToFail (_, dispatch) {
  setTimeout(function () {
    dispatch('FAIL')
  }, 120000)
}

function dispatch (event) {
  actionEmitter.emit('facephoto', { action: event })
}

function timeoutToScannerCancel (action, dispatch) {
  return actionEmitter.emit('scannerCancel')
}

function transitionScreen (action, dispatch) {
  let screen
  switch (action.type) {
    case 'xstate.init':
      screen = 'idle'
      break
    case 'takeFacephoto':
    case 'PHOTO_TAKEN':
      break
    default:
      screen = 'facephoto' + _.upperFirst(action.type)
  }

  if (screen) {
    actionEmitter.emit('factoryTest', screen)
  }
}

function authorize (action, dispatch) {
  actionEmitter.emit('authorizeFacephotoData')
}

function success () {
  console.log('[FACEPHOTO] Weryfikacja zdjęcia twarzy zakończona sukcesem')
  actionEmitter.emit('success')
  
  // Wyemituj zdarzenie powodujące przejście do skanowania adresu
  console.log('[FACEPHOTO] Emitowanie zdarzenia startAddressScan')
  actionEmitter.emit('startAddressScan')
}

function failure () {
  actionEmitter.emit('failure')
}

const handlers = {
  SCAN_ERROR: () => {},
  PHOTO_TAKEN: setData,
  AUTHORIZED: () => {},
  failure: () => {},
  timeoutToScannerCancel: timeoutToScannerCancel,
  takeFacephoto: () => actionEmitter.emit('takeFacephoto'),
  retryTakeFacephoto: () => actionEmitter.emit('retryFacephoto'),
  authorizeFacephotoData: authorize,
  timeoutToFail: timeoutToFail,
  transitionScreen: transitionScreen,
  failure: failure,
  success: success
}

function wrappedTransition (type, action) {
  currentStateValue = facephotoMachine.transition(currentStateValue, {type, ...action}).value
  return currentStateValue
}

function init () {
  actionEmitter.on('facephoto', function (action) {
    currentStateValue = wrappedTransition(action.action, action)
  })

  const actions = [
    'takeFacephoto',
    'authorizeFacephotoData',
    'retryFacephoto',
    'success',
    'failure'
  ]

  actions.forEach(action => {
    actionEmitter.on(action, () => handlers[action]())
  })
}

init()

module.exports = {
  start,
  dispatch,
  getData,
  setData,
  getState,
  setTCData,
  getTCData,
  cleanTCData
}
