# Lamassu Machine - Dokumentacja Techniczna

## Spis treści
1. [Wprowadzenie](#wprowadzenie)
2. [Architektura systemu](#architektura-systemu)
3. [Szczegółowa struktura projektu](#szczegółowa-struktura-projektu)
4. [Kluczowe procesy](#kluczowe-procesy)
5. [Przepływ transakcji](#przepływ-transakcji)
6. [Komunikacja z serwerem](#komunikacja-z-serwerem)
7. [Konfiguracja systemu](#konfiguracja-systemu)
8. [Procedury instalacji i uruchamiania](#procedury-instalacji-i-uruchamiania)
9. [Tryby testowe i debugowanie](#tryby-testowe-i-debugowanie)
10. [Zarządzanie urządzeniami peryferyjnymi](#zarządzanie-urządzeniami-peryferyjnymi)

## Wprowadzenie

Lamassu Machine to kompleksowy system oprogramowania zaprojektowany do obsługi bankomatów kryptowalutowych firmy Lamassu. Projekt umożliwia dwukierunkową wymianę między kryptowalutami a tradycyjnymi walutami fiducjarnymi, obsługując zarówno wpłaty gotówkowe (zakup kryptowalut) jak i wypłaty (sprzedaż kryptowalut). System został zaprojektowany modułowo, co pozwala na elastyczną integrację z różnymi komponentami sprzętowymi oraz dostosowanie do różnych wymagań regulacyjnych w różnych jurysdykcjach.

## Architektura systemu

System Lamassu Machine zbudowany jest wokół centralnego modułu zwanego "Brain" (Mózg), który koordynuje wszystkie inne komponenty i zarządza logiką biznesową. Architektura oparta jest na modelu event-driven (sterowanym zdarzeniami), gdzie różne komponenty komunikują się poprzez emisję i nasłuchiwanie zdarzeń.

### Główne komponenty architektoniczne:

1. **Brain (Mózg)** - Centralny moduł sterujący, zaimplementowany w `lib/brain.js`
   - Zarządza stanem maszyny i przejściami między stanami
   - Koordynuje komunikację między różnymi modułami
   - Obsługuje logikę biznesową transakcji

2. **Walidatory banknotów** - Komponenty do przyjmowania i weryfikacji gotówki
   - Obsługiwane modele: CashflowSC, ID003, BNR, CCNet, F56 i inne
   - Implementacja w katalogu `lib/{model}`, np. `lib/id003/`

3. **Podajniki banknotów** - Komponenty do wydawania gotówki
   - Obsługiwane modele: F56, Puloon, HCM2, Genmega
   - Implementacja w katalalogu `lib/{model}`, np. `lib/puloon/`

4. **Interfejs użytkownika** - Interaktywny frontend dla klientów
   - Implementacja w katalogu `ui/`
   - Technologie: HTML, CSS, JavaScript z transpilacją Babel

5. **Moduł komunikacyjny (Trader)** - Zarządza komunikacją z serwerem Lamassu
   - Implementacja w `lib/trader.js`
   - Obsługuje zapytania GraphQL i WebSocket

6. **Moduł zgodności (Compliance)** - Zarządza procesami KYC/AML
   - Implementacja w katalogu `lib/compliance/`
   - Obsługuje weryfikację SMS, e-mail, skanowanie dokumentów tożsamości itp.

7. **Moduły peryferyjne** - Komponenty do obsługi urządzeń dodatkowych
   - Skaner QR (`lib/scanner.js`, `lib/scanner-newland.js`, `lib/scanner-genmega.js`)
   - Drukarka paragonów (`lib/printer/`)
   - Kamera (`lib/camera-streamer.js`)
   - System LED (`lib/leds/`)

8. **Moduł aktualizacji** - Zarządza aktualizacjami oprogramowania
   - Implementacja w katalogu `lib/update/`

## Szczegółowa struktura projektu

### Katalogi główne:

#### `/bin` - Skrypty wykonywalne
- `lamassu-machine` - Główny plik wykonywalny, punkt startowy aplikacji
- `fake-bills.js` - Symulator walidatora banknotów do testowania

#### `/lib` - Główna logika biznesowa
- `brain.js` - Centralny moduł sterujący
- `trader.js` - Komunikacja z serwerem Lamassu
- `/compliance/` - Funkcje związane z procesami KYC/AML
- `/id003/`, `/f56/`, `/mei/`, `/ccnet/`, `/puloon/` - Sterowniki dla różnych urządzeń peryferyjnych
- `/update/` - Funkcje do aktualizacji oprogramowania
- `/mocks/` - Symulatory dla różnych komponentów (do testowania)

#### `/ui` - Interfejs użytkownika
- `/src/` - Kod źródłowy JavaScript interfejsu
- `/html/` - Szablony HTML
- `/css/` - Style CSS/SCSS
- `/images/` - Zasoby graficzne
- `/sounds/` - Zasoby dźwiękowe
- `start.html` - Główna strona interfejsu użytkownika

#### `/i18n` - Lokalizacja i internacjonalizacja
- Pliki tłumaczeń dla różnych języków
- Skrypty do przetwarzania i kompilacji tłumaczeń

#### `/hardware` - Sterowniki sprzętowe niskiego poziomu
- Sterowniki urządzeń specyficznych dla Lamassu
- Konfiguracja i komunikacja z komponentami sprzętowymi

#### `/deploy` - Narzędzia wdrożeniowe
- Skrypty i konfiguracje do wdrażania systemu na urządzeniach

#### `/build-scripts` - Skrypty kompilacji
- Skrypty do budowania i pakowania projektu

#### `/data` - Dane aplikacji
- Lokalne magazyny danych
- Pliki konfiguracyjne dla trybu produkcyjnego

#### Pozostałe katalogi:
- `/test/` - Testy jednostkowe i integracyjne
- `/tools/` - Narzędzia pomocnicze dla deweloperów
- `/mock_data/` - Dane testowe
- `/verify/` - Narzędzia do weryfikacji instalacji i działania

### Kluczowe pliki:

- `device_config.json` - Główna konfiguracja dla konkretnego urządzenia
- `package.json` - Definicja zależności i skryptów npm
- `setup.sh` - Skrypt konfiguracji początkowej
- `watchdog.js` - Skrypt monitorujący działanie aplikacji
- `Dockerfile` - Konfiguracja do budowania kontenera Docker

## Kluczowe procesy

### Proces uruchamiania

1. Uruchamiany jest plik `bin/lamassu-machine`
2. Ładowana jest konfiguracja z `device_config.json`
3. Inicjalizowany jest moduł Brain (`lib/brain.js`)
4. Brain inicjalizuje pozostałe moduły w zależności od konfiguracji
5. Interfejs użytkownika jest ładowany i wyświetlany na ekranie
6. System przechodzi do stanu oczekiwania na akcję użytkownika

### Proces parowania z serwerem

1. Administrator generuje token parowania w panelu administratora serwera Lamassu
2. Token jest wprowadzany podczas uruchamiania maszyny za pomocą flagi `--mockPair`
3. Moduł `lib/pairing.js` tworzy parę kluczy i wymienia je z serwerem
4. Po pomyślnym parowaniu, klucze są zapisywane i używane do szyfrowanej komunikacji

### Aktualizacja oprogramowania

1. Serwer Lamassu wysyła powiadomienie o dostępnej aktualizacji
2. Moduł `lib/update` pobiera pakiet aktualizacji
3. Pakiet jest weryfikowany przy użyciu klucza publicznego Lamassu
4. Aktualizacja jest instalowana i system jest restartowany

## Przepływ transakcji

### Zakup kryptowaluty (Cash-in)

1. **Inicjalizacja**
   - Użytkownik wybiera kryptowalutę do zakupu
   - System łączy się z serwerem, aby uzyskać aktualny kurs wymiany

2. **Identyfikacja klienta (opcjonalnie, zależnie od konfiguracji)**
   - System może wymagać skanowania dokumentu tożsamości
   - Weryfikacja przez SMS lub e-mail
   - Sprawdzenie na listach sankcyjnych

3. **Wpłata gotówki**
   - Użytkownik wkłada banknoty do walidatora
   - Banknoty są weryfikowane i akceptowane lub odrzucane
   - System aktualizuje kwotę transakcji w czasie rzeczywistym

4. **Finalizacja transakcji**
   - Użytkownik skanuje kod QR swojego portfela lub wprowadza adres
   - System potwierdza transakcję z serwerem
   - Drukowane jest potwierdzenie (jeśli skonfigurowano)

### Sprzedaż kryptowaluty (Cash-out)

1. **Inicjalizacja**
   - Użytkownik wybiera kwotę do wypłaty
   - System generuje adres do wysłania kryptowaluty

2. **Identyfikacja klienta**
   - Podobnie jak przy zakupie, z potencjalnie wyższymi wymogami

3. **Weryfikacja płatności**
   - Użytkownik wysyła kryptowalutę na wygenerowany adres
   - System czeka na potwierdzenie transakcji

4. **Wypłata gotówki**
   - System aktywuje podajnik banknotów
   - Gotówka jest wydawana użytkownikowi
   - Drukowane jest potwierdzenie

## Komunikacja z serwerem

System komunikuje się z serwerem Lamassu za pomocą następujących kanałów:

1. **GraphQL API** - Używane do większości operacji, takich jak:
   - Pobieranie kursów wymiany
   - Przekazywanie danych transakcji
   - Potwierdzanie transakcji
   - Implementacja w `lib/graphql-client.js`

2. **WebSocket** - Używane do komunikacji w czasie rzeczywistym:
   - Powiadomienia o aktualizacjach
   - Monitorowanie stanu maszyny
   - Implementacja jako część `lib/trader.js`

3. **HTTPS** - Używane do:
   - Pobierania aktualizacji oprogramowania
   - Przesyłania logów i danych diagnostycznych
   - Implementacja w `lib/request.js`

Komunikacja jest zabezpieczona przy użyciu TLS z certyfikatami wygenerowanymi podczas procesu parowania.

## Konfiguracja systemu

### Plik `device_config.json`

Główny plik konfiguracyjny zawiera następujące sekcje:

```json
{
 "cryptomatMaker": "centurion",       // Producent urządzenia
 "cryptomatModel": "centurion",       // Model urządzenia
  "brain": {
    "dataPath": "data",               // Ścieżka do katalogu danych
    "wifiDisabled": true              // Czy WiFi jest wyłączone
  },
  "kioskPrinter": {                   // Konfiguracja drukarki
    "model": "Sanei-SK-21",
    "address": "SANEI-SK4-21-Series"
  },
  "compliance": {                     // Konfiguracja mechanizmów zgodności
    "paperWallet": false
  },
  "frontFacingCamera": {              // Kamera przednia
    "device":"/dev/video_front_camera"
  },
  "scanner": {                        // Skaner kodów QR
    "type": "newland",
    "device": "/dev/hidraw0"
  },
  "billValidator": {                  // Walidator banknotów
    "deviceType": "cashflowSc",
    "rs232": {
      "device": "/dev/ttyUSB1"
    }
  },
  "billDispenser": {                  // Podajnik banknotów
    "model": "f56",
    "device": "/dev/ttyUSB0"
  },
  "updater": {                        // Konfiguracja aktualizacji
    "caFile": "/opt/certs/lamassu.pem",
    "extractor": {
      "lamassuPubKeyFile": "/opt/certs/lamassu.pub.key"
    },
    "packageJsonDir": "/opt/lamassu-machine"
  }
}
```

### Konfiguracja przez serwer

Część konfiguracji jest zarządzana przez serwer Lamassu i przesyłana do maszyny, w tym:
- Limity transakcji
- Obsługiwane kryptowaluty
- Konfiguracja mechanizmów zgodności (KYC/AML)
- Opcje interfejsu użytkownika

## Procedury instalacji i uruchamiania

### Instalacja

Szczegółowe instrukcje instalacji znajdują się w plikach [INSTALL.md](INSTALL.md) i [INSTALL-NIX.md](INSTALL-NIX.md). Podstawowy proces obejmuje:

1. Instalacja zależności systemowych
   ```bash
   sudo apt-get install build-essential cmake libgtk2.0-dev pkg-config \
       libavcodec-dev libavformat-dev libswscale-dev \
       libv4l-dev libasound2-dev gcc-4.9 g++-4.9
   ```

2. Instalacja zależności Node.js
   ```bash
   export CXX="g++-4.9"
   npm install -g node-gyp node-pre-gyp
   npm install
   ```

3. Konfiguracja podstawowa
   ```bash
   bash ./setup.sh
   npm run build
   ```

### Uruchamianie

#### Tryb normalny
```bash
node bin/lamassu-machine
```

#### Tryb testowy z symulatorami
```bash
# Terminal 1 - symulator walidatora banknotów
node bin/fake-bills.js

# Terminal 2 - główny program
node bin/lamassu-machine --mockBillValidator --mockBillDispenser --mockCam --devBoard
```

#### Parowanie z serwerem
```bash
node bin/lamassu-machine --mockPair '<totem-from-admin>'
```

## Tryby testowe i debugowanie

### Symulatory urządzeń

System oferuje symulatory dla większości urządzeń peryferyjnych:
- `--mockBillValidator` - Symulator walidatora banknotów
- `--mockBillDispenser` - Symulator podajnika banknotów
- `--mockCam` - Symulator kamery i skanera QR
- `--mockPair` - Symulator procesu parowania

### Debugowanie interfejsu użytkownika

Interfejs użytkownika można uruchomić w przeglądarce w trybie debugowania:
```
file://<lamassu-machine-dir>/ui/start.html?debug=dev
```

### Logi i monitorowanie

System generuje logi w różnych poziomach szczegółowości:
- Logi operacyjne - informacje o normalnym działaniu
- Logi debugowania - szczegółowe informacje dla deweloperów
- Logi błędów - informacje o błędach i wyjątkach

Logi są przechowywane lokalnie oraz mogą być przekazywane do serwera Lamassu.

## Zarządzanie urządzeniami peryferyjnymi

### Walidatory banknotów

System obsługuje różne modele walidatorów, w tym:
- CashflowSC (`lib/mei/cashflow_sc.js`)
- ID003 (`lib/id003/id003.js`)
- F56 (`lib/f56/f56.js`)
- CCNet (`lib/ccnet/ccnet.js`)
- Genmega (`lib/genmega/genmega.js`)

Każdy sterownik implementuje standardowy interfejs z metodami:
- `connect()` - Nawiązanie połączenia z urządzeniem
- `disconnect()` - Zamknięcie połączenia
- `acceptBill()` - Rozpoczęcie akceptacji banknotów
- `disable()` - Wyłączenie akceptacji banknotów

### Podajniki banknotów

System obsługuje różne modele podajników, w tym:
- F56 (`lib/f56/f56-dispenser.js`)
- Puloon (`lib/puloon/puloon.js`)
- HCM2 (`lib/hcm2/hcm2.js`)

Interfejs obejmuje metody:
- `dispense(notes)` - Wydanie określonej liczby banknotów
- `reset()` - Resetowanie urządzenia
- `getStatus()` - Sprawdzenie stanu urządzenia

### Skanery i kamery

System obsługuje różne typy skanerów kodów QR:
- Standardowy skaner USB (`lib/scanner.js`)
- Skaner Newland (`lib/scanner-newland.js`)
- Skaner Genmega (`lib/scanner-genmega.js`)

Kamery są używane do:
- Skanowania kodów QR
- Robienia zdjęć dokumentów tożsamości
- Robienia zdjęć twarzy klienta

### Drukarki

System obsługuje drukarki paragonów do:
- Drukowania potwierdzeń transakcji
- Drukowania portfeli papierowych
- Drukowania raportów systemowych

---

Ten dokument przedstawia ogólny przegląd struktury i procesów w systemie Lamassu Machine. Dla szczegółowych informacji technicznych, należy zapoznać się z kodem źródłowym oraz dokumentacją poszczególnych komponentów.

