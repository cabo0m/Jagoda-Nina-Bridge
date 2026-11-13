# Jednorazowe odzyskanie tokenu z hosta, Chrome 0.3.3

Data: 13.11.2026.

## Powód

Użytkownik po migracji z 0.3.1 do 0.3.2 stracił token znajdujący się wcześniej w `chrome.storage.session`. Ręczne kopiowanie tokenu z pliku `server/.env` przez zdalny pulpit jest utrudnione przez lagi, dużą rozdzielczość i przełączanie okien.

## Rozwiązanie

- Rozszerzenie dodaje przycisk **„Przywróć token z hosta bez kopiowania”**. Nie wpisuje się tokenu w formularzu.
- W service workerze komenda `RECOVER_LOCAL_TOKEN` jest przyjmowana wyłącznie od zaufanej strony rozszerzenia. Najpierw sprawdza zapisaną konfigurację: tylko rola Jagoda i `http://127.0.0.1:8765`, synchronizacja nieaktywna.
- Jeżeli token jeszcze istnieje w sesji, kopiuje go do chronionego `chrome.storage.local` bez połączenia z pomocnikiem. Jeśli brak tokenu, wykonuje jeden `POST http://127.0.0.1:8766/bootstrap` z nagłówkiem `X-JNB-Local-Setup: 1`.
- Pomocnik `tools/local_bootstrap.py` to osobny, krótko działający proces Pythona. **Nie modyfikuje serwera FastAPI ani bazy**. Otwiera gniazdo wyłącznie na `127.0.0.1:8766`, sprawdza dokładny nagłówek `Origin: chrome-extension://<ID>`, `Host`, adres klienta, ścieżkę i niestandardowy nagłówek. Dla innego Origin zwraca 403; CORS nie udostępnia tokenu innym stronom. Zwraca tylko token Jagody i dane konfiguracji z lokalnego `server/.env`. Bez logowania zawartości i bez przekazywania tokenu w parametrach uruchomienia.
- Rozszerzenie porównuje zwrócony `serverUrl`, rolę i UUID z własną konfiguracją, zapisuje sam token do `chrome.storage.local` z `TRUSTED_CONTEXTS`; nie odsyła tokenu do panelu, nie zapisuje go w adresie URL ani w kodzie rozszerzenia.
- Po jednym poprawnym żądaniu pomocnik automatycznie kończy pracę. W przypadku braku użycia kończy po zadanym czasie. Każda kolejna próba wymaga ponownego uruchomienia pomocnika.
- Token w magazynie lokalnym **nie jest dodatkowo szyfrowany na dysku**; urządzenie i profil Windows muszą być zaufane. Dokładny Origin nie chroni przed lokalnym procesem, który potrafi sfałszować nagłówki HTTP; taki proces ma również możliwość bezpośredniego odczytu `server/.env`. To rozwiązanie wyłącznie dla prywatnego hosta, nie wdrażać jako publicznego endpointu.
- Stara rozmowa Bridge `52e63cc2-0bbc-4215-bb14-5b65a5bc7da4` została wcześniej trwale zatrzymana; przywrócenie tokenu **nie uruchamia START** ani nie zmienia statusu tej rozmowy. Dla kolejnego eksperymentu trzeba utworzyć nową rozmowę.

## Uruchomienie pomocnika (na hoście)

```powershell
$p = 'C:\Users\micha\Documents\Projekty\Jagoda-Nina-Bridge'
& "$p\server\.venv\Scripts\python.exe" "$p\tools\local_bootstrap.py" --credentials-file "$p\server\.env" --extension-id "lejkfnchhjbjlcfonipbbjohhanenofb" --port 8766 --expires-seconds 3600
```

Proces musi działać w chwili kliknięcia przycisku; powyższe polecenie wywołuje się z odrębnej sesji, nie trzeba go uruchamiać ponownie po sukcesie.

## Testy

- `npm run test:recovery` uruchamia prawdziwe izolowane Chromium, osobny proces pomocnika, plik z całkowicie fikcyjnymi tokenami, sprawdza zły Origin (403), odzyskanie po skasowaniu tokenu lokalnego, brak tokenu w `GET_STATUS`, automatyczne wyłączenie usługi.
- `npm test` transport/STOP oraz `npm run test:panel`, `npm run test:adapter`, `npm run test:browser` to testy regresji.
- Testy nie dotykają Chrome użytkownika ani prawdziwego tokenu i nie odpalają modelu ChatGPT.
