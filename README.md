# Jagoda–Nina Bridge

Fanowski eksperyment komunikacji dwóch asystentek ChatGPT (Nina i Jagoda) przez niezależną skrzynkę HTTPS/SQLite oraz, w kolejnych sprintach, rozszerzenie Chrome Manifest V3.

**Cel pierwszego MVP:** Nina → serwer → Jagoda → serwer → Nina → STOP. Dokładnie dwie wiadomości. Żadnych płatnych API modeli, żadnego połączenia z prywatną pamięcią MAPI.

## Status

- **Sprint 0:** analiza architektury i audyt Video Summary, wykonane.
- **Sprint 1:** lokalny serwer FastAPI + SQLite WAL, tokeny dwóch uczestników, REST API, lease/ACK/idempotencja, STOP, rzeczywiste HTTP, wykonane i odebrane przez przejście do Sprintu 2.
- **Sprint 2:** rozszerzenie Chrome MV3: konfiguracja Jagody/Niny, ręczny transport, automatyczne sprawdzanie skrzynki co ok. 30 s, START/STOP i ACK. Testy dwóch prawdziwych profili Chromium z lokalnym serwerem PASS. Oczekuje na odbiór właściciela.
- **Sprint 3:** adapter dedykowanej rozmowy ChatGPT WWW zaimplementowany. **UX 0.3.7:** poza zmianami 0.3.6 adapter obsługuje również nowy kompozytor ChatGPT z atrybutami `data-chatgpt-composer` i `data-composer-markdown`, czeka na renderowanie pola i zamiast błędnego sugerowania wylogowania pokazuje bezpieczną diagnostykę struktury edytora. Token jest trwały i można go zachować przy zmianie UUID, jeśli serwer i uczestniczka pozostają te same. Po STOP można jednym kliknięciem przejść na nową rozmowę Bridge i uruchomić START bez przepisywania tokenu. Jednoklikowe odzyskiwanie tokenu z hosta pozostaje dostępne. **Brak jeszcze próby na prawdziwej, zalogowanej sesji ChatGPT, więc odbiór pozostaje otwarty.**
- Sprint 4: kontrolowany live E2E z rzeczywistymi sesjami (jeszcze nie rozpoczęte).
- Sprint 5: dokumentacja i ewentualne udostępnienie na GitHub (tylko po oddzielnej zgodzie).

## Lokalny start serwera (Windows, PowerShell)

Zainstaluj Python 3.12, a następnie w katalogu `server`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m app.cli
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Komenda `app.cli` **tylko raz** tworzy dwóch uczestników, jedną rozmowę oraz wypisuje tokeny. Zachowaj tokeny poza repozytorium. Powtórne uruchomienie bootstrapu celowo kończy się błędem zamiast nadpisywać istniejące dane.

API jest dostępne lokalnie pod `http://127.0.0.1:8765`, dokumentacja OpenAPI pod `/docs`. **Nie wystawiaj HTTP bezpośrednio do Internetu.** Zdalne wdrożenie wymaga HTTPS i osobnego odbioru.

## Testy

W katalogu `server`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
.\.venv\Scripts\python.exe scripts\smoke_http.py
```

Test HTTP uruchamia tymczasowy serwer Uvicorn na 127.0.0.1, tworzy tymczasową bazę, przeprowadza wymianę Nina → Jagoda → Nina i zatrzymuje proces. Nie używa ChatGPT WWW ani żadnych sekretów produkcyjnych.

## Rozszerzenie Chrome (Sprint 2)

W Chrome 120+ włącz `chrome://extensions` → *Tryb dewelopera* → *Załaduj rozpakowane* i wskaż katalog `extension`. Po stronie Niny i Jagody użyj osobnych profili Chrome oraz oddzielnych tokenów wygenerowanych przez serwer. Prawdziwe profile ChatGPT nie są jeszcze używane.

Testy rozszerzenia uruchamiane w katalogu `extension`:

```powershell
npm ci
npm test
npm run test:browser
```

Szczegóły uprawnień, przechowywania tokenów i działania w `extension/README.md`. Test prawdziwego Chromium wymaga zainstalowanego Playwright Chromium; nie dotyka zwykłych profili Chrome.

## Katalogi

- `server/app`: API, schema SQLite, auth, provisioning.
- `server/tests`: testy kontraktu, bezpieczeństwa i błędów.
- `server/scripts`: test prawdziwego HTTP.
- `extension`: rozszerzenie MV3 0.3.7, transport i dedykowany adapter ChatGPT, testy Chromium; instrukcje w `extension/README.md` oraz `extension/CHATGPT-ADAPTER.md`.
- `docs/API.md`: kontrakt HTTP i stany.
- `docs/SECURITY.md`: bezpieczeństwo i znane ograniczenia.
- `docs/SPRINT2-RESULTS.md`: wyniki dwóch profili Chromium, automatycznego alarmu i STOP.
- `docs/SPRINT3-RESULTS.md`: implementacja adaptera ChatGPT, testy DOM-fixture i brak potwierdzenia na prawdziwej usłudze.

## Granice

Nie modyfikujemy Video Summary, MAPI, Codex CLI, projektów Gemini/Claude ani stron MorenaTech. Brak wdrożenia, zdalnego repozytorium i publikacji bez wyraźnej decyzji właściciela.
