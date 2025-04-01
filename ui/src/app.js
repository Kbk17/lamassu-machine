/* globals $, URLSearchParams, WebSocket, locales, Keyboard, Keypad, Jed, BigNumber, HOST, PORT, Origami, kjua, TimelineMax, Two */
'use strict'

const queryString = window.location.search
const params = new URLSearchParams(queryString.substring(1))
const SCREEN = params.get('screen')
const DEBUG_MODE = SCREEN ? 'demo' : params.get('debug')
const CASH_OUT_QR_COLOR = '#403c51'
const CASH_IN_QR_COLOR = '#0e4160'
const NUMBER_OF_BUTTONS = 3

var scrollSize = 0
var textHeightQuantity = 0
var currentPage = 0
var totalPages = 0
var aspectRatio = '16:10'
var isTwoWay = null
var isRTL = false
var two = null
var cryptomatModel = null
var termsConditionsTimeout = null
var termsConditionsAcceptanceInterval = null
var T_C_TIMEOUT = 30000
var complianceTimeout = null;
var cashDirection = null;

var fiatCode = null
var locale = null
var defaultLocale = loadI18n('en-US') || null
var localeCode = null
var jsLocaleCode = null // Sometimes slightly different than localeCode
var _primaryLocales = []
var lastRates = null
var coins

var currentState

var accepting = false
var websocket = null
var wifiKeyboard = null
var promoKeyboard = null
var usSsnKeypad = null
var phoneKeypad = null
var securityKeypad = null
var previousState = null
var buttonActive = true
var cassettes = null
let currentCryptoCode = null
let currentCoin = null
let currentCoins = []
let emailKeyboard = null
let customRequirementNumericalKeypad = null
let customRequirementTextKeyboard = null
let customRequirementChoiceList = null

// Globalny mechanizm blokowania przycisków - prosty, bez niepotrzebnych komplikacji
let interfaceLocked = false;

// Dodaj style CSS dla zablokowanych przycisków
const buttonLockStyles = document.createElement('style');
buttonLockStyles.textContent = `
  .button-disabled {
    opacity: 0.5 !important;
    cursor: not-allowed !important;
    pointer-events: none !important;
  }
  .button-selected {
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.4) !important;
    transform: scale(0.97) !important;
  }
`;
document.head.appendChild(buttonLockStyles);

// Dodaj na początku pliku, gdzie są zdefiniowane zmienne globalne
var lastClickedButtonId = null;
var buttonCooldownActive = false;
var GLOBAL_BUTTON_COOLDOWN = 3000; // 3 sekundy globalnej blokady

// Dodajmy prostą zmienną do kontroli stanu interfejsu
var userInterfaceLocked = false;

// Funkcja do blokowania przycisków - prosta implementacja
function lockButtons(clickedButton) {
  // Jeśli już zablokowane, nie rób nic
  if (interfaceLocked) return;
  
  // Ustaw flagę blokady
  interfaceLocked = true;
  console.log('Locking UI, clicked button:', clickedButton ? clickedButton.id || 'unnamed' : 'unknown');
  
  // Zablokuj wszystkie przyciski oprócz wyjątków
  $('button, .button, .cash-button, .choose-coin-button, .filled-action-button, .circle-button').each(function() {
    const btn = $(this);
    
    // Wyjątki - przyciski nawigacyjne, które zawsze powinny działać
    const isNavButton = 
      btn.hasClass('nav-button') || 
      btn.attr('id') === 'completed_viewport' ||
      btn.attr('id') === 'fiat_receipt_viewport' ||
      btn.attr('id') === 'fiat_complete_viewport' ||
      btn.attr('id') === 'printer-back-to-home';
      
    if (!isNavButton) {
      // Dodaj klasę z CSS blokującą przycisk
      btn.addClass('button-clicked');
    }
  });
  
  // Oznacz specjalnie kliknięty przycisk
  if (clickedButton) {
    $(clickedButton).addClass('button-selected');
  }
}

// Funkcja do odblokowywania przycisków
function unlockButtons() {
  interfaceLocked = false;
  console.log('Unlocking UI');
  $('.button-clicked').removeClass('button-clicked');
  $('.button-selected').removeClass('button-selected');
}

// Funkcja sprawdzająca, czy przyciski są zablokowane
function areButtonsLocked() {
  return interfaceLocked;
}

