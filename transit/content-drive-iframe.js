(function () {
  let isDriveEmbed = false;
  try {
    const params = new URL(location.href).searchParams;
    const origin = params.get('post_message_origin') || params.get('origin') || '';
    isDriveEmbed = origin.includes('drive.google.com');
  } catch (_) {}
  if (!isDriveEmbed) return;

  const TIMEDTEXT_RE = /^https:\/\/drive\.google\.com\/u\/\d+\/timedtext.*[?&]kind=asr/;
  const reportedUrls = new Set();

  function reportTimedtextUrl(url) {
    if (!url || reportedUrls.has(url)) return;
    if (!TIMEDTEXT_RE.test(url)) return;
    reportedUrls.add(url);
    if (!chrome?.runtime?.id) return;
    try {
      chrome.runtime.sendMessage({ type: 'DRIVE_TIMEDTEXT_URL', payload: { url } })?.catch?.(() => {});
    } catch (_) {}
  }

  try {
    for (const entry of performance.getEntriesByType('resource')) {
      reportTimedtextUrl(entry.name);
    }
  } catch (_) {}

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        reportTimedtextUrl(entry.name);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}
})();
