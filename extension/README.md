# Jagoda–Nina Bridge: transport Chrome MV3 (Sprint 2)

**Uwaga:** poniższy dokument opisuje transport Sprintu 2. Aktualna wersja 0.3.6 używa **stałego panelu bocznego Chrome**, nie zamykanego popupu. Aby go otworzyć, kliknij ikonę rozszerzenia; szczegóły [SIDEPANEL-0.3.1.md](../docs/SIDEPANEL-0.3.1.md). Adapter ChatGPT opisano w [CHATGPT-ADAPTER.md](CHATGPT-ADAPTER.md). Poprawka priorytetowego STOP i trwałości tokenu jest opisana w [STOP-TOKEN-0.3.2.md](../docs/STOP-TOKEN-0.3.2.md). Odzyskanie utraconego tokenu z hosta jednym kliknięciem opisano w [LOCAL-TOKEN-RECOVERY-0.3.3.md](../docs/LOCAL-TOKEN-RECOVERY-0.3.3.md). Po STOP można bez tokenu utworzyć nową rozmowę i włączyć START: [NEW-CONVERSATION-0.3.4.md](../docs/NEW-CONVERSATION-0.3.4.md). Przypinanie wątku ChatGPT z innej karty opisuje [CHATGPT-BINDING-0.3.5.md](../docs/CHATGPT-BINDING-0.3.5.md). Poprawkę START, obsługi karty `popup.html#...` i statusu tokenu opisuje [REGRESSION-START-TOKEN-0.3.6.md](../docs/REGRESSION-START-TOKEN-0.3.6.md).

Sprint 2, wersja 0.2.0. Jeden kod dla dwóch niezależnych uczestniczek.

**Obecny zakres:** konfiguracja serwera i tożsamości, poświadczenia w chronionym magazynie lokalnym (od 0.3.2), odbieranie wiadomości, ręczne wpisywanie i wysyłanie, ACK, synchronizacja w tle przez Chrome Alarms, przycisk START i nieodwracalny STOP. **Bez dostępu do kart ani rozmów ChatGPT.**

## Instalacja ręczna

1. Uruchom lokalny serwer ze Sprintu 1, wykonaj jednokrotny bootstrap `python -m app.cli` i bezpiecznie przechowaj: UUID rozmowy, token Niny i token Jagody. Nie umieszczaj tokenów w plikach projektu.
2. Otwórz `chrome://extensions` w Chrome (wersja 120+), włącz *Tryb dewelopera* i wybierz *Załaduj rozpakowane*.
3. Wskaż katalog `Documents/Projekty/Jagoda-Nina-Bridge/extension`. Dla dwóch uczestniczek użyj **osobnych profili Chrome**, a na różnych komputerach rozpakuj ten sam kod.
4. Kliknij ikonę rozszerzenia. Ustaw adres serwera, swoją uczestniczkę (Nina/Jagoda), UUID rozmowy oraz **swój** token. Zapisz konfigurację.
5. Kliknij START. Rozszerzenie sprawdzi stan serwera i uruchomi alarm synchronizacji skrzynki. Automatyczne sprawdzanie odbywa się zwykle co 30 s, z możliwymi opóźnieniami zależnymi od Chrome.
6. Nina wpisuje pierwszą wiadomość i klika *Wyślij*. Jagoda widzi ją w skrzynce po synchronizacji, klika *Potwierdź odbiór (ACK)*, wpisuje odpowiedź i wysyła. Nina odbiera odpowiedź i klika ACK. Serwer wykonuje automatyczny STOP po dwóch potwierdzeniach.
7. **STOP** ręczny zawsze zatrzymuje lokalne odpytywanie i próbuje zatrzymać rozmowę na serwerze. Wymaga potwierdzenia. Jeśli sieć nie działa, rozszerzenie pokaże, że zdalny STOP nie jest potwierdzony, i umożliwi ponowienie.

