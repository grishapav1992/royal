# Languages

The service supports Russian and English. Russian is the default. Choose a language in the header, login dialog or player settings. The choice is saved as `royal-language` in local storage. `?lang=en` and `?lang=ru` take precedence over the saved choice and also work when browser storage is unavailable.

Switching languages reloads the page. The current room query and history state are preserved so the existing lobby recovery path can restore the connection. Accepted bets, pending operation IDs and saved bonus rounds use their existing storage and server logic.

## Adding interface text

Import `t` or `tr` from `src/i18n/index.ts`. Fixed Russian strings use `t('Играть')`. Text and markup with interpolated values use the `tr` template tag. Add the corresponding English text to `src/i18n/en.ts`. The dictionary uses the fixed Russian source text as its key.

Plain text templates use numbered placeholders such as `{0}`. Translation may reorder placeholders. Markup templates translate only fixed source segments. Interpolated values are preserved verbatim. Keep using the existing HTML escaping helpers for interpolated values.

Never translate player names or user-written chat. Known server messages are translated at their display boundaries. Parameterized system messages use templates that preserve names. Keep IDs, action names, payment units and persisted state independent from display language.

## Coverage

The language selection covers authentication, character customization, navigation, floor signage, game catalogues, native games, game rules, wallet displays and known server errors. Number and date formatting follows the selected language. English output is requested for new Mira replies and suggested choices; conversation history is preserved in its original language.

The two external game integrations already launch in English. Their embedded contents, third-party artwork and audio remain provider-controlled. Existing Russian audio recordings are not dubbed by this change.

## Verification

From this candidate's project directory:

```sh
npm run build
node --import tsx --test tests/*.test.ts
```

The tests validate dictionary coverage, placeholder preservation, language selection, interpolated content, known server notices, exact balance formatting and Mira language handling. The previous Russian Mira tests are retained as regression tests.

For the browser checks, start Vite on `127.0.0.1:5188`, then run `node scripts/check-english.mjs`. This checks the native studio screens, header and modal language controls, persistence, English authentication errors and a 390-pixel viewport. External demo catalogues are stubbed.

`node --import tsx scripts/run-english-test-server.ts` starts a separate server on port 2578 with a newly initialized temporary PostgreSQL database. It does not load a project `.env` and disables external AI credentials. Run a second Vite instance on port 5190 with `ROYAL_DEV_API_URL=http://127.0.0.1:2578`, then `node scripts/check-english-live.mjs`. This checks signup, the demo wallet, a confirmed test bet, Mira's language and reconnection after a language switch. Stop the test server to delete its temporary database.
