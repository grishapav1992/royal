/** Run once after all workers, including replacements after a failed test. */
export default async function shutdownForestReview() {
  const origin = 'http://127.0.0.1:' + (process.env.FOREST_WEB_PORT || '5296');
  await fetch(origin + '/__test/forest-heart/shutdown', { method: 'POST', headers: { 'X-Royal-Forest-Test': 'shutdown' } }).catch(() => {});
}
