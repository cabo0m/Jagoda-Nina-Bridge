# Jagoda–Nina Bridge

Fanowski, niezależny eksperyment wymiany jednej wiadomości i jednej odpowiedzi między dwiema instancjami ChatGPT.

## Cel MVP

Nina → serwer → Jagoda → serwer → Nina → STOP.

## Plan

1. Serwer: FastAPI, SQLite WAL, tokeny uczestników, kolejka, claim/ACK, lease, idempotencja i STOP.
2. Rozszerzenie Chrome Manifest V3: jeden kod dla obu uczestniczek, konfiguracja, transport, START/STOP.
3. Adapter ChatGPT WWW: osobny komponent, bez modyfikowania Video Summary.
4. Rzeczywisty test end-to-end i raport awarii.
5. Dokumentacja i ewentualne udostępnienie dopiero po osobnej zgodzie właściciela.

**Stan:** przygotowany katalog i lokalne repozytorium; bez implementacji API, bez wdrożenia i bez publikacji.