# Jagoda–Nina Bridge: Sprint 3, implementacja adaptera ChatGPT

Data: 13.11.2026
Wersja rozszerzenia: 0.3.0
Status: **implementacja gotowa, test prawdziwego ChatGPT WWW NIEPRZEPROWADZONY; sprint czeka na końcowy odbiór.**

## Faktycznie zaimplementowano

- Nowy `chatgpt-adapter.mjs`: ścisła walidacja dedykowanego `https://chatgpt.com/c/<UUID>`, formowanie pojedynczego promptu Niny, walidacja wyniku.
- `chatgpt-bridge.js`: skrypt uruchamiany przez `chrome.scripting.executeScript` tylko we wskazanej karcie; sprawdza dokładny URL i pusty edytor, wprowadza cały prompt i potwierdza wysłanie przez nową wiadomość użytkownika, odróżnia nową odpowiedź asystenta od istniejących, czeka na koniec generowania, a potem zwraca tylko tę odpowiedź.
- `background.js`: przypinanie jednej wybranej rozmowy; odpytywanie własnej skrzynki przez istniejący polling, claim dopiero po pozytywnym PROBE, `dispatch-start` przed kliknięciem Send, bez ponowienia promptu przy niepewnym stanie; publikacja odpowiedzi do serwera z `reply_to_id`, idempotencją i ACK.
- Wymiana w tym sprincie: Nina wysyła pierwszą wiadomość w popupie, Jagoda odpowiada automatycznie w przypiętej dedykowanej rozmowie ChatGPT, Nina odbiera odpowiedź w popupie i potwierdza ACK (bez wywoływania drugiej generacji Niny). Serwer zamyka rozmowę po drugim ACK.
- Wyświetlanie fazy adaptera i błędów, opcjonalne odpięcie (tylko bez rozpoczętego zadania), bez automatycznego przekazywania historii konta, bez MAPI.
- Manifest MV3: `storage`, `alarms`, `scripting`; host permissions tylko lokalnego serwera i `https://chatgpt.com/*`, opcjonalne uprawnienie do wybranej domeny HTTPS serwera. Bez `tabs`, `history`, `cookies`, globalnych `content_scripts`.

## Wyniki testów

- `npm test`: **6/6 PASS** (poprzednie testy Sprintu 2 oraz walidacja URL/promptu/odpowiedzi).
- `npm run test:adapter`: **PASS** w dwóch rzeczywistych profilach Chromium z rozpakowanym rozszerzeniem i realnym FastAPI HTTP. Specjalna strona-fixture została podstawiona pod URL testowej rozmowy ChatGPT. Zbadano:
  - odmowę przypięcia niewłaściwego URL, bez dostępu do obcej karty;
  - odmowę rezerwacji wiadomości, gdy karta docelowa nie ma gotowego pola wpisywania (status queued, attempts=0);
  - wprowadzenie promptu do jednej właściwej karty, wykrycie wysłanego promptu;
  - odczyt wyłącznie NOWEJ odpowiedzi asystenta, z pominięciem starszej odpowiedzi w DOM;
  - zapis na serwerze odpowiedzi Jagody z `reply_to_id` i ACK wiadomości Niny;
  - odbiór przez Ninę, drugi ACK, dokładnie dwie wiadomości i STOP;
  - ręczny STOP podczas symulowanego generowania: odpowiedź przychodząca po STOP została odrzucona, liczba wiadomości pozostała równa 1.
- `npm run test:browser`: regresja Sprintu 2 w prawdziwym Chromium: transport + automatyczny alarm + ręczny STOP, PASS.
- Testy API serwera Sprintu 1: bez regresji.
- Sprawdzenie składni JavaScript/manifest i różnic Git: PASS.
- Testy na prywatnej, zalogowanej sesji ChatGPT WWW: **NIEPRZEPROWADZONE**. Wynik strony-fixture nie jest dowodem, że aktualny DOM usługi da identyczny rezultat.

## Granice i ryzyka

- Integracja DOM ChatGPT jest podatna na zmiany selektorów `#prompt-textarea`, `[data-message-author-role]`, `stop-button`. Na nierozpoznanej stronie ma się zatrzymać, nie zgadywać wyniku.
- Przypadki przeładowania/zamknięcia karty, ograniczeń modelu i zerwania połączenia po `dispatch-start` są zatrzymywane z wymaganiem kontroli, bez ponownego wysyłania promptu. Nie potwierdzono ich jeszcze na prawdziwym ChatGPT.
- Prompt przypomina o nieujawnianiu prywatnych danych, ale nie gwarantuje całkowitego braku wpływu pamięci konta ChatGPT. Test realny prowadzić w dedykowanej rozmowie bez wrażliwego kontekstu.
- Model Niny nie generuje automatycznie odpowiedzi na odebraną odpowiedź Jagody. Taki brak kolejnej tury jest zamierzonym STOP MVP.
- Nie uruchamiano VPS ani nie publikowano GitHub. Brak dwóch fizycznych komputerów, zewnętrznego HTTPS oraz rzeczywistego E2E modeli.

## Odbiór

Implementacja adaptera i symulowany test Chromium zakończone. **Do formalnego zamknięcia Sprintu 3 brakuje jednej rzeczywistej próby na zalogowanej, dedykowanej sesji ChatGPT, z porównaniem odpowiedzi modelu i zapisu w SQLite.** Tę próbę należy przeprowadzić w kontrolowanym środowisku, bez otwierania niezwiązanych rozmów. Nie rozpoczynać Sprintu 4 przed odbiorem.
