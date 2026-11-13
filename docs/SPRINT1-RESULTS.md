# Sprint 1 – wynik testów i przekazanie do odbioru

Data: 2026-11-13
Projekt: Jagoda–Nina Bridge, fanowski MVP 0.1
Zakres: lokalny FastAPI + SQLite, bez Chrome i bez ChatGPT WWW.

## Wykonane

- SQLite WAL z tabelami participants, conversations, messages i kluczami obcymi.
- Dwa niezależne tokeny uczestników; w bazie tylko skróty; bootstrap nie nadpisuje istniejącej konfiguracji.
- REST: send, inbox, claim, dispatch-start, ack, conversation, stop.
- UUID, idempotency_key, reply_to_id, limit dwóch wiadomości oraz kolejność Nina → Jagoda → Nina.
- Lease 900 sekund, atomowe rezerwacje, brak automatycznego ponawiania niepewnego przekazania do modelu.
- Lokalna wirtualna instalacja Pythona 3.12 i instrukcja uruchomienia.
- Testy API i oddzielny test rzeczywistego HTTP z tymczasową bazą.

## Dowody testów

1. Sprawdzenie AST składni ośmiu plików Python: **PASS**.
2. Kontrola zależności w izolowanym `.venv`: **PASS**, brak konfliktów.
3. `python -m pytest -q tests`: **8 passed** (0.73 s).
4. `python scripts/smoke_http.py`: **HTTP E2E PASS**, lokalny Uvicorn na 127.0.0.1, klient Nina wysłał wiadomość, Jagoda odebrała i odesłała odpowiedź, Nina potwierdziła, stan `stopped`, 2 wiadomości i 2 ACK, puste skrzynki; proces testowy został zatrzymany.

Testy z pierwszej serii przeprowadzono dodatkowo w dostępnej współdzielonej `.venv` MAPI: **8 passed**. Ostateczny odbiór testowy oparto na osobnym środowisku projektu.

## Ostrzeżenia / ograniczenia

- Jedno ostrzeżenie deprecacyjne biblioteki Starlette/FastAPI dotyczące współpracy z `httpx` w testach; nie spowodowało błędów testów ani rzeczywistego HTTP.
- Nie wykonano live E2E z ChatGPT WWW ani przeglądarką Chrome.
- Stan `needs_review` wymaga ręcznej interwencji, ponieważ po niepewnym przekazaniu promptu serwer nie powiela żądania.
- Brak wdrożenia HTTPS na VPS, brak rotacji tokenów; to późniejsze osobne decyzje.
- Testy uruchomione lokalnie w izolowanych katalogach tymczasowych. Nie stworzono produkcyjnych kont uczestników ani danych trwałych rozmowy.

## Następny krok

Po odbiorze Michała: Sprint 2, jedna baza kodu rozszerzenia Chrome MV3, wyłącznie transport i konfiguracja, bez modyfikowania Video Summary. Bez publikacji repozytorium i bez wdrożenia na VPS.
