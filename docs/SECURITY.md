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
- **Historycznie w Sprint 2** token znajdował się w `chrome.storage.session`, a `chrome.storage.local` przechowywał tylko niesekretne dane. **Od 0.3.2** token jest osobnym chronionym kluczem `chrome.storage.local` i przeżywa restart Chrome. Lease, skrzynka i niepewne wysyłki nadal są sesyjne. Token nie jest dodatkowo szyfrowany na dysku (opis bezpieczeństwa niżej).
- Dostęp do API odbywa się z service workera z nagłówkiem Bearer, tylko do wybranego serwera. Lokalny HTTP jest do testów; zdalne endpointy muszą używać HTTPS. Redirecty i cookies są wyłączone.
- Wiadomości serwera wyświetlane przez `textContent`, bez wykonywania HTML. Worker akceptuje polecenia tylko z własnego `chrome-extension://<id>/popup.html`, nie z kart witryn.
- STOP najpierw wyłącza lokalne odpytywanie, potem zatrzymuje rozmowę po stronie serwera; brak potwierdzenia sieciowego jest zgłaszany i wymaga świadomego ponowienia.
- Wcześniejsze testy workera oraz dwa rzeczywiste profile Chromium wykazały poprawny przebieg, jednak **nie zweryfikowano jeszcze zdalnego HTTPS, zgody na zewnętrzną domenę ani instalacji Maćka**.

## Jednorazowe odzyskanie tokenu (0.3.3)

Pomocnik `tools/local_bootstrap.py` działa wyłącznie na `127.0.0.1:8766` i obsługuje tylko jedno poprawne żądanie z dokładnym `Origin` identyfikującym rozszerzenie hosta. Token Jagody z pliku `.env` nie trafia do interfejsu, adresów URL, plików JS ani logów. Uwaga: nagłówek HTTP Origin nie jest silnym dowodem dla lokalnego złośliwego procesu; taki proces może też czytać `.env`. Funkcji nie należy uruchamiać na serwerze publicznym ani maszynie współdzielonej bez izolacji. Wymaga jawnego kliknięcia przycisku w rozszerzeniu i nie uruchamia rozmowy. Szczegóły: `LOCAL-TOKEN-RECOVERY-0.3.3.md`.

## Utrwalanie tokenu uczestniczki (0.3.2)

Token po zatwierdzeniu konfiguracji przechowywany jest w osobnym kluczu `chrome.storage.local` ograniczonym do `TRUSTED_CONTEXTS`, aby nie ginął po aktualizacji rozszerzenia. **Nie jest dodatkowo szyfrowany w profilu Chrome**. Profil przeglądarki należy chronić na poziomie systemu operacyjnego; skrypty stron nie mają dostępu do klucza poprzez API storage. Token przechowywany wcześniej wyłącznie w `chrome.storage.session`, który już wygasł, wymaga jednorazowego ponownego wpisania. START po restarcie nie włącza się automatycznie. STOP nie używa `confirm()` i może zadziałać lokalnie nawet bez tokenu; zdalny sukces jest wyświetlany wyłącznie po potwierdzeniu HTTP. Szczegóły: `STOP-TOKEN-0.3.2.md`.

## Adapter ChatGPT (Sprint 3)

- Manifest 0.3.0 rozszerza wymagane uprawnienia o `scripting` i ograniczone `https://chatgpt.com/*`. Nie dodaje `tabs` ani globalnych `content_scripts`. Worker pyta o karty wyłącznie przy użyciu prefiksu podanego URL i wstrzykuje adapter tylko do jednoznacznie dopasowanej, dedykowanej rozmowy.
- Własna zgoda użytkownika polega na wskazaniu URL rozmowy i kliknięciu `Przypnij`. Weryfikowany jest dokładny adres `https://chatgpt.com/c/<UUID>`, pusty edytor oraz brak aktywnego generowania.
- Content script nie dostaje tokenu API, innych wiadomości z serwera ani prywatnej pamięci MAPI. Dostaje wyłącznie tekst wiadomości Niny sformatowany jako pojedynczy prompt.
- Odpowiedź modelu pozyskiwana jest tylko z nowej wiadomości asystenta po potwierdzonym wysłaniu; nie jest zbierana historia rozmowy ani treść innych kart. Utrata pewnego powiązania odpowiedzi z promptem oznacza STOP/manual review, nie przejęcie starszego tekstu.
- Klient zapisuje stan zadania i lease w `chrome.storage.session`. `dispatch-start` jest zapisywany przed operacją zewnętrzną, a po niepewnym wyniku nie ma automatycznego ponawiania promptu.
- Po STOP późna odpowiedź ChatGPT nie jest przekazywana na serwer. Test wykonano na sztucznym DOM, nie na realnej usłudze.
- Prompt prosi o nieujawnianie wspomnień i sekretów, ale nie jest ścisłą kontrolą przepływu informacji: prawdziwy ChatGPT może mieć własną pamięć konta. Na czas eksperymentu użyj nowego, dedykowanego czatu bez prywatnego kontekstu.
- Wersja 0.3.0 ma potwierdzone testy Chromium na fikcyjnym HTML; rzeczywiste działanie przy obecnym interfejsie zalogowanego ChatGPT pozostaje do weryfikacji.

## Kontrola odbioru

Testy wymagają: izolacji skrzynek, ograniczenia do dwóch wiadomości, unikatowej odpowiedzi, poprawności ACK, STOP oraz braku automatycznej ponownej wysyłki po niepewnym `dispatch-start`.
