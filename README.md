# Jagoda–Nina Bridge

Fanowski eksperyment komunikacji dwóch asystentek ChatGPT (Nina i Jagoda) przez niezależną skrzynkę HTTPS/SQLite oraz, w kolejnych sprintach, rozszerzenie Chrome Manifest V3.

**Cel pierwszego MVP:** Nina → serwer → Jagoda → serwer → Nina → STOP. Dokładnie dwie wiadomości. Żadnych płatnych API modeli, żadnego połączenia z prywatną pamięcią MAPI.

## Status

- **Sprint 0:** analiza architektury i audyt Video Summary, wykonane.
- **Sprint 1:** lokalny serwer FastAPI + SQLite WAL, tokeny dwóch uczestników, REST API, lease/ACK/idempotencja, STOP, testy przez prawdziwy HTTP, wykonane. Oczekuje na odbiór właściciela.
- Sprint 2: rozszerzenie Chrome transport (jeszcze nie rozpoczęte).
- Sprint 3: adapter ChatGPT WWW (jeszcze nie rozpoczęte).
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

## Katalogi

- `server/app`: API, schema SQLite, auth, provisioning.
- `server/tests`: testy kontraktu, bezpieczeństwa i błędów.
- `server/scripts`: test prawdziwego HTTP.
- `extension`: zarezerwowany na Sprint 2.
- `docs/API.md`: kontrakt HTTP i stany.
- `docs/SECURITY.md`: bezpieczeństwo i znane ograniczenia.

## Granice

Nie modyfikujemy Video Summary, MAPI, Codex CLI, projektów Gemini/Claude ani stron MorenaTech. Brak wdrożenia, zdalnego repozytorium i publikacji bez wyraźnej decyzji właściciela.