function touchEvent(element, callback) {
  function handler(e) {
    // Sprawdź, czy przyciski są zablokowane
    if (areButtonsLocked()) {
      console.log('UI locked, ignoring click');
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    
    var target = targetButton(e.target);
    
    // Blokuj wszystkie przyciski i zaznacz kliknięty
    lockButtons(target);

    // Dodaj klasę active tylko dla wizualnego efektu (krótkotrwałego)
    target.classList.add('active');

    // Wait for transition to finish
    setTimeout(function() {
      target.classList.remove('active');
    }, 300);

    // Wykonaj callback z pewnym opóźnieniem, aby dać czas na wizualne efekty
    setTimeout(function() {
      callback(e);
    }, 200);

    e.stopPropagation();
    e.preventDefault();
  }

  if (shouldEnableTouch()) {
    element.addEventListener('touchstart', handler);
  }
  element.addEventListener('mousedown', handler);
}

function touchImmediateEvent(element, callback) {
  function handler(e) {
    // Sprawdź, czy przyciski są zablokowane
    if (areButtonsLocked()) {
      console.log('UI locked, ignoring immediate click');
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    
    // Blokuj wszystkie przyciski
    lockButtons(targetButton(e.target));
    
    // Wykonaj callback natychmiast
    callback(e);
    e.stopPropagation();
    e.preventDefault();
  }
  if (shouldEnableTouch()) {
    element.addEventListener('touchstart', handler);
  }
  element.addEventListener('mousedown', handler);
}

function buttonPressed(button, data) {
  // Nie wykonuj akcji jeśli przyciski są nieaktywne
  if (!buttonActive) return;
  
  wifiKeyboard.deactivate();
  promoKeyboard.deactivate();
  emailKeyboard.deactivate();
  customRequirementTextKeyboard.deactivate();
  buttonActive = false;
  
  var res = { button: button };
  if (data || data === null) res.data = data;
  if (websocket) websocket.send(JSON.stringify(res));
  
  setTimeout(function() {
    buttonActive = true;
    wifiKeyboard.activate();
    promoKeyboard.activate();
    emailKeyboard.activate();
    customRequirementTextKeyboard.activate();
  }, 300);
}

function setScreen(newScreen, oldScreen) {
  if (newScreen === oldScreen) return;

  // Odblokuj przyciski przy zmianie ekranu
  unlockButtons();

  if (newScreen === 'insert_bills') {
    $('.js-processing-bill').html(translate('Lamassu Cryptomat'));
    $('.bill img').css({'-webkit-transform': 'none', top: 0, left: 0});
  }

  var newView = $('.' + newScreen + '_state');
  if (newView.length !== 1) console.log('FATAL: ' + newView.length + ' screens found of class ' + newScreen + '_state');

  $('.viewport').removeClass('viewport-active');
  newView.addClass('viewport-active');
}

function setState(state, delay) {
  if (state === currentState) return;

  if (currentState === 'terms_screen') {
    clearTermsConditionsTimeout();
    clearTermsConditionsAcceptanceDelay();
  }

  setComplianceTimeout(0);

  previousState = currentState;
  currentState = state;

  // Odblokuj przyciski natychmiast przy zmianie stanu
  unlockButtons();

  // Resetuj flagę używania kamery przy rozpoczęciu nowej transakcji
  if (state === 'idle' || state === 'choose_coin' || state === 'terms_screen') {
    try {
      // Sprawdź czy scanner-newland został zaimportowany w odpowiednim miejscu
      if (websocket) {
        console.log('Resetting camera locks for new transaction');
        websocket.send(JSON.stringify({ button: 'resetCameraLocks' }));
      }
    } catch (err) {
      console.log('Error resetting camera locks:', err);
    }
  }

  wifiKeyboard.reset();
  promoKeyboard.reset();
  emailKeyboard.reset();
  customRequirementTextKeyboard.reset();

  if (state === 'idle') {
    $('.qr-code').empty();
    $('.qr-code-deposit').empty();
  }

  if (delay) {
    window.setTimeout(function() {
      setScreen(currentState, previousState);
    }, delay);
  } else setScreen(currentState, previousState);
}

function revertScreen () { setScreen(currentState) }

function setWifiList (recs, requestedPage) {
  var networks = $('#networks')
  if (!recs) recs = networks.data('recs')
  var page = requestedPage || networks.data('page') || 0
  var offset = page * 4
  if (offset > recs.length - 1) {
    offset = 0
    page = 0
  }
  $('#more-networks').css({ 'display': 'none' })
  networks.empty()
  networks.data('page', page)
  networks.data('recs', recs)
  var remainingCount = recs.length - offset
  var len = Math.min(remainingCount, 4)
  for (var i = 0; i < len; i++) {
    var rec = recs[i + offset]
    var bars = Math.floor(rec.strength * 4) + 1
    var html = '<div class="wifi-network-button filled-action-button tl2">' +
    '<span class="ssid" data-raw-ssid="' + rec.rawSsid + '" data-ssid="' +
      rec.ssid + '">' + rec.displaySsid +
    '</span>' + '<div class="wifiicon-wrapper"><img src="images/wifiicon/' + bars + '.svg"/></div></div>'
    networks.append(html)
  }

  var moreTxt = translate('MORE')
  var button = '<span display="inline-block" id="more-networks" class="button filled-action-button tl2">' + moreTxt + '</span>'
  if (recs.length > 4) {
    networks.append(button)
  }
}

function setUpDirectionElement (element, direction) {
  if (direction === 'cashOut') {
    element.removeClass('cash-in-color')
    element.addClass('cash-out-color')
  } else {
    element.addClass('cash-in-color')
    element.removeClass('cash-out-color')
  }
}

function setOperatorInfo (operator) {
  if (!operator || !operator.active) {
    $('.contacts, .contacts-compact').addClass('hide')
  } else {
    $('.contacts, .contacts-compact').removeClass('hide')
    $('.operator-name').text(operator.name)
    $('.operator-email').text(operator.email)
    $('.operator-phone').text(operator.phone)
  }
}

function setHardLimit (limits) {
  const component = $('#hard-limit-hours')
  if (limits.hardLimitWeeks >= 1) {
    return component.text(translate('Please come back in %s weeks', [limits.hardLimitWeeks]))
  }

  if (limits.hardLimitDays >= 1) {
    return component.text(translate('Please come back in %s days and %s hours', [limits.hardLimitDays, limits.hardLimitHours]))
  }

  component.text(translate('Please come back in %s hours', [limits.hardLimitHours]))
}

function setCryptomatModel (model) {
  cryptomatModel = model
  const versions = ['sintra', 'douro', 'gaia', 'tejo', 'grandola', 'aveiro', 'coincloud', 'gmuk1', 'batm7in']
  const body = $('body')

  versions.forEach(it => body.removeClass(it))
  $('body').addClass(model.startsWith('douro') ? 'douro' : model)
}

function enableRecyclerBillButtons() {
  var continueButton = document.getElementById('recycler-continue');
  var finishButton = document.getElementById('recycler-finish');
  continueButton.disabled = false;
  finishButton.disabled = false;
}

function disableRecyclerBillButtons() {
  var continueButton = document.getElementById('recycler-continue');
  var finishButton = document.getElementById('recycler-finish');
  continueButton.disabled = true;
  finishButton.disabled = true;
}

function setDirection (direction) {
  let states = [
    $('.scan_id_photo_state'),
    $('.scan_manual_id_photo_state'),
    $('.scan_id_data_state'),
    $('.security_code_state'),
    $('.register_us_ssn_state'),
    $('.us_ssn_permission_state'),
    $('.register_phone_state'),
    $('.register_email_state'),
    $('.terms_screen_state'),
    $('.verifying_id_photo_state'),
    $('.verifying_face_photo_state'),
    $('.verifying_id_data_state'),
    $('.permission_id_state'),
    $('.sms_verification_state'),
    $('.email_verification_state'),
    $('.bad_phone_number_state'),
    $('.bad_security_code_state'),
    $('.max_phone_retries_state'),
    $('.max_email_retries_state'),
    $('.failed_permission_id_state'),
    $('.failed_verifying_id_photo_state'),
    $('.blocked_customer_state'),
    $('.fiat_error_state'),
    $('.fiat_transaction_error_state'),
    $('.failed_scan_id_data_state'),
    $('.sanctions_failure_state'),
    $('.error_permission_id_state'),
    $('.scan_face_photo_state'),
    $('.retry_scan_face_photo_state'),
    $('.permission_face_photo_state'),
    $('.failed_scan_face_photo_state'),
    $('.hard_limit_reached_state'),
    $('.failed_scan_id_photo_state'),
    $('.retry_permission_id_state'),
    $('.waiting_state'),
    $('.insert_promo_code_state'),
    $('.promo_code_not_found_state'),
    $('.custom_permission_state'),
    $('.external_permission_state'),
    $('.custom_permission_screen2_numerical_state'),
    $('.custom_permission_screen2_text_state'),
    $('.custom_permission_screen2_choiceList_state'),
    $('.external_compliance_state')
  ]
  cashDirection = direction
  states.forEach(it => {
    setUpDirectionElement(it, direction)
  })
}

/**
 *
 * @param {Object} data
 * @param {boolean} data.active
 * @param {String} data.title
 * @param {String} data.text
 * @param {String} data.accept
 * @param {String} data.cancel
 */
function setTermsScreen (data) {
  const $screen = $('.terms_screen_state')
  $screen.find('.js-terms-title').html(data.title)
  startPage(data.text, data.acceptDisabled)
  $screen.find('.js-terms-cancel-button').html(data.cancel)
  $screen.find('.js-terms-accept-button').html(data.accept)
  setTermsConditionsTimeout()
  setAcceptButtonDisabled($screen, data)
  setTermsConditionsAcceptanceDelay($screen, data)
}

function setAcceptButtonDisabled (screen, data) {
  var acceptButton = screen.find('.js-terms-accept-button');
  acceptButton.prop('disabled', Boolean(data.acceptDisabled));
}

function clearTermsConditionsTimeout () {
  clearTimeout(termsConditionsTimeout)
}

function setTermsConditionsTimeout () {
  termsConditionsTimeout = setTimeout(function () {
    if (currentState === 'terms_screen') {
      buttonPressed('idle')
    }
  }, T_C_TIMEOUT)
}

function setTermsConditionsAcceptanceDelay (screen, data) {
  let acceptButton = screen.find('.js-terms-accept-button')
  acceptButton.css({ 'min-width': 0 })

  if (!data.delay) return

  const delayTimer = isNaN(data.delayTimer) ? 0 : data.delayTimer
  let seconds = delayTimer / 1000
  acceptButton.prop('disabled', true)
  acceptButton.html(seconds > 0 ? `${data.accept} (${seconds})` : `${data.accept}`)

  var tmpbtn = acceptButton.clone().appendTo('body').css({ 'display': 'block', 'visibility': 'hidden' })
  var width = tmpbtn.outerWidth()
  tmpbtn.remove()
  acceptButton.css({ 'min-width': `${width}px` })
  termsConditionsAcceptanceInterval = setInterval(function () {
    seconds--
    if (currentState === 'terms_screen' && seconds > 0) {
      acceptButton.html(`${data.accept} (${seconds})`)
    }
    if (currentState === 'terms_screen' && seconds <= 0) {
      acceptButton.prop('disabled', false)
      acceptButton.html(`${data.accept}`)
    }
    if (seconds <= 0) {
      clearInterval(termsConditionsAcceptanceInterval)
    }
  }, 1000)
}

function clearTermsConditionsAcceptanceDelay () {
  clearInterval(termsConditionsAcceptanceInterval)
}

function resetTermsConditionsTimeout () {
  clearTermsConditionsTimeout()
  setTermsConditionsTimeout()
}

// click page up button
function scrollUp () {
  resetTermsConditionsTimeout()
  const div = document.getElementById('js-terms-text-div')
  if (currentPage !== 0) {
    currentPage -= 1
    updateButtonStyles()
    updatePageCounter()
    div.scrollTo(0, currentPage * scrollSize)
  }
}

// start page
function startPage (text, acceptedTerms) {
  const $screen = $('.terms_screen_state')
  $screen.find('.js-terms-text').html(text)
  if (!acceptedTerms) currentPage = 0
  totalPages = 0
  setTimeout(function () {
    const div = document.getElementById('js-terms-text-div')
    textHeightQuantity = document.getElementById('js-terms-text').offsetHeight
    scrollSize = div.offsetHeight - 40
    updateButtonStyles()
    if (text.length <= 1000 && textHeightQuantity <= div.offsetHeight) {
      document.getElementById('actions-scroll').style.display = 'none'
    } else {
      document.getElementById('actions-scroll').style.display = ''
      if (!acceptedTerms) div.scrollTo(0, 0)
      totalPages = Math.ceil(textHeightQuantity / scrollSize)
      updatePageCounter()
    }
  }, 100)
}

function updatePageCounter () {
  document.getElementById('terms-page-counter').textContent = `${currentPage + 1}/${totalPages}`
}

// click page up button
function scrollDown () {
  resetTermsConditionsTimeout()
  const div = document.getElementById('js-terms-text-div')
  if (!(currentPage * scrollSize + scrollSize > textHeightQuantity && currentPage !== 0)) {
    currentPage += 1
    updateButtonStyles()
    updatePageCounter()
    div.scrollTo(0, currentPage * scrollSize)
  }
}

function updateButtonStyles () {
  textHeightQuantity = document.getElementById('js-terms-text').offsetHeight
  const buttonDown = document.getElementById('scroll-down')
  const buttonUp = document.getElementById('scroll-up')
  if (currentPage === 0) {
    buttonUp.disabled = true
  } else {
    buttonUp.disabled = false
  }

  if (currentPage * scrollSize + scrollSize > textHeightQuantity && currentPage !== 0) {
    buttonDown.disabled = true
  } else {
    buttonDown.disabled = false
  }
}

function moreNetworks () {
  var networks = $('#networks')
  var page = networks.data('page')
  setWifiList(null, page + 1)
}

function setWifiSsid (data) {
  $('#js-i18n-wifi-for-ssid').data('ssid', data.ssid)
  $('#js-i18n-wifi-for-ssid').data('raw-ssid', data.rawSsid)
  t('wifi-for-ssid', translate('for %s', ['<strong>' + data.ssid + '</strong>']))
  t('wifi-connect', translate("You're connecting to the WiFi network %s", ['<strong>' + data.ssid + '</strong>']))
}

function setLocaleInfo (data) {
  phoneKeypad.setCountry(data.country)
  setPrimaryLocales(data.primaryLocales)
  setLocale(data.primaryLocale)
}

function otherLanguageName () {
  const lang = lookupLocaleNames(otherLocale())
  return lang && lang.nativeName
}

function otherLocale () {
  return _primaryLocales.find(c => c !== localeCode)
}

function setLocale (data) {
  if (!data || data === localeCode) return
  localeCode = data
  jsLocaleCode = data
  var lang = localeCode.split('-')[0]

  if (jsLocaleCode === 'fr-QC') jsLocaleCode = 'fr-CA'

  var isArabic = jsLocaleCode.indexOf('ar-') === 0
  var isHebrew = jsLocaleCode.indexOf('he-') === 0
  isRTL = isArabic || isHebrew

  setChooseCoinColors()
  // setupAnimation(isTwoWay, aspectRatio800)

  if (isRTL) {
    $('body').addClass('i18n-rtl')
  } else {
    $('body').removeClass('i18n-rtl')
  }

  if (isArabic) {
    $('body').addClass('i18n-ar')
  } else {
    $('body').removeClass('i18n-ar')
  }

  if (isHebrew) {
    $('body').addClass('i18n-he')
  } else {
    $('body').removeClass('i18n-he')
  }

  if (MUSEO.indexOf(lang) !== -1) $('body').addClass('museo')
  else $('body').removeClass('museo')

  locale = loadI18n(localeCode)
  try { translatePage() } catch (ex) {}

  $('.js-two-language').html(otherLanguageName())

  if (lastRates) setExchangeRate(lastRates)
}

function setChooseCoinColors () {
  var elem = $('#bg-to-show > img')
  let img = `images/background/${isTwoWay ? '2way' : '1way'}-${aspectRatio}${isRTL ? '-rtl' : ''}.svg`
  if (img !== elem.attr('src')) {
    elem.attr('src', img)
  }

  if (isTwoWay) {
    $('.choose_coin_state .change-language').removeClass('cash-in-color').addClass('cash-out-color')
  } else {
    $('.choose_coin_state .change-language').removeClass('cash-out-color').addClass('cash-in-color')
  }
}

function areArraysEqual (arr1, arr2) {
  if (arr1.length !== arr2.length) return false
  for (var i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false
  }
  return true
}

function lookupLocaleNames (locale) {
  if (!locale) return
  var langMap = window.languageMappingList
  var language = locale.split('-')[0]
  var localeNames = langMap[language]
  return localeNames || langMap[locale]
}

function setPrimaryLocales (primaryLocales) {
  if (areArraysEqual(primaryLocales, _primaryLocales)) return
  _primaryLocales = primaryLocales

  var languages = $('#languages')
  closeLanguageDropdown()
  languages.empty()
  var sortedPrimaryLocales = primaryLocales.filter(lookupLocaleNames).sort(function (a, b) {
    var langA = lookupLocaleNames(a)
    var langB = lookupLocaleNames(b)
    return langA.englishName.localeCompare(langB.englishName)
  })

  languages.append(`<button class="square-button small-action-button tl2">Languages</button>`)
  for (var i = 0; i < sortedPrimaryLocales.length; i++) {
    var l = sortedPrimaryLocales[i]
    var lang = lookupLocaleNames(l)
    var name = lang.nativeName || lang.englishName
    var div = `<button class="square-button small-action-button tl2" data-locale="${l}">${name}</button>`
    languages.append(div)
  }

  $('.js-two-language').html(otherLanguageName())

  $('.js-menu-language').toggleClass('hide', sortedPrimaryLocales.length <= 1)
  $('.js-multi-language').toggleClass('hide', sortedPrimaryLocales.length === 2)
  $('.js-two-language').toggleClass('hide', sortedPrimaryLocales.length > 2)
}

function setFiatCode (data) {
  fiatCode = data
  $('.js-currency').text(fiatCode)
}

function setFixedFee (_fee) {
  const fee = parseFloat(_fee)
  if (fee > 0) {
    const fixedFee = translate('Transaction Fee: %s', [formatFiat(fee, 2)])
    $('.js-i18n-fixed-fee').html(fixedFee)
  } else {
    $('.js-i18n-fixed-fee').html('')
  }
}

function setCredit (credit, lastBill) {
  const { fiat, cryptoAtoms, cryptoCode } = credit
  var coin = getCryptoCurrency(cryptoCode)

  var scale = new BigNumber(10).pow(coin.displayScale)
  var cryptoAmount = new BigNumber(cryptoAtoms).div(scale).toNumber()
  var cryptoDisplayCode = coin.displayCode
  updateCrypto('.total-crypto-rec', cryptoAmount, cryptoDisplayCode)
  $('.amount-deposited').html(translate('You deposited %s', [`${fiat} ${fiatCode}`]))
  $('.fiat .js-amount').html(fiat)

  var inserted = lastBill
    ? translate('You inserted a %s bill', [formatFiat(lastBill)])
    : translate('Lamassu Cryptomat')

  $('.js-processing-bill').html(inserted)

  $('.js-continue-crypto-enable').show()
  $('.js-send-crypto-enable').show()
}

function formatDenomination (denom) {
  return denom.toLocaleString(jsLocaleCode, {
    useGrouping: true,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  })
}

function buildCassetteButtons (_cassettes, numberOfButtons) {
  cassettes = _cassettes
  var activeCassettes = _cassettes.filter(it => it.count === null || it.count > 0)
  var inactiveCassettes = _cassettes.filter(it => it.count === 0)

  var allCassettes = activeCassettes.concat(inactiveCassettes)
  var selectedCassettes = allCassettes.slice(0, numberOfButtons)
  var sortedCassettes = selectedCassettes.sort((a, b) => a.denomination - b.denomination)

  for (var i = 0; i < sortedCassettes.length; i++) {
    var denomination = formatDenomination(sortedCassettes[i].denomination || 0)
    $('.cash-button[data-denomination-index=' + i + '] .js-denomination').text(denomination)
  }
}

function updateCassetteButtons (activeDenoms, numberOfButtons) {
  for(var i = 0; i < numberOfButtons; i++) {
    var button = $('.choose_fiat_state .cash-button[data-denomination-index=' + i + ']')
    var denomination = button.children('.js-denomination').text()
    button.prop('disabled', !Boolean(activeDenoms[denomination]))
  }
}

function buildCassetteButtonEvents () {
  var fiatButtons = document.getElementById('js-fiat-buttons')
  var lastTouch = null

  touchImmediateEvent(fiatButtons, function (e) {
    var now = Date.now()
    if (lastTouch && now - lastTouch < 100) return
    lastTouch = now
    var cashButtonJ = $(e.target).closest('.cash-button')
    if (cashButtonJ.length === 0) return
    if (cashButtonJ.hasClass('disabled')) return
    if (cashButtonJ.hasClass('clear')) return buttonPressed('clearFiat')
    buttonPressed('fiatButton', { denomination: cashButtonJ.children('.js-denomination').text() })
  })
}

function updateCrypto (selector, cryptoAmount, cryptoDisplayCode) {
  $(selector).find('.crypto-amount').html(formatCrypto(cryptoAmount))
  $(selector).find('.crypto-units').html(cryptoDisplayCode)
}

function lookupDecimalChar (localeCode) {
  var num = 1.1
  var localized = num.toLocaleString(jsLocaleCode, {
    useGrouping: true,
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  })

  return localized[1]
}

function splitNumber (localize, localeCode) {
  var decimalChar = lookupDecimalChar(localeCode)
  var split = localize.split(decimalChar)

  if (split.length === 1) {
    return ['<span class="integer">', split[0], '</span>'].join('')
  }

  return [
    '<span class="integer">', split[0], '</span><span class="decimal-char">',
    decimalChar, '</span><span class="decimal">', split[1], '</span>'
  ].join('')
}

function formatNumber (num) {
  var localized = num.toLocaleString(jsLocaleCode, {
    useGrouping: true,
    maximumFractionDigits: 6,
    minimumFractionDigits: 3
  })

  return splitNumber(localized, jsLocaleCode)
}

function formatCrypto (amount) {
  return formatNumber(amount)
}

function formatFiat (amount, fractionDigits) {
  if (!fractionDigits) fractionDigits = 0

  const localized = amount.toLocaleString(jsLocaleCode, {
    useGrouping: true,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits
  })
  return splitNumber(localized, jsLocaleCode) + ' ' + fiatCode
}

function setExchangeRate (_rates) {
  lastRates = _rates
  var cryptoCode = _rates.cryptoCode
  var rates = _rates.rates

  var coin = getCryptoCurrency(cryptoCode)
  var displayCode = coin.displayCode

  if (rates.cashIn) {
    var cryptoToFiat = new BigNumber(rates.cashIn)
    var rateStr = formatFiat(cryptoToFiat.round(2).toNumber(), 2)

    $('.crypto-rate-cash-in').html(`1 ${cryptoCode === LN ? BTC : cryptoCode} = ${rateStr}`)
  }

  if (rates.cashOut) {
    var cashOut = new BigNumber(rates.cashOut)
    var cashOutCryptoToFiat = cashOut && formatFiat(cashOut.round(2).toNumber(), 2)

    $('.crypto-rate-cash-out').html(`1 ${cryptoCode === LN ? BTC : cryptoCode} = ${cashOutCryptoToFiat}`)
  }

  $('.js-crypto-display-units').text(displayCode)
}

function qrize (text, target, color, lightning, size = 'normal') {
  const image = document.getElementById('bolt-img')
  // Hack for surf browser
  const _size = size === 'normal'
    ? document.body.clientHeight * 0.36
    : document.body.clientHeight * 0.25

  const opts = {
    crisp: true,
    fill: color || 'black',
    text,
    size: _size,
    render: 'canvas',
    rounded: 50,
    quiet: 2,
    mPosX: 50,
    mPosY: 50,
    mSize: 30,
    image
  }

  if (lightning) {
    opts.mode = 'image'
  }

  const el = kjua(opts)

  target.empty().append(el)
}

function setTx (tx) {
  const txId = tx.id
  const isPaperWallet = tx.isPaperWallet
  const hasBills = tx.bills && tx.bills.length > 0

  if (hasBills) {
    $('.js-inserted-notes').show()
    $('.js-no-inserted-notes').hide()
  } else {
    $('.js-inserted-notes').hide()
    $('.js-no-inserted-notes').show()
  }

  $('.js-paper-wallet').toggleClass('hide', !isPaperWallet)

  setCurrentDiscount(tx.discount, tx.promoCodeApplied)

  setTimeout(() => {
    qrize(txId, $('#cash-in-qr-code'), CASH_IN_QR_COLOR)
    qrize(txId, $('#cash-in-fail-qr-code'), CASH_IN_QR_COLOR)
    qrize(txId, $('#cash-in-no-funds-qr-code'), CASH_IN_QR_COLOR, null, 'small')
    qrize(txId, $('#qr-code-fiat-receipt'), CASH_OUT_QR_COLOR)
    qrize(txId, $('#qr-code-fiat-complete'), CASH_OUT_QR_COLOR)
  }, 1000)
}

function formatAddressNoBreakLines (address) {
  if (!address) return
  if (address.length > 60) {
    const firstPart = address.substring(0, 40).replace(/(.{4})/g, '$1 ')
    const secondPart = address.substring(address.length-16, address.length).replace(/(.{4})/g, '$1 ')
    return firstPart.concat('... ').concat(secondPart)
  }
  return address.replace(/(.{4})/g, '$1 ')
}

function formatAddress (address) {
  let toBr = formatAddressNoBreakLines(address)
  if (!toBr) return

  return toBr.replace(/((.{4} ){5})/g, '$1<br/> ')
}

function setBuyerAddress (address) {
  $('.crypto-address-no-br').html(formatAddressNoBreakLines(address))
  $('.crypto-address').html(formatAddress(address))
}

function setAccepting (currentAccepting) {
  accepting = currentAccepting
  if (accepting) {
    $('.bill img').transition({ x: 0, y: -303 }, 1000, 'ease-in')
  } else {
    $('.bill img').transition({ x: 0, y: 0 }, 1000, 'ease-out')
  }
}

function highBill (highestBill, reason) {
  var reasonText = reason === 'transactionLimit'
    ? translate('Transaction limit reached.')
    : translate("We're a little low on crypto.")

  t('high-bill-header', reasonText)
  t('highest-bill', translate('Please insert %s or less.', [formatFiat(highestBill)]))

  setScreen('high_bill')
  window.setTimeout(revertScreen, 3000)
}

function minimumTx (lowestBill) {
  t('lowest-bill', translate('Minimum first bill is %s.', [formatFiat(lowestBill)]))

  setScreen('minimum_tx')
  window.setTimeout(revertScreen, 3000)
}

function readingBills (bill) {
  $('.js-processing-bill').html(translate('Processing %s ...', [formatFiat(bill)]))
  $('.js-continue-crypto-enable').hide()
  $('.js-send-crypto-enable').hide()
}

function sendOnly (reason) {
  // TODO: sendOnly should be made into its own state on brain.js
  if (currentState === 'send_only') return

  const errorMessages = {
    transactionLimit: translate('Transaction limit reached'),
    validatorError: translate('Error in validation'),
    lowBalance: translate("We're out of coins!"),
    blockedCustomer: translate('Transaction limit reached')
  }

  // If no reason provided defaults to lowBalance
  const reasonText = errorMessages[reason] || errorMessages.lowBalance
  $('#send-only-title').text(reasonText)

  if (reason === 'blockedCustomer') {
    $('.js-send-only-text').text(translate("Due to local regulations, you've reached your transaction limit. Please contact us if you'd like to raise your limit."))
  } else {
    $('.js-send-only-text').text('')
  }

  setState('send_only')
}

function setPartialSend (sent, total) {
  $('#already-sent').text(formatFiat(sent.fiat))
  $('#pending-sent').text(formatFiat(total.fiat - sent.fiat))
}

function t (id, str) {
  $('#js-i18n-' + id).html(str)
}

function translateCoin (_cryptoCode) {
  const coin = getCryptoCurrency(_cryptoCode)
  const cryptoCode = coin.cryptoCodeDisplay || _cryptoCode
  $('.js-i18n-scan-your-address').html(translate('Scan your <br/> %s address', [cryptoCode]))
  $('.js-i18n-please-scan').html(translate('Please scan the QR code <br/> to send us your %s.', [cryptoCode]))
  $('.js-i18n-did-send-coins').html(translate('Have you sent the %s yet?', [cryptoCode]))
  $('.js-i18n-scan-address').html(translate('Scan your %s address', [cryptoCode]))
  $('.js-i18n-invalid-address').html(translate('Invalid %s address', [cryptoCode]))
}

function initTranslatePage () {
  $('.js-i18n').each(function () {
    var el = $(this)
    el.data('baseTranslation', el.html().trim())
  })
  $('input[placeholder]').each(function () {
    var el = $(this)
    el.data('baseTranslation', el.attr('placeholder'))
  })
}

function translatePage () {
  $('.js-i18n').each(function () {
    var el = $(this)
    var base = el.data('baseTranslation')
    el.html(translate(base))
  })
  $('input[placeholder]').each(function () {
    var el = $(this)
    var base = el.data('baseTranslation')
    el.attr('placeholder', translate(base))
  })

  // Adjust send coins button
  var length = $('#send-coins span').text().length
  if (length > 17) $('body').addClass('i18n-long-send-coins')
  else $('body').removeClass('i18n-long-send-coins')
}

function loadI18n (localeCode) {
  var messages = locales[localeCode] || locales['en-US']

  return new Jed({
    'missing_key_callback': function () {},
    'locale_data': {
      'messages': messages
    }
  })
}

function reachFiatLimit (rec) {
  var msg = null
  if (rec.isEmpty) msg = translate(`We're a little low, please cash out`)
  else if (rec.txLimitReached) msg = translate('Transaction limit reached, please cash out')

  var el = $('.choose_fiat_state .limit')
  if (msg) el.html(msg).show()
  else el.hide()
}

function chooseFiat (data) {
  fiatCredit(data)
  setState('choose_fiat')
}

function displayCrypto (cryptoAtoms, cryptoCode) {
  var coin = getCryptoCurrency(cryptoCode)
  var scale = new BigNumber(10).pow(coin.displayScale)
  // number of decimal places vary based on displayScale value
  var decimalPlaces = (coin.displayScale - coin.unitScale) + 6
  var cryptoAmount = new BigNumber(cryptoAtoms).div(scale).round(decimalPlaces).toNumber()
  var cryptoDisplay = formatCrypto(cryptoAmount)

  return cryptoDisplay
}

function BN (s) { return new BigNumber(s) }

function fiatCredit (data) {
  var tx = data.tx
  var cryptoCode = tx.cryptoCode
  var activeDenominations = data.activeDenominations
  var coin = getCryptoCurrency(cryptoCode)
  const fiat = BN(tx.fiat)

  var fiatDisplay = BN(tx.fiat).toNumber().toLocaleString(jsLocaleCode, {
    useGrouping: true,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  })

  var cryptoAtoms = BN(tx.cryptoAtoms)
  var cryptoDisplay = displayCrypto(cryptoAtoms, cryptoCode)

  var cryptoDisplayCode = coin.displayCode

  setCurrentDiscount(tx.discount, tx.promoCodeApplied)

  if (cryptoAtoms.eq(0) || cryptoAtoms.isNaN()) $('#js-i18n-choose-digital-amount').hide()
  else $('#js-i18n-choose-digital-amount').show()

  if (fiat.eq(0)) $('#cash-out-button').prop('disabled', true)
  else $('#cash-out-button').prop('disabled', false)

  updateCassetteButtons(activeDenominations.activeMap, NUMBER_OF_BUTTONS)
  $('.choose_fiat_state .fiat-amount').text(fiatDisplay)
  t('choose-digital-amount',
    translate("You'll be sending %s %s", [cryptoDisplay, cryptoDisplayCode]))

  reachFiatLimit(activeDenominations)
}

function setDepositAddress (depositInfo) {
  $('.deposit_state .loading').hide()
  $('.deposit_state .send-notice .crypto-address').html(formatAddress(depositInfo.toAddress))
  $('.deposit_state .send-notice').show()

  qrize(depositInfo.depositUrl, $('#qr-code-deposit'), CASH_OUT_QR_COLOR)
}

function setVersion (version) {
  $('.version-number').html(`Version: ${version}`)
}

function deposit (tx) {
  var cryptoCode = tx.cryptoCode
  var display = displayCrypto(tx.cryptoAtoms, cryptoCode)

  $('.js-wallet-address').show()

  $('.deposit_state .digital .js-amount').html(display)
  $('.deposit_state .fiat .js-amount').text(tx.fiat)
  $('.deposit_state .send-notice').hide()
  $('#qr-code-deposit').empty()
  $('.deposit_state .loading').show()
  $('#qr-code-deposit').show()
  $('#lightning-enabled').hide()
  if (tx.cryptoCode === 'LN') $('#lightning-enabled').show()

  setState('deposit')
}

function fiatReceipt (tx) {
  var cryptoCode = tx.cryptoCode
  var display = displayCrypto(tx.cryptoAtoms, cryptoCode)

  $('.fiat_receipt_state .digital .js-amount').html(display)
  $('.fiat_receipt_state .fiat .js-amount').text(tx.fiat)
  $('.fiat_receipt_state .sent-coins .crypto-address').html(formatAddress(tx.toAddress))

  setState('fiat_receipt')
}

function fiatComplete (tx) {
  var cryptoCode = tx.cryptoCode
  var display = displayCrypto(tx.cryptoAtoms, cryptoCode)

  $('.fiat_complete_state .digital .js-amount').html(display)
  $('.fiat_complete_state .fiat .js-amount').text(tx.fiat)
  $('.fiat_complete_state .sent-coins .crypto-address').html(formatAddress(tx.toAddress))

  setState('fiat_complete')
}

function dispenseBatch (data) {
  $('.batch').css('visibility', data.of === 1 ? 'hidden' : 'visible')
  $('.batch').text(`${data.current}/${data.of}`)
}

function initDebug () {
  if (DEBUG_MODE === 'dev') {
    $('body').css('cursor', 'default')
    var style = document.createElement('style')
    style.type = 'text/css'
    style.innerHTML = 'button { cursor: default !important; }'
    document.getElementsByTagName('head')[0].appendChild(style)

    return
  }

  if (DEBUG_MODE === 'demo') {
    setPrimaryLocales(['en-US'])
    setLocale('en-US')
    $('body').css('cursor', 'default')
    var style = document.createElement('style')
    style.type = 'text/css'
    style.innerHTML = 'button { cursor: default !important; }'
    document.getElementsByTagName('head')[0].appendChild(style)

    if (!SCREEN) {
      return chooseCoin([
        { display: 'Bitcoin', cryptoCode: 'BTC' },
        { display: 'Ethereum', cryptoCode: 'ETH' },
        { display: 'ZCash', cryptoCode: 'ZEC' }
      ], true)
    }

    setState(SCREEN)
  }
}

function calculateAspectRatio () {
  const width = $('body').width()
  const height = $('body').height()

  function gcd (a, b) {
    return (b === 0) ? a : gcd(b, a % b)
  }

  const w = width
  const h = height
  const r = gcd(w, h)
  const aspectRatioPt1 = w / r
  const aspectRatioPt2 = h / r

  if (aspectRatioPt1 < aspectRatioPt2) {
    aspectRatio = '9:16'
  } else if (aspectRatioPt1 === 8 && aspectRatioPt2 === 5) {
    aspectRatio = '16:10'
  } else if (aspectRatioPt1 === 16 && aspectRatioPt2 === 9) {
    aspectRatio = '16:9'
  } else {
    aspectRatio = w < 1420 ? '16:10' : '16:9'
  }
}

let background = null

function doTransition (cb) {
  // TODO Disable animations for V1
  let toShow = null
  let toShowOver = null

  if (isTwoWay) {
    toShow = ['#bg-to-show']
    toShowOver = ['.crypto-buttons', '.cash-in-box-wrapper']
  } else {
    toShow = ['#bg-to-show']
    toShowOver = ['header', 'main']
  }

  two.start()
  var tl = new TimelineMax()
  tl.set('.fade-in-delay', { opacity: 0, y: +30 })
    .set('.fade-in', { opacity: 0, y: +30 })
    .set(toShow, { zIndex: 1 })
    .set(toShowOver, { zIndex: 2 })
    .to(background, 0.5, { scale: isTwoWay ? 3 : 2 })
    .to('.fade-in', 0.4, {
      opacity: 1,
      onStart: cb,
      y: 0
    }, '=-0.2')
    .to('.fade-in-delay', 0.4, { opacity: 1, y: 0 }, '=-0.2')
    .set(background, { scale: 1 })
    .set(toShow, { zIndex: -1 })
    .set(toShowOver, { zIndex: 0 })
  two.pause()
}

function setupAnimation (isTwoWay, isAr800) {
  var elem = document.getElementById('bg-to-show')
  while (elem.firstChild) {
    elem.removeChild(elem.firstChild)
  }
  two = new Two({ fullscreen: true, type: Two.Types.svg, autostart: true }).appendTo(elem)

  let elementId = `${isTwoWay ? 'two-way' : 'one-way'}-${isAr800 ? '800' : '1080'}${isRTL ? '-rtl' : ''}`
  background = two.interpret(document.getElementById(elementId))
  background.scale = 1
}

function shouldEnableTouch () {
  const ua = navigator.userAgent
  if (ua.match(/surf/ig)) return false

  // ACP has chromium 34 and upboard 73
  const chromiumVersion = ua.match(/chromium\/(\d+)/i)
  const chromeVersion = ua.match(/chrome\/(\d+)/i)
  const chromiumPlus73 = chromiumVersion && chromiumVersion[1] >= 73
  const chromePlus73 = chromeVersion && chromeVersion[1] >= 73

  return chromiumPlus73 || chromePlus73
}

function setAvailablePromoCodes (areThereAvailablePromoCodes) {
  if (areThereAvailablePromoCodes) {
    $('#insert-first-bill-promo-button').show()
    $('#insert-first-recycler-bills-promo-button').show()
    $('#choose-fiat-promo-button').show()
  } else {
    $('#insert-first-bill-promo-button').hide()
    $('#insert-first-recycler-bills-promo-button').hide()
    $('#choose-fiat-promo-button').hide()
  }
}

function setCurrentDiscount (currentDiscount, promoCodeApplied) {
  if (promoCodeApplied) {
    $('#insert-first-bill-promo-button').hide()
    $('#insert-first-recycler-bills-promo-button').hide()
    $('#choose-fiat-promo-button').hide()
  }

  if (!currentDiscount) {
    $('#insert-first-bill-code-added').hide()
    $('#insert-first-recycler-bills-code-added').hide()
    $('#choose-fiat-code-added').hide()
  } else if (currentDiscount > 0) {
    const successMessage = '✔ ' + translate('Discount added (%s off commissions)', [`${currentDiscount}%`])
    $('#insert-first-bill-code-added').html(successMessage)
    $('#insert-first-recycler-bills-code-added').html(successMessage)
    $('#choose-fiat-code-added').html(successMessage)
    $('#insert-first-bill-code-added').show()
    $('#insert-first-recycler-bills-code-added').show()
    $('#choose-fiat-code-added').show()

  } else {
    $('#insert-first-bill-promo-button').show()
    $('#insert-first-recycler-bills-promo-button').show()
    $('#choose-fiat-promo-button').show()
    $('#insert-first-bill-code-added').hide()
    $('#insert-first-recycler-bills-code-added').hide()
    $('#choose-fiat-code-added').hide()
  }
}

function setReceiptPrint (receiptStatus, smsReceiptStatus) {
  let status = null
  if (receiptStatus) status = receiptStatus
  else status = smsReceiptStatus

  const className = receiptStatus ? 'print-receipt' : 'send-sms-receipt'
  const printing = receiptStatus ? 'Printing receipt...' : 'Sending receipt...'
  const success = receiptStatus ? 'Receipt printed successfully!' : 'Receipt sent successfully!'

  switch (status) {
    case 'disabled':
      $(`#${className}-cash-in-message`).addClass('hide')
      $(`#${className}-cash-in-button`).addClass('hide')
      $(`#${className}-cash-out-message`).addClass('hide')
      $(`#${className}-cash-out-button`).addClass('hide')
      $(`#${className}-cash-in-fail-message`).addClass('hide')
      $(`#${className}-cash-in-fail-button`).addClass('hide')
      break
    case 'available':
      $(`#${className}-cash-in-message`).addClass('hide')
      $(`#${className}-cash-in-button`).removeClass('hide')
      $(`#${className}-cash-out-message`).addClass('hide')
      $(`#${className}-cash-out-button`).removeClass('hide')
      $(`#${className}-cash-in-fail-message`).addClass('hide')
      $(`#${className}-cash-in-fail-button`).removeClass('hide')
      break
    case 'printing':
      const message = locale.translate(printing).fetch()
      $(`#${className}-cash-in-button`).addClass('hide')
      $(`#${className}-cash-in-message`).html(message)
      $(`#${className}-cash-in-message`).removeClass('hide')
      $(`#${className}-cash-out-button`).addClass('hide')
      $(`#${className}-cash-out-message`).html(message)
      $(`#${className}-cash-out-message`).removeClass('hide')
      $(`#${className}-cash-in-fail-button`).addClass('hide')
      $(`#${className}-cash-in-fail-message`).html(message)
      $(`#${className}-cash-in-fail-message`).removeClass('hide')
      break
    case 'success':
      const successMessage = '✔ ' + locale.translate(success).fetch()
      $(`#${className}-cash-in-button`).addClass('hide')
      $(`#${className}-cash-in-message`).html(successMessage)
      $(`#${className}-cash-in-message`).removeClass('hide')
      $(`#${className}-cash-out-button`).addClass('hide')
      $(`#${className}-cash-out-message`).html(successMessage)
      $(`#${className}-cash-out-message`).removeClass('hide')
      $(`#${className}-cash-in-fail-button`).addClass('hide')
      $(`#${className}-cash-in-fail-message`).html(successMessage)
      $(`#${className}-cash-in-fail-message`).removeClass('hide')
      break
    case 'failed':
      const failMessage = '✖ ' + locale.translate('An error occurred, try again.').fetch()
      $(`#${className}-cash-in-button`).addClass('hide')
      $(`#${className}-cash-in-message`).html(failMessage)
      $(`#${className}-cash-in-message`).removeClass('hide')
      $(`#${className}-cash-out-button`).addClass('hide')
      $(`#${className}-cash-out-message`).html(failMessage)
      $(`#${className}-cash-out-message`).removeClass('hide')
      $(`#${className}-cash-in-fail-button`).addClass('hide')
      $(`#${className}-cash-in-fail-message`).html(failMessage)
      $(`#${className}-cash-in-fail-message`).removeClass('hide')
      break
  }
}

function externalCompliance (url) {
  qrize(url, $('#qr-code-external-validation'), cashDirection === 'cashIn' ? CASH_IN_QR_COLOR : CASH_OUT_QR_COLOR)
  return setScreen('external_compliance')
}

// Funkcja do obsługi przycisku przejścia do następnego ekranu
function setupTransitionButton (buttonClass, buttonAction, actionData) {
  var button = document.getElementById(buttonClass)
  touchEvent(button, function () {
    // Odblokuj wszystkie przyciski przed przejściem do następnego ekranu
    unlockButtons();
    buttonPressed(buttonAction, actionData)
  })
}

// Zamień wybrane setupButton na setupTransitionButton dla przycisków nawigacyjnych
// setupButton = setupTransitionButton;
