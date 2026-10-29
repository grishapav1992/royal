/** Local manual review stand with synthetic funds and explicit prepared-example headers. */
export {};
process.env.TEMPLE_TEST_RNG='1';
process.env.TEMPLE_WEB_PORT??='5233';
process.env.TEMPLE_API_PORT??='2633';
process.env.TEMPLE_COOKIE_NAMESPACE='temple_devices_'+process.env.TEMPLE_WEB_PORT;
console.log('Device review page after startup: http://localhost:'+process.env.TEMPLE_WEB_PORT+'/tests/fixtures/temple-device-review.html?lang=ru');
await import('./temple-preview');
