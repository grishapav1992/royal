# Mortal Kombat with common virtual USDT

The user replaced Nile stakes with the existing freely topped-up virtual USDT on 24 October. The independent floor-2 module uses the host wallet and its standard top-up dialog. Existing CommonCombatWallet, virtual PvP journal and server simulation own funding, outcome and the 95% / 5% split. No financial network service is changed.

Prepare a clean committed source already included in main with the shared release tools, using the verified production commit from SERVER.md. prepare.py compares canonical source content against a fresh guarded snapshot and selects only exact reviewed outputs. The host/backend is installed first; modules.py then extends the host contract with Mortal Kombat and publishes compatible immutable packages under the shared locks. Old URLs and unrelated pointers remain intact.

Source, previous image and game-wallet backups are verified before installation. After any virtual wager is accepted, an old Nile backend cannot safely resume the virtual banks: preserve the database and use a compatible forward repair. Wallet history and accepted operations are never restored from a dump during rollback. Production verification reads public bytes; synthetic accounts and free top-ups are tested in an isolated database.
