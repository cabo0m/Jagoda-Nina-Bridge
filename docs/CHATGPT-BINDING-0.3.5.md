# Jagoda–Nina Bridge 0.3.5: przypinanie rzeczywistej karty Chrome

Data: 13.11.2026. Incydent: użytkownik ma w tym samym Chrome obok siebie kartę rozszerzenia i kartę ChatGPT, ale przycisk przypinania niczego nie zmienia.

## Diagnoza

- Konfiguracja i token istnieją w profilu Chrome; zapisane `jnb.active=true`. Na serwerze `127.0.0.1:8765` istnieje dokładnie jedna otwarta rozmowa Bridge, zero wiadomości.
- W 0.3.4 `BIND_ACTIVE_CHATGPT` filtrował `chrome.tabs.query({active:true,currentWindow:true,url:"https://chatgpt.com/*"})`. Gdy sam panel rozszerzenia jest otwarty w zwykłej karcie, **aktywna jest karta rozszerzenia, a nie sąsiednia karta ChatGPT**. Zapytanie nie znajdowało rozmowy. Zgłoszona sytuacja użytkownika jest więc zgodna ze stwierdzonym błędem projektowym. Nie potwierdzono go poprzez bezpośredni odczyt prawdziwego DOM konta użytkownika.
- Nowy przycisk `Znajdź i przypnij rozmowę ChatGPT` wyszukuje w profilu Chrome tylko karty z adresem `https://chatgpt.com/c/*`, następnie sprawdza ścisły adres `/c/<UUID>`. Nie przeszukuje historii ani treści rozmów. Gdy tylko jedna jest znaleziona, przypina ją; gdy istnieją dwie lub więcej i nie ma jednoznacznej aktywnej, pokazuje listę technicznych identyfikatorów (fragment UUID, ID karty) do ręcznego wyboru.
- Dokładny błąd pokazywany jest **tuż pod przyciskiem**, a nie wyłącznie na początku przewijanej strony. Zgłoszenie `Nie przypięto: ...` nie znika od renderowania aktualnego statusu.
- Jeśli otwarty jest ekran `https://chatgpt.com/` bez zapisanego wątku, komunikat pokazuje ile kart ChatGPT jest widocznych i wymaga wejścia do rozmowy z trwałym adresem `/c/<UUID>`. Nie wolno mylić tego UUID z identyfikatorem rozmowy Bridge.
- Zachowano istniejące sprawdzanie edytora `JNB_PROBE`, wymóg START, brak dodatkowego tokenu, wymóg pustego edytora, niepowtarzanie promptów po wyniku niepewnym. Nie wysyła się promptów podczas samego przypinania.

## Testy

- `npm run test:adapter`: realne izolowane Chromium, konto nieużywane; scenariusze: otwarta strona ChatGPT bez `/c/<UUID>` daje dokładny komunikat, karta rozszerzenia jest aktywna a dwie inne karty ChatGPT otwarte, wybór prawidłowej z listy i przypięcie z widocznym statusem, odpowiedź w mock DOM i ACK/STOP, późna odpowiedź po STOP ignorowana. Wszystkie PASS.
- `npm test`: 10/10 PASS.
- `server/.venv/Scripts/python.exe -m pytest -q tests`: 10/10 PASS, jeden deprecation warning.
- `npm run test:panel`, `npm run test:browser`, `npm run test:recovery`: PASS.
- `node --check`: 10 plików JS/MJS PASS.
- Test z prawdziwym, zalogowanym interfejsem ChatGPT **wciąż nie został wykonany**.

## Użycie na hoście

1. W Chrome `chrome://extensions` nacisnąć **Odśwież** przy Jagoda–Nina Bridge. **Nie usuwać** dodatku, aby zachować jego ID i lokalny token.
2. Po przeładowaniu Chrome wyłącza START. W panelu kliknąć **START**. To wznawia jedynie synchronizację istniejącej otwartej rozmowy Bridge, nie tworzy nowego UUID i nie wysyła żadnego promptu.
3. Otworzyć w tym samym profilu Chrome zapisany, dedykowany wątek ChatGPT z adresem `https://chatgpt.com/c/<UUID>`. Panel może być w bocznym widoku lub zwykłej karcie.
4. W panelu kliknąć **Znajdź i przypnij rozmowę ChatGPT**; jeżeli pokaże się lista, wybrać właściwy wątek i kliknąć **Przypnij wybraną kartę**.
5. Zobaczyć `Przypięto wątek ChatGPT` i `Przypięto kartę...`; w razie błędu odczytać tekst tuż pod przyciskiem. Nie uruchamiać Niny ani wysyłki przed potwierdzeniem.

**Nie używać przycisku STOP do zwykłego wyłączania panelu:** STOP nieodwracalnie zamyka rozmowę serwera. Przy zmianie wersji wystarczy odświeżyć rozszerzenie i ponownie nacisnąć START.

## Uwaga o prywatności

Przy wyborze z listy pokazujemy tylko fragment UUID czatu i ID karty, bez tytułu lub treści; samo odnalezienie adresów innych otwartych kart nie otwiera ani nie odczytuje ich zawartości. Skrypt `chatgpt-bridge.js` wstrzykiwany jest tylko w jedną wybraną, prawidłowo zweryfikowaną kartę.
