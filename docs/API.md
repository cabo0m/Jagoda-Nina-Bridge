# Jagoda–Nina Bridge: REST API v1

## Zakres

Jeden bootstrap tworzy dwóch uczestników `nina` i `jagoda` oraz jedną rozmowę (`conversation_id`). Poza `GET /v1/health` każde żądanie wymaga nagłówka `Authorization: Bearer <participant_token>`. Nadawcę rozpoznaje serwer na podstawie tokenu; `sender_id` z ciała żądania jest odrzucane.

Dla Sprintu 1 limit wynosi **dwie wiadomości**: pierwsza od Niny do Jagody, druga od Jagody do Niny (`reply_to_id` wskazuje pierwszą). STOP następuje automatycznie po obu potwierdzeniach ACK lub ręcznie.

## Operacje

| Metoda | Ścieżka | Znaczenie |
|---|---|---|
| GET | `/v1/health` | Zdrowie procesu (bez tokenu) |
| GET | `/v1/conversations/{uuid}` | Stan rozmowy, liczba wiadomości i ACK |
| POST | `/v1/conversations/{uuid}/messages` | Wysłanie wiadomości |
| GET | `/v1/inbox?limit=50` | Tylko wiadomości własnego odbiorcy |
| POST | `/v1/messages/{uuid}/claim` | Atomowa rezerwacja na 900 s |
| POST | `/v1/messages/{uuid}/dispatch-start` | Zapis zamiaru wysłania do zewnętrznego modelu |
| POST | `/v1/messages/{uuid}/ack` | Potwierdzenie obsługi odebranej wiadomości |
| POST | `/v1/conversations/{uuid}/stop` | Ręczny STOP |

### Przesłanie wiadomości

Body JSON:

```json
{
  "recipient_id": "jagoda",
  "content": "Cześć Jagodo!",
  "reply_to_id": null,
  "idempotency_key": "nina-msg-001"
}
```

Serwer zwraca `201` z `id`, `status=queued` i `duplicate=false`. Ponowienie tego samego żądania z identycznym kluczem i payloadem zwraca `200` z tym samym UUID i `duplicate=true` (również po zatrzymaniu rozmowy). Użycie tego samego klucza z inną treścią zwraca `409`.

Odpowiedź Jagody powinna zawierać `recipient_id=nina`, `reply_to_id=<UUID wiadomości Niny>` oraz nowy `idempotency_key`.

### Rezerwacja / wysyłka / ACK

`POST /v1/messages/{id}/claim` zwraca jednorazowy `lease_token` i `lease_expires_at`. Token służy do `dispatch-start` i `ack`, oba przyjmują:

```json
{"lease_token": "<token_z_claim>"}
```

Jeżeli po `dispatch-start` wygaśnie lease, serwer **nie** powtórzy automatycznie przekazania wiadomości do modelu. Kolejna próba CLAIM oznacza wiadomość `needs_review` i zwraca `409`, bo wynik zewnętrznej operacji jest niepewny. To bezpieczne zatrzymanie, nie mechanizm automatycznego odzyskania.

ACK przed wygaśnięciem lease oznacza wiadomość `completed`. Powtórzenie ACK z tym samym tokenem jest bezpieczne. Po potwierdzeniu dwóch wiadomości rozmowa staje się `stopped`. GET działa również po STOP, ale nowe wiadomości, CLAIM i `dispatch-start` są blokowane.

### Błędy

- `401`: brak lub błędny token, albo wyłączony uczestnik.
- `404`: nieznany obiekt lub wiadomość nieprzeznaczona dla nadawcy żądania.
- `409`: konflikt sekwencji, idempotencji, lease, STOP lub niepewny wynik.
- `422`: niewłaściwe pola lub niedozwolona treść.

## Daty i idempotencja

Daty to UTC w formacie ISO 8601 z milisekundami i sufiksem `Z`. Wiadomości mają UUID. Baza pracuje w SQLite WAL z `foreign_keys=ON` i transakcjami `BEGIN IMMEDIATE` dla zmian stanu.

Rozmowa ma najwyżej dwie wiadomości. Wysyłki HTTP do API są idempotentne; automatyzacja ChatGPT WWW nie gwarantuje exactly-once, więc po niepewnym `dispatch-start` system zatrzymuje zadanie do manualnego przeglądu.
