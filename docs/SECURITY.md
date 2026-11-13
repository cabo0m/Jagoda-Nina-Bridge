# Bezpieczeństwo i ograniczenia (Sprint 1)

## Dane

Serwer zapisuje identyfikatory uczestników, UUID rozmowy/wiadomości, treść dwóch wiadomości, znaczniki czasu, statusy, liczbę prób oraz hashe tokenów. Nie ma połączenia z kontami ChatGPT ani z pamięcią MAPI. Nie zbiera plików, cookies, historii przeglądania ani sekretów użytkowników.

## Uwierzytelnienie

- `app.cli` generuje dwa niezależne, losowe tokeny o wysokiej entropii; tylko hashe SHA-256 są zapisane w bazie.
- Klient używa `Authorization: Bearer`. Bez tokenu nie można uzyskać dostępu do skrzynki ani wiadomości.
- Tokeny wypisywane są tylko przy pierwszym bootstrapie. Nie wkładaj ich do Git, plików README, screenshotów, logów lub wiadomości publicznych.
- Projektowy `.gitignore` ignoruje bazy SQLite, `.env`, klucze i środowisko wirtualne.
- Uprawnienia do plików bazy i środowiska uruchomieniowego zależą od systemu operacyjnego. Przy wdrażaniu na Linux VPS wymagane są prywatny użytkownik systemowy, ochrona katalogu danych i HTTPS na reverse proxy.

## Ryzyka

- Lokalny HTTP na `127.0.0.1` jest wyłącznie do testów. Serwer nie jest skonfigurowany do publicznego wdrożenia.
- Jeśli zgubisz token, bootstrap nie odtworzy go. Odzyskiwanie/rotacja tokenów są poza MVP.
- Po potwierdzeniu zamiaru wysyłki do ChatGPT i utracie lease, zadanie pozostaje `needs_review`; brak automatycznego ponownego wysłania chroni przed duplikatami.
- Ręczny STOP blokuje nowe wysyłki i rezerwacje, ale nie cofa już wykonanych operacji w zewnętrznych usługach.
- SQLite WAL nie jest brokerem wieloserwerowym. Sprint 1 zakłada pojedynczy proces serwera i lokalny plik bazy.
- Sam test API nie jest jeszcze testem integracji przeglądarkowej ani ChatGPT.
- Warunki korzystania z ChatGPT WWW i zmiany DOM są znanymi ryzykami etapu integracji. Właściciel zna ryzyko; żadne obchodzenie technicznych zabezpieczeń nie jest częścią projektu.

## Kontrola odbioru

Testy wymagają: izolacji skrzynek, ograniczenia do dwóch wiadomości, unikatowej odpowiedzi, poprawności ACK, STOP oraz braku automatycznej ponownej wysyłki po niepewnym `dispatch-start`.
