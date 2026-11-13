# Jagoda–Nina Bridge 0.3.1: stały panel boczny Chrome

Data: 13.11.2026. Aktualizacja UX przed rzeczywistym testem Sprintu 3.

## Co zmieniono

- `chrome.sidePanel` z globalnym `default_path: popup.html` i `setPanelBehavior({openPanelOnActionClick:true})`. Kliknięcie ikony rozszerzenia otwiera lub zamyka panel boczny. Nie korzysta już z automatycznie zamykanego popupu.
- Szerokość panelu regulowana przez Chrome; interfejs zajmuje całą wysokość dostępnego okna, bez ograniczenia do 510 px. Panel pozostaje otwarty podczas zmiany kart w tym samym oknie.
- Etykieta jasno odróżnia UUID rozmowy Bridge od adresu `https://chatgpt.com/c/<UUID>`. Nie podmienia się jednego drugim.
- Dodano przycisk `Przypnij aktywną kartę ChatGPT`: backend odczytuje wyłącznie bieżącą kartę ChatGPT i sprawdza dokładny URL, po czym wykorzystuje ten sam istniejący proces PROBE i BIND co przy ręcznym adresie. Nie uzyskuje uprawnienia `tabs`, korzysta z wąskiego `host_permissions` dla ChatGPT.
- Błędy są w nagłówku przewijanej zawartości z `position: sticky`, dlatego po nieudanej próbie przypięcia są widoczne także przy przewinięciu do sekcji adaptera. Stan `Brak przypiętej rozmowy` zmienia się dopiero po skutecznym kliknięciu przycisku.
- Bez zmian w serwerze, schemacie SQLite, lease, API, logice ACK i STOP. Brak ingerencji w oryginalne rozszerzenie Video Summary.

## Wyniki testów

- Składnia JS przez Node: PASS.
- `npm test`: 6/6 PASS.
- `npm run test:panel`: PASS w prawdziwym izolowanym Chromium: Chrome `sidePanel.getOptions({})` wskazuje `popup.html`, `getPanelBehavior()` potwierdza otwieranie ikoną; test układu UI 820 px wysokości -> 755 px treści, widoczny przycisk i komunikaty.
- `npm run test:adapter`: PASS w dwóch izolowanych profilach Chromium z lokalnym realnym FastAPI i podstawioną stroną DOM ChatGPT; sprawdzono przypinanie aktywnej karty BEZ kopiowania URL, pojedynczy prompt, odpowiedź, ACK i STOP oraz późny wynik po STOP.
- `npm run test:browser`: PASS, regresja transportu, alarmu, ACK i STOP.
- `server/.venv/Scripts/python.exe -m pytest -q tests` uruchomione z katalogu `server`: 8/8 PASS, jedno ostrzeżenie deprecacyjne.
- **Nie wykonywano rzeczywistej próby na zalogowanej sesji ChatGPT WWW.** Integracja DOM nadal jest eksperymentalna.

## Aktualizacja na hoście

Instalacja na domyślnym profilu Chrome używa źródeł z `C:\Users\micha\Documents\Projekty\Jagoda-Nina-Bridge\extension`. Aby zastosować zmieniony manifest:
1. Otworzyć `chrome://extensions`.
2. Przy `Jagoda–Nina Bridge` kliknąć **Odśwież** (okrągła strzałka), nie `Usuń`. **Nie należy ponownie instalować rozszerzenia**.
3. Kliknąć jego ikonę na pasku Chrome: powinien otworzyć się panel boczny po prawej/lewej stronie. Panel nie zamknie się po zmianie karty.
4. Sprawdzić status START. Aktualizacja rozszerzenia może wyczyścić `chrome.storage.session` (token, leases) i zgasić START. Jeśli pojawi się `Podaj token`, wkleić właściwy token z lokalnego ignorowanego przez Git `server/.env`, zapisać konfigurację i ponownie kliknąć START.
5. W głównej karcie Chrome otworzyć gotowy wątek `https://chatgpt.com/c/<UUID>`, panel boczny pozostawić otwarty, kliknąć `Przypnij aktywną kartę ChatGPT`. Pełny URL można też wpisać ręcznie i użyć `Przypnij`.
6. Gdy pole pokazuje `Przypięto kartę...`, adapter ma poprawne powiązanie. `Brak przypiętej rozmowy` oznacza, że nie doszło do poprawnego przypięcia.

**Nie używać UUID Bridge do identyfikacji rozmowy ChatGPT.** Karta musi mieć adres `/c/<UUID>`; samo `chatgpt.com` lub ekran nowej rozmowy bez stałego adresu nie wystarczy. Chrome nie otworzy panelu automatycznie po starcie bez interakcji użytkownika, ale po otwarciu panel może towarzyszyć przełączaniu kart.

## Ograniczenia

- Globalny panel boczny ma pełną wysokość okna i regulowaną szerokość, lecz nie jest stroną zajmującą cały ekran; Chrome może go zamknąć na żądanie użytkownika lub przy zamknięciu okna.
- Aktualizacja za pomocą `chrome://extensions` nie jest automatyczna dla katalogu rozpakowanego. Trzeba kliknąć Odśwież po zmianach kodu.
- Tokeny pozostają w `chrome.storage.session`, nie w `chrome.storage.local`; brak trwałego zapisu tokenów jest świadomą właściwością bezpieczeństwa.
