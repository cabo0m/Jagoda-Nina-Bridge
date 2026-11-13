# Przegląd kodu dla Niny

**Stan na 13 listopada 2026:** Jagoda–Nina Bridge 0.3.7 (Chrome MV3 + FastAPI/SQLite). Użytkownik potwierdził przypięcie rzeczywistej karty ChatGPT po stronie Jagody. **Nie przeprowadzono jeszcze rzeczywistej wymiany wiadomości Nina → Jagoda → Nina**. Kolejny test przewidziano na następny dzień, po przeglądzie.

## Co przejrzeć

1. **Model bezpieczeństwa i dostępu:** `server/app/auth.py`, `server/app/main.py`, `docs/SECURITY.md`. Sprawdź separację uprawnień Niny i Jagody, kontrolę UUID, limit dwóch wiadomości, politykę CORS, jawne STOP i zachowanie przy błędach sieci.
2. **Spójność dostarczenia:** `server/app/db.py`, `server/app/models.py`, `extension/background.js`. Sprawdź lease/ACK, idempotencję, brak ponowienia niepewnego promptu, kolejkę operacji i wyścigi START/STOP.
3. **Adapter UI ChatGPT:** `extension/chatgpt-bridge.js` i `extension/chatgpt-adapter.mjs`. Zwróć uwagę na kruchość selektorów DOM, rozpoznawanie `#prompt-textarea` oraz `[data-composer-markdown]`, izolację właściwej rozmowy i zabezpieczenie przed odczytem starszych odpowiedzi.
4. **Manifest Chrome i token:** `extension/manifest.json`, `extension/popup.js`. Token jest przechowywany w `chrome.storage.local` z dostępem `TRUSTED_CONTEXTS`, ale nie jest osobno szyfrowany w profilu na dysku. Czy ryzyko jest proporcjonalne do lokalnego eksperymentu?
5. **Testy i obserwowalność:** `extension/tests`, `server/tests`. Wszystkie dotychczasowe testy automatyczne korzystają z lokalnych lub syntetycznych środowisk; nie zastępują testu dwóch zalogowanych kont ChatGPT.

## Jak sprawdzić kod

Przegląd źródeł na GitHubie nie wymaga uruchamiania systemu ani posiadania tokenów.

Do uruchomienia lokalnych testów wymagane są Python 3.12, Node.js i odpowiednie zależności. Instrukcje startowe zawiera [README](../README.md).

- Backend: w katalogu `server` wykonaj `python -m pytest -q tests` po zainstalowaniu `requirements-dev.txt`.
- Rozszerzenie: w katalogu `extension` wykonaj `npm ci` i `npm test`.
- Testy Chromium: `npm run test:panel`, `npm run test:adapter`, `npm run test:browser`, `npm run test:recovery`. Testy wymagają Chromium/Playwright i zostały dotąd zweryfikowane w Windows; mogą mieć zależności specyficzne dla środowiska.

**Nie uruchamiaj rzeczywistej wymiany przez sam link do repozytorium.** GitHub nie zawiera tokenów Niny ani Jagody, lokalnej bazy SQLite, pliku `.env` ani połączenia z hostem Bridge. Gdy konta pracują na dwóch różnych komputerach, osobnym zadaniem jest bezpieczne udostępnienie serwera przez HTTPS.

## Oczekiwany wynik przeglądu

Przekaż Michałowi listę **konkretnych ryzyk i błędów**, z nazwami plików, krokami odtworzenia oraz proponowanymi poprawkami. Oddziel błędy blokujące test dwóch kont od zmian kosmetycznych i nowych funkcji. Nie zakładaj, że przejście testu na atrapowym DOM oznacza działanie na aktualnym ChatGPT.

Nie dodawaj żadnych prawdziwych tokenów, sekretów, prywatnych wiadomości ani danych kont do zgłoszeń GitHub.

## Ograniczenia

To eksperyment prywatnych asystentek ChatGPT, nie oficjalna integracja ChatGPT ani usługa OpenAI. Przypięcie rzeczywistej karty potwierdza tylko gotowość edytora; pełna integracja pozostaje do zweryfikowania.
