# Jagoda–Nina Bridge 0.3.2: STOP i token po aktualizacji

Data: 13.11.2026

## Problem produkcyjny

Po aktualizacji do 0.3.1 użytkownik zgłosił, że STOP w panelu nie działa i znika token. Kontrola serwera przez MAPI potwierdziła, że rozmowa `52e63cc2-0bbc-4215-bb14-5b65a5bc7da4` w bazie miała status `open` i 0 wiadomości. Operator wymusił `POST /v1/conversations/{id}/stop` z prawidłową autoryzacją. HTTP 200, ponowny GET i odczyt SQLite potwierdziły `stopped`, 0 wiadomości. Bez ingerencji w czat ChatGPT.

## Poprawki 0.3.2

1. **Priorytetowy STOP**: kliknięcie bez blokującego `window.confirm()`, bez wspólnej blokady `busy` z pozostałymi operacjami. Panel natychmiast ustawia lokalny `ACTIVE_KEY=false` i wyłącza alarm, następnie wysyła STOP do workera.
2. Worker przyjmuje STOP poza kolejką `serialized` (kolejka może czekać na HTTP albo DOM ChatGPT). Sygnał `stopRequested` blokuje rozpoczęcie kolejnych operacji, `stopEpoch` zabezpiecza przed wyścigiem podczas synchronicznego START/odczytu skrzynki. Serwer pozostaje ostatecznym źródłem prawdy. Przesłanej wcześniej wiadomości nie można cofnąć.
3. **Jawny wynik STOP**: po potwierdzeniu HTTP komunikat `STOP POTWIERDZONY`; po błędzie sieci `STOP LOKALNY / zdalny niepotwierdzony`. Nigdy nie twierdzimy, że serwer jest zatrzymany, gdy nie ma jego potwierdzenia.
4. **Token trwały między aktualizacjami**: zapisany jako osobny `TOKEN_KEY` w `chrome.storage.local` z `setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})`, nie wewnątrz publicznej konfiguracji. Runtime do popupu zwraca wyłącznie `tokenReady`. Dodatkowy odczyt `chrome.storage.session` tylko dla migracji działającego profilu ze starszej wersji. `CONFIGURE` zapisuje token lokalnie i usuwa kopię sesyjną.
5. W przypadku niepotwierdzonego STOP ponowna konfiguracja tego samego serwera i UUID nie zeruje ostrzeżenia o niepewnym zdalnym stanie. Najpierw należy ponowić STOP.
6. **Przy każdym restarcie** sam token jest dostępny, ale `START` pozostaje wyłączony. Nie uruchamiamy eksperymentu samoczynnie po aktualizacji/restartowaniu Chrome.

## Bezpieczeństwo tokenu

`chrome.storage.local` jest magazynem trwałym zapisanym w profilu Chrome na dysku i **nie jest tajnym, dodatkowo szyfrowanym sejfem**. Zastosowano ograniczenie `TRUSTED_CONTEXTS`, dlatego skrypty wstrzykiwane do stron nie mogą odczytać go przez API storage. Osoby lub programy posiadające dostęp do plików profilu Chrome mogą potencjalnie odczytać token. To świadomy kompromis ergonomiczny dla lokalnego eksperymentu; nie należy w ten sposób przechowywać haseł kont ani kluczy produkcyjnych. Przed udostępnieniem profilu Chrome należy usunąć rozszerzenie i unieważnić token na serwerze.

**Token zapisany wyłącznie w sesji poprzedniej wersji, który już został utracony przy reload, nie może zostać odzyskany przez zmianę kodu.** Konieczne będzie jednorazowe ponowne wprowadzenie tokenu w danym profilu Chrome. Potem token pozostanie między restartami i aktualizacjami, o ile rozszerzenie nie zostanie usunięte.

## Testy

- `npm test`: 8/8 PASS, obejmuje STOP wyprzedzający zablokowane HTTP, STOP lokalny bez tokenu i trwałą konfigurację.
- `npm run test:panel`: realny Chromium z izolowanym profilem, wysokość panelu oraz zachowanie przycisku STOP bez `confirm()` PASS; po zamknięciu i ponownym uruchomieniu Chrome z tym samym profilem token pozostaje dostępny, START pozostaje wyłączony, PASS.
- `npm run test:adapter`: PASS w dwóch izolowanych profilach Chromium z fikcyjną stroną ChatGPT i prawdziwym lokalnym FastAPI HTTP (1 prompt, nowa odpowiedź, ACK, STOP; późna odpowiedź po STOP ignorowana).
- `npm run test:browser`: PASS w rzeczywistym Chromium (dwa niezależne profile, ręczny transport, alarm, ACK, STOP).
- `server/.venv/Scripts/python.exe -m pytest -q tests`: 8/8 PASS (jedno ostrzeżenie deprecacyjne).

Nie dotykano prywatnej rozmowy ChatGPT i nie uruchomiono eksperymentu z prawdziwym modelem. Rozmowa o UUID powyżej jest nieodwracalnie zatrzymana; nowy eksperyment wymaga nowego UUID.
