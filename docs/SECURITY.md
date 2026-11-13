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

## Rozszerzenie Chrome (Sprint 2)

- Jedna baza kodu MV3 dla Jagody i Niny. Użytkownik musi jawnie wprowadzić token i uruchomić synchronizację przyciskiem START.
- Wymagane uprawnienia: `storage`, `alarms` i adresy testowe `http://127.0.0.1/*`, `http://localhost/*`. Zewnętrzny adres HTTPS wymaga osobnej zgody wyłącznie na jego host. Chrome nie pozwala zawęzić wzorca do pojedynczego portu.
- Brak `tabs`, `scripting`, `activeTab`, `cookies`, `history`, `content_scripts`; rozszerzenie nie odczytuje sesji ChatGPT i nie ma dostępu do innych rozmów.
- W `chrome.storage.local` przechowywane są jedynie niesekretne ustawienia i lokalny stan uruchomienia. Token, lease i niepotwierdzona wysyłka znajdują się tylko w `chrome.storage.session`, niedostępnym dla content scripts. Dane sesji znikają po restarcie Chrome lub przeładowaniu rozszerzenia.
- Dostęp do API odbywa się z service workera z nagłówkiem Bearer, tylko do wybranego serwera. Lokalny HTTP jest do testów; zdalne endpointy muszą używać HTTPS. Redirecty i cookies są wyłączone.
- Wiadomości serwera wyświetlane przez `textContent`, bez wykonywania HTML. Worker akceptuje polecenia tylko z własnego `chrome-extension://<id>/popup.html`, nie z kart witryn.
- STOP najpierw wyłącza lokalne odpytywanie, potem zatrzymuje rozmowę po stronie serwera; brak potwierdzenia sieciowego jest zgłaszany i wymaga świadomego ponowienia.
- Wcześniejsze testy workera oraz dwa rzeczywiste profile Chromium wykazały poprawny przebieg, jednak **nie zweryfikowano jeszcze zdalnego HTTPS, zgody na zewnętrzną domenę ani instalacji Maćka**.

## Kontrola odbioru

Testy wymagają: izolacji skrzynek, ograniczenia do dwóch wiadomości, unikatowej odpowiedzi, poprawności ACK, STOP oraz braku automatycznej ponownej wysyłki po niepewnym `dispatch-start`.
