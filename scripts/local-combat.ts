/** Disposable common-wallet fixture. No blockchain or production data. */
if(process.env.NODE_ENV!=='test')throw Error('This fixture requires the isolated database test runner');
process.env.NILE_PLAY_SOCKET_FILE='';
process.env.AUTH_DB_PATH='combat_test_accounts';
const {accounts}=await import('../server/accounts');
await accounts.ready;
const a=await accounts.login('combat-local-a@example.test','Royal-test-123!');
const b=await accounts.login('combat-local-b@example.test','Royal-test-123!');
await accounts.select(a.account.id,0,'Анна');await accounts.select(b.account.id,1,'Борис');
await import('../server/index');