Nie ma jeszcze automatycznego przekazywania wiadomości do modeli. Cały przebieg w tym sprincie jest **ręcznym transportem przez dwa popupy**, bez wycinania treści ze stron i bez integracji ChatGPT.

## Uprawnienia

| Uprawnienie | Po co |
|---|---|
| `storage` | Konfiguracja i stan skrzynki; od 0.3.2 token w `storage.local` (tylko zaufane konteksty) |
| `alarms` | Odpytywanie serwera co około 30 s |
| `http://127.0.0.1/*`, `http://localhost/*` | Wymagane lokalne połączenie z serwerem testowym |
| Opcjonalne `https://*/*` | Katalog dozwolonych wzorców. Użytkownik udziela zgody wyłącznie na podaną konkretną domenę HTTPS podczas konfiguracji |

Chrome nie pozwala ograniczyć wzorca uprawnienia do pojedynczego portu. Rozszerzenie akceptuje wyłącznie `https://` lub lokalne `http://127.0.0.1` / `http://localhost`; żadne zdalne nieszyfrowane HTTP.

**Nie ma** `tabs`, `scripting`, `activeTab`, `history`, `cookies`, `clipboardRead`, `content_scripts`, `web_accessible_resources`. Nie odczytujemy rozmów, historii, kont ani danych innych stron.

## Przechowywanie danych

- `chrome.storage.local`: adres serwera, UUID rozmowy, uczestniczka, stan START/STOP oraz **od 0.3.2 osobny klucz tokenu** (nie jest szyfrowany dodatkowo, lecz dostęp z API storage ograniczono do zaufanych kontekstów).
- `chrome.storage.session`: własna skrzynka, lease i klucz idempotencji niepewnej wysyłki; w 0.2.0 także token. Od 0.3.2 token jest trwale zapisany w `chrome.storage.local` i po restarcie nie trzeba podawać go ponownie, jeśli był już zapisany w nowej wersji.
- Poświadczenia nie są przesyłane do stron internetowych; wysyłane są tylko do wskazanego serwera w nagłówku `Authorization: Bearer`.
- Popup wyświetla treść wiadomości przez `textContent`, nigdy przez `innerHTML`. Nie ma skryptów wstrzykiwanych na strony WWW.

## Testy deweloperskie (Windows)

Wymagane: Node.js i lokalny Python 3.12 z `server/.venv`.

```powershell
cd extension
npm ci
npm test
npm run test:browser
```

`npm test`: testy dwóch symulowanych kontekstów MV3 podłączonych do **rzeczywistego lokalnego FastAPI HTTP**, bezpieczeństwa tokenów, idempotencji i STOP.

`npm run test:browser`: dwa **prawdziwe, odizolowane profile Playwright Chromium** z rozpakowanym rozszerzeniem; weryfikacja obu wiadomości, dwóch ACK, automatycznej synchronizacji `alarms` oraz ręcznego STOP. Skrypt używa tymczasowej SQLite i katalogów profili, które po teście usuwa. Wymaga Chromium w `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`. Nie dotyka prywatnych profili ani sesji ChatGPT.

Powyższe testy nie sprawdzają jeszcze zgody na domenę zewnętrznego HTTPS ani działania w Chrome na komputerze Maćka. To ograniczenia przed udostępnieniem.

## Najważniejsze ograniczenia

- Jedna rozmowa na bootstrap, maksymalnie dwie wiadomości, zgodnie z kontraktem serwera.
- Niepewna wysyłka jest ponawiana z tym samym kluczem idempotencji, nigdy z automatycznie nowym. Po rozłączeniu może wymagać ręcznej interwencji.
- Zmiany w UI ChatGPT nie mają znaczenia w tym sprincie, bo kod nie łączy się z interfejsem ChatGPT.
- Wersja fanowska, bez automatycznego wdrożenia i bez publikacji na GitHubie.
