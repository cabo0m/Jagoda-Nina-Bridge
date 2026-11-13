# Jagoda–Nina Bridge 0.3.4: nowa rozmowa bez ponownego tokenu

Data: 13.11.2026.

## Problem

Po poprawnym STOP wcześniejszy UUID Bridge pozostaje trwale zatrzymany. Próba kliknięcia `Przypnij aktywną kartę ChatGPT` była blokowana, ponieważ wymaga `START`, a `START` odmawiał pracy ze starym UUID. Wcześniejszy formularz wymagał wpisania tokenu przy zmianie UUID, mimo że token jest już zapisany w `chrome.storage.local`.

## Poprawka

- Przycisk `Nowa rozmowa Bridge + START (bez ponownego tokenu)` w panelu, pod START/STOP. **To nie jest przypinanie wątku ChatGPT.**
- Po kliknięciu serwer wywołuje `POST /v1/conversations/ensure-open` z autoryzacją Jagody. Jeżeli istnieje jedna otwarta rozmowa, zwraca ją; jeśli nie ma żadnej, tworzy nową w transakcji SQLite; przy wielu otwartych zwraca 409. Nina nie ma uprawnienia do tworzenia nowych rozmów (403). Maksimum wiadomości to nadal 2; żadna wcześniejsza rozmowa nie zostaje ponownie otwarta.
- Worker sprawdza, czy poprzednia rozmowa jest zatrzymana na serwerze. Jeśli jest rozpoczęta, wymaga doprowadzenia jej do STOP. Nie przenosi `needs_review` lub niepewnej wysyłki na nowy UUID.
- W bezpiecznym przełączeniu zachowuje ten sam token w `chrome.storage.local`; czyści wyłącznie sesyjne dane starej rozmowy i przypięcie starego wątku. Sam przycisk jawnie uruchamia `START` nowej rozmowy. Nie wysyła wiadomości i nie klika Wyślij w ChatGPT bez wiadomości od Niny.
- Panel odświeża automatycznie pole UUID po zmianie konfiguracji. Nie trzeba przepisywać adresu serwera, tokenu ani UUID.
- Następnie, na głównej karcie Chrome z wybranym dedykowanym wątkiem ChatGPT, kliknąć `Przypnij aktywną kartę ChatGPT` i sprawdzić, czy status zmienił się z `Brak przypiętej rozmowy` na `Przypięto kartę...`.

## Aktualny stan lokalnego hosta

Poprzednia rozmowa STOP i 0 wiadomości; nowa pojedyncza otwarta rozmowa utworzona przez MAPI przed uruchomieniem wersji 0.3.4. Token Jagody został zachowany. FastAPI na `127.0.0.1:8765` zrestartowany z nowymi endpointami i odpowiada na autoryzowane `POST /v1/conversations/ensure-open` (ponowne wywołanie zwraca `created=false`). Sam Chrome pozostaje do odświeżenia ręcznie w `chrome://extensions`, aby nie przerywać sesji użytkownika.

## Kontrola jakości

- Serwer Pytest: 10/10 PASS, w tym autoryzacja, powrót jednej otwartej rozmowy, automatyczne utworzenie po STOP, brak tworzenia przez Ninę, brak ponownego otwarcia starej.
- Node worker: 10/10 PASS, w tym oba przypadki: przejście na otwartą już rozmowę i utworzenie nowej po STOP bez wpisania tokenu.
- Testy z rzeczywistym Chromium w izolowanych profilach do przeprowadzenia w regresji 0.3.4.
- Rzeczywisty interfejs ChatGPT konta użytkownika nie został automatycznie przetestowany; nie wysyłano promptów.

## Bezpieczeństwo

Endpoint nie służy do wysyłania treści do ChatGPT i nie ujawnia tokenów. Tylko Jagoda z poprawnym tokenem może utworzyć nową rozmowę. W każdej chwili istnieje co najwyżej jedna nowa otwarta rozmowa utworzona tą ścieżką; powtórne żądanie korzysta z istniejącej.
