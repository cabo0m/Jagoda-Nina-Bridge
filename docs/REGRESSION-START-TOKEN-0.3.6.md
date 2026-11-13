# Jagoda–Nina Bridge 0.3.6: regresja START i puste pole tokenu

Data: 13.11.2026.

## Zgłoszenie i rzeczywiste obserwacje

Po odświeżeniu rozszerzenia użytkownik zgłosił, że START i „Nowa rozmowa Bridge” nie działają oraz token nie kopiuje się do formularza.

Odczyt przez MAPI na Windows hoście potwierdził:
- Serwer FastAPI na `127.0.0.1:8765` **nie odpowiadał i nie nasłuchiwał na porcie**. Była to odrębna bezpośrednia przyczyna błędów START, nawet przy prawidłowym tokenie.
- Profil Chrome Default ma klucze `jnb.config`, `jnb.active` (wartość `false`) i `jnb.token`. Sama obecność klucza nie dowodzi, że token jest poprawny, ale token nie został mechanicznie skasowany z magazynu.
- Rozmowa Bridge w bazie pozostawała otwarta; liczba wiadomości = 0.
- W kodzie 0.3.5 worker uznawał tylko dokładny `sender.url === chrome.runtime.getURL("popup.html")`, podczas gdy otwierana wcześniej na hoście karta `popup.html#chatgpt-title` ma inny adres. Dlatego polecenia panelu **mogły** być odrzucane. Potwierdzono w teście syntetycznym, ale nie uzyskano logów z rzeczywistego działającego panelu.
- Pole typu `password` jest celowo czyszczone po konfiguracji; token jest przechowywany w `chrome.storage.local` ograniczonym do zaufanych kontekstów i **nie jest kopiowany z magazynu do widocznego inputa**. To cecha ochrony sekretu, która wcześniej nie była jasno opisana w UI.

## Naprawy

1. **Serwer** ponownie uruchomiony przez MAPI na lokalnym hoście. Health OK, autoryzowany odczyt obecnej rozmowy OK, status `open`, 0 wiadomości. Nie zmieniono UUID, tokenów ani bazy.
2. **Nadawca panelu:** `isExtensionControlSender` przyjmuje wyłącznie tę samą stronę `chrome-extension://<własne ID>/popup.html`, także z fragmentem `#...`. Blokuje obcy origin, inny path i querystring. Nie poszerza uprawnień dostępu do ChatGPT.
3. **Diagnostyka obok START:** komunikaty o błędach i wyniku działania są duplikowane pod przyciskami, żeby nie ginęły u góry długiego panelu przy dużej rozdzielczości hosta i lagach RDP.
4. **Status tokenu:** panel wyświetla jednoznacznie „Token jest zapisany...” albo „Brak zapisanego tokenu...”. Pole hasła pozostaje celowo puste.
5. **Zachowanie tokenu przy zapisie:** jeśli serwer i uczestniczka nie zmieniają się, kliknięcie „Zapisz ustawienia” może użyć wcześniej zapisanego tokenu bez ręcznego przepisywania. Wymiana uczestniczki lub serwera nie pozwala na użycie starego tokenu innej tożsamości.
6. START nadal wymaga działającego serwera; brak automatycznych prób wysyłania promptów lub restartowania rozmowy po niepewnym błędzie.

## Wyniki testów

- 12/12 testów Node, w tym nowy test akceptacji bezpiecznej strony `popup.html#chatgpt-title`, odmowy innym URL i zachowania tokenu przy zmianie UUID.
- Chromium: odświeżenie strony panelu z fragmentem URL, token zapisany i niewidoczny w inpucie, brak dostępnego serwera, START pokazuje błąd bezpośrednio pod przyciskami; PASS.
- Chromium: panel pełnej wysokości, STOP bez modala, przeżywanie tokenu przez pełny restart Chrome; PASS.
- FastAPI 10/10 PASS, Chromium mock ChatGPT/HTTP end-to-end PASS, dwa izolowane profile Chrome transport ACK/STOP PASS, helper lokalnego tokenu PASS.
- Brak weryfikacji na rzeczywistym zalogowanym koncie ChatGPT. Nie wysyłano prawdziwych promptów.

## Wdrażanie na hoście

Zainstalowane rozszerzenie Chrome korzysta ze źródeł `extension/` w katalogu projektu. Nowy ZIP jest opcjonalny i nie jest potrzebny dla istniejącej instalacji.

Użytkownik musi w `chrome://extensions` **Odświeżyć** aktualne rozszerzenie, ale go nie usuwać. Odświeżenie może wyłączyć START, lecz nie powinno usuwać tokenu z magazynu lokalnego. Następnie używać **świeżo otwartego** panelu. Status tokenu ma jawnie informować o jego istnieniu. Kliknięcie START powinno zwrócić potwierdzenie albo konkretny komunikat poniżej przycisków.

**Uwaga o dostępności:** serwer był chwilowo niedostępny; tym razem został ponownie uruchomiony, lecz samo uruchomienie procesu z sesji narzędzia nie jest wdrożeniem trwałej usługi Windows i może wymagać osobnej konfiguracji odporności na restart/logoff hosta. Nie deklarować stabilności 24/7 bez testu po restarcie.

## Bezpieczeństwo

Żadnego jawnego tokenu w kodzie, bazie, logach ani UI; dodatkowa zmiana przyjazna użytkownikowi **nie** przekazuje tokenu skryptom stron ChatGPT. Nie zmieniono prywatnej pamięci ani innych projektów.
