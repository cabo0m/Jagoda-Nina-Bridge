# Jagoda–Nina Bridge 0.3.7: rozpoznawanie edytora ChatGPT

Data: 13.11.2026.

## Zgłoszenie

Użytkownik na rzeczywistej, zalogowanej karcie ChatGPT i po wklejeniu pełnego URL dostawał komunikat:
`Nie przypięto: Brak gotowego edytora ChatGPT (zaloguj się i otwórz rozmowę).`

Karta jest odnajdywana, rozszerzenie potrafi wstrzyknąć content script i wymienić wiadomość `JNB_PROBE`, lecz dotychczasowy `editor()` szukał wyłącznie `#prompt-textarea[contenteditable]` / `textarea#prompt-textarea`. W aktualnym interfejsie ChatGPT występuje również edytor w `form[data-chatgpt-composer]` / `[data-composer-input]` / `[data-composer-markdown]` bez `#prompt-textarea`. Weryfikacja zewnętrzna: repozytorium `miuuyy/codex-chatgpt-web` issue #813 z października 2026 i plik `chatgpt-session.ts`, a także `kanishkaverma/chatgpt-shortcuts`.

Nie ma podstaw, aby komunikat o braku edytora interpretować jako brak zalogowania. Nie uzyskano jednak dostępu do DOM rzeczywistej karty użytkownika; poprawka wymaga późniejszej weryfikacji w jego profilu.

## Zmiany

- Adapter wybiera przede wszystkim dedykowany główny edytor w formularzu `data-chatgpt-composer` albo wnętrzu `data-composer-input`, nadal wspiera dawny `#prompt-textarea` i ograniczone warianty `textarea`. Zasady: pojedynczy widoczny, edytowalny węzeł, poza modalem `role=dialog`, bez `aria-hidden` lub `disabled`. Jeśli dwa węzły pasują do jednej strategii, *odmawia przypięcia* zamiast wybierać losowo.
- Nie stosuje ogólnego `document.querySelector('.ProseMirror')`, bo pole edycji starej wiadomości też jest `ProseMirror`.
- Na wyrenderowanie pola czeka do ok. 5,5 s. Nie klika ani nie wysyła żadnego promptu podczas sprawdzania gotowości.
- W razie niepowodzenia pod przyciskiem pokazuje `Nie rozpoznano głównego edytora ChatGPT` oraz **tylko liczbowe, nieosobowe** cechy DOM: liczba formularzy kompozytora, elementów znacznikowych, edytowalnych, widocznych i ramek iframe. Bez odczytu treści rozmowy, tytułu karty, URL ani danych użytkownika.
- Wprowadzono izolowaną generację protokołu `JNB_PROBE_V2`, `JNB_RUN_V2` oraz marker `__JNB_CHAT_BRIDGE_V2__`. Jeśli stary content script z poprzedniej wersji pozostał chwilowo w karcie po aktualizacji, nie powinien obsłużyć nowych komend. Główny Bridge nadal odbiera `JNB_BRIDGE_RESULT` i `JNB_BRIDGE_ERROR`, bez zmian w serwerze SQLite.
- Nie zmieniono istniejących tokenów, UUID, komunikacji serwera, idempotencji i STOP; nie dopuszcza się automatycznego powtórzenia niepewnego wysłania promptu.

## Testy

- `tests/fake-chatgpt.html` (stary DOM): rozpoznanie, poprawny przepływ i ACK/STOP.
- `tests/fake-chatgpt-composer-2026.html` (nowy DOM): główny kompozytor `form[data-chatgpt-composer] [data-composer-markdown][contenteditable]`; obok osobny edytor starej wiadomości `.ProseMirror`, którego nie wolno wybrać.
- Test opóźnionego renderowania nowego kompozytora: po 1100 ms wykrycie i przypięcie bez wysłania wiadomości.
- Błąd braku kompozytora: szczegóły strukturalne w UI, brak treści starszych wiadomości i brak wywołania claim w serwerze.
- Integracja testowa przez prawdziwy Chromium MV3 i lokalny FastAPI HTTP, bez używania zalogowanego konta ChatGPT. Należy oddzielić powodzenie na syntetycznej stronie od prawdziwego wdrożenia.

## Instrukcja weryfikacji na hoście

1. Chrome `chrome://extensions` → przy **Jagoda–Nina Bridge** kliknąć **Odśwież** (nie usuwać).
2. Otworzyć nową kartę panelu bocznego (lub kartę `popup.html`).
3. **Odświeżyć także dedykowaną kartę rozmowy ChatGPT** (`https://chatgpt.com/c/<UUID>`), aby po przeładowaniu rozszerzenia nie korzystać ze starego content script; niczego tam nie wpisywać.
4. Sprawdzić status START. Jeśli po aktualizacji jest nieaktywny, uruchomić START (bez nowego UUID lub tokenu; istnieje jedna otwarta rozmowa).
5. Kliknąć `Znajdź i przypnij rozmowę ChatGPT` albo `Przypnij` z pełnym URL.
6. Przy niepowodzeniu skopiować **wyłącznie** pełny nowy komunikat `Nie rozpoznano głównego edytora ChatGPT (...)` do diagnozy. Liczniki nie zawierają treści strony.

Wstrzymujemy wysyłanie wiadomości Niny do chwili prawdziwego przypięcia ChatGPT. W następnej fazie trzeba także zweryfikować nowe znaczniki DOM wiadomości w rzeczywistym ChatGPT: samo przypięcie nie dowodzi poprawnego czytania odpowiedzi nowego app-shell.
