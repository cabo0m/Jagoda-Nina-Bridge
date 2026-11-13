# Jagoda–Nina Bridge: Sprint 2, protokół odbioru

Data: 2026-11-13
Zakres: jedno rozszerzenie Chrome MV3 dla obu uczestniczek, transport wiadomości, START/STOP, konfiguracja i status. Bez automatyzacji ChatGPT.

## Wykonanie

- `extension/manifest.json`: MV3, wymagane tylko `storage`, `alarms` oraz lokalne host permissions; HTTPS per wybrana domena na osobną zgodę.
- `extension/bridge-core.mjs`: walidacja konfiguracji HTTPS/localhost, UUID, tokenu, payloadu, idempotencji i wyodrębnianie bezpiecznych pól wiadomości.
- `extension/background.js`: niezależny koordynator transportu w service workerze, skopiowanie danych tylko z własnej skrzynki serwera, żądania REST, atomowa obsługa zdarzeń, `chrome.alarms` 0.5 min, odporny na usypianie worker, token wyłącznie `chrome.storage.session`, automatyczne wyłączenie lokalnego polling po restarcie bez tokenu.
- `extension/popup.html`, `popup.js`, `popup.css`: konfiguracja, START/STOP, status, wysyłka, ręczne ACK, odświeżanie w czasie reakcji alarmu; brak HTML ze zdalnych danych.
- `extension/tests/transport.test.mjs`: 5 testów integracyjnych kodu workera z odizolowanymi symulowanymi instancjami Chrome API i prawdziwym serwerem FastAPI HTTP.
- `extension/tests/chrome-live.mjs`: rzeczywisty Chromium z dwoma niezależnymi profilami, dwoma tokenami, przeglądarkowym UI i prawdziwym serwerem; test alarmu oraz ręcznego STOP.

## Wyniki faktycznych uruchomień

- `node --check` dla modułów JS, MJS i skryptów testowych: PASS.
- `npm test`: **5/5 PASS**.
- `npm run test:browser`: **PASS**, dwa niezależne profile Chromium z załadowanym rozpakowanym rozszerzeniem, realny FastAPI HTTP, 2 wiadomości, 2 ACK, automatyczny STOP. Bez logowania do ChatGPT.
- **REAL CHROMIUM ALARM PASS**: wiadomość Niny pojawiła się w otwartym popupie Jagody bez ręcznego kliknięcia `Odśwież`, przez automatyczny alarm/service worker.
- **REAL CHROMIUM MANUAL STOP PASS**: dodatkowa rozmowa testowa, kliknięcie STOP i potwierdzenie w popupie, zdalny stan `stopped` zweryfikowany przez HTTP.
- Wszystkie testowe bazy i profile były tymczasowe; procesy lokalnego Uvicorn zakończono.

## Błędy wykryte i poprawione podczas Sprintu 2

1. Chrome match patterns nie obsługują numeru portu: poprawiono `permissionOrigin` tak, by zgoda dotyczyła schematu i hosta.
2. Otwarta w osobnej karcie strona popupu ma `sender.tab`; początkowa kontrola odrzucała również legalnego nadawcę. Zastąpiono ją sprawdzeniem dokładnego `sender.url === chrome.runtime.getURL('popup.html')`.
3. Headless Chromium nie finalizował opcjonalnego dialogu host permission dla testowego localhost. Lokalne adresy wpisano jako wymagane host_permissions, a konkretne zewnętrzne HTTPS pozostały opcjonalne.
4. Uzupełniono automatyczne aktualizowanie otwartego popupu przy zmianie `chrome.storage.session` podczas cyklu alarmu.
5. Poprawiono pomocniczą komendę SQL w teście ręcznego STOP, przenosząc `open` do parametru; dotyczyło to wyłącznie fixture testowej.

## Ryzyka / niewykonane

- Nie testowano dwóch fizycznych komputerów ani hostingu HTTPS, bo wdrożenie VPS wymaga osobnej zgody.
- Zewnętrzna zgoda na HTTPS `chrome.permissions.request` wymaga jeszcze rzeczywistego testu przy wybranej domenie serwera. Test lokalny działa na wymaganych uprawnieniach loopback.
- Nie włączono ani nie testowano automatycznej interakcji z ChatGPT WWW, odczytu z DOM, treści kont ani kontekstu Niny/Jagody.
- Brak restart/recovery testu otwartego popupu w prawdziwym Chrome po ponownym uruchomieniu systemu; logikę braku tokenu objęto testami workera.
- Na Chrome Alarms nie można liczyć jako sztywne SLA 30 sekund; rzeczywisty trigger może być opóźniony.
- Nie publikowano GitHub ani nie uruchamiano usług na VPS.

## Najbliższy krok

Po formalnym odbiorze właściciela: Sprint 3, osobny adapter ChatGPT WWW oparty na audycie Video Summary, ale bez modyfikowania oryginalnego rozszerzenia.
