'use strict';

// Chromium is downloaded on-demand only when the optional Telegram TGS
// conversion feature is first used; normal deployments do not need the browser.
module.exports = { skipDownload: true };
