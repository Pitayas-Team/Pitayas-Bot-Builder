# Instrukcje dla Antigravity / Gemini

Cały kontekst projektu **Pitaya Bot Builder** (cel, zasady od właściciela, struktura, uruchamianie i wdrażanie, testowanie, znane ograniczenia) jest w pliku **`AGENTS.md`** w tym samym katalogu – przeczytaj go najpierw i traktuj jako obowiązujący.

Najważniejsze w skrócie:
- Electron: edytor blokowy (`blocks/*.js` – każdy plik to jeden blok) generujący i uruchamiający boty Discord.
- Boty trafiają do folderu użytkownika: `~/Dokumenty/Moje/Boty`, gdy istnieje; inaczej stary `~/Dokumenty/Mango-Boty`; domyślnie `~/Dokumenty/Pitaya-Boty` — nie zmieniaj tej kolejności wyboru.
- Uruchomione procesy botów są śledzone w `runningBotProcesses` w `main.js`.
- Wszystko po polsku; wygląd matowy i spokojny, nie „AI slop”.
- Po każdej zmianie dopisz wpis w liście zmian: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis"`.
- Commity jako właściciel, **bez** „Co-Authored-By” i wzmianek o AI. Nie buduj ani nie publikuj wersji bez prośby.
- Nigdy nie kopiuj sekretów (hasła, tokeny, `.env`) do kodu, logów ani czatu. Napisz, czego nie mogłeś sprawdzić.
