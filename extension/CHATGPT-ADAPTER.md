# Jagoda–Nina Bridge 0.3.1: adapter ChatGPT (Sprint 3)

Przed użyciem uruchom serwer i wykonaj bootstrap jak w `server/README` albo głównym `README.md`.

## Kontrolowany przebieg

1. W dwóch osobnych profilach Chrome zainstaluj to samo rozpakowane rozszerzenie. Skonfiguruj adres serwera, UUID jednej rozmowy oraz własne tokeny.
2. Po stronie Jagody otwórz nową, dedykowaną rozmowę ChatGPT pod pełnym adresem `https://chatgpt.com/c/<UUID>`. Nie korzystaj z istniejących prywatnych rozmów. Poczekaj, aż interfejs będzie gotowy i edytor będzie pusty.
3. W rozszerzeniu Jagody kliknij START. Otwórz w głównej karcie ChatGPT właściwy wątek `/c/<UUID>` i w stałym panelu bocznym kliknij **Przypnij aktywną kartę ChatGPT**. Alternatywnie wpisz dokładny URL i kliknij **Przypnij**. Wiele identycznych kart lub niegotowy edytor powodują odmowę. UUID Bridge z sekcji Konfiguracja NIE jest adresem ChatGPT.
4. W rozszerzeniu Niny kliknij START, wpisz pierwszą wiadomość i wyślij ją ręcznie. Jagoda automatycznie odbierze tę wiadomość przez polling serwera, wyśle pojedynczy prompt do przypiętego ChatGPT i po potwierdzeniu generowania zapisze odpowiedź na serwerze.
5. Nina zobaczy odpowiedź Jagody w swojej skrzynce i kliknie ACK. Po dwóch ACK serwer ustawi STOP. **Nie ma automatycznej kolejnej generacji po stronie Niny**.

## Bezpieczeństwo i ograniczenia

- Nie przechowujemy cookie ChatGPT, loginu ani hasła.
- Nie odczytujemy listy wszystkich rozmów. Adapter pyta Chrome tylko o wskazany URL lub aktywną kartę ChatGPT (dokładne dopasowanie), a skrypt wstrzykuje tylko w jedną przypiętą kartę. Panel boczny ma pełną wysokość okna, szczegóły w `../docs/SIDEPANEL-0.3.1.md`.
- Token serwera pozostaje w `chrome.storage.session` service workera. Skrypt strony ChatGPT nie otrzymuje tokenu, jedynie przekazany prompt.
- Po rozpoczęciu `dispatch-start` nie wolno automatycznie powtarzać promptu. Przy błędach, timeoutach lub zerwaniu sesji zobaczysz `needs_review` / stan niepewny. Zatrzymaj eksperyment i przejrzyj ręcznie rozmowę oraz SQLite.
- STOP blokuje nowe operacje z rozszerzenia, lecz nie cofa promptu, który ChatGPT już otrzymał.
- Testy `npm run test:adapter` używają podstawionego HTML imitującego najważniejsze selektory ChatGPT. **Nie jest to dowód działania z prawdziwym modelem**.
- Używaj dedykowanej rozmowy i nie włączaj prywatnej pamięci do eksperymentu. Sam prompt nie wyłącza kontowej personalizacji ChatGPT; nie należy podawać sekretów ani wrażliwych danych.

## Testy

```powershell
cd extension
npm ci
npm test
npm run test:browser
npm run test:adapter
```

Zależność developerska `playwright-core` wykorzystywana jest tylko w testach. W samym rozszerzeniu nie ma bundlera, płatnego API ani zależności runtime od Node.js.
