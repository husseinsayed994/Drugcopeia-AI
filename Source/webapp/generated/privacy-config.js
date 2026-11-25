/* GENERATED FILE - do not edit. Source: Source/privacy.config.json. Run scripts/gen-privacy-config.py. */
(function (root) {
  'use strict';
  root.DAWAYA_PRIVACY_CONFIG = Object.freeze({
  "history": {
    "defaultEnabled": true,
    "encryptAtRest": true,
    "maxTurns": 50,
    "maxSessions": 30,
    "maxAnswerChars": 4000,
    "maxBytes": 400000
  },
  "version": 2,
  "defaultOffline": false,
  "offlineKey": "drugcopeia-ai-offline-mode",
  "allowedHosts": [
    {
      "host": "www.who.int",
      "scheme": "https",
      "pathPrefixes": [
        "/api/hubs/newsitems",
        "/rss-feeds/",
        "/news/item/"
      ],
      "purpose": "Headline update for the home news list. Read-only GET, run by the app itself: once when the home page is opened and afterwards at most once every six hours while the app is in the foreground. Offline mode refuses it, as it refuses everything here. Sends no identifier, no cookie and no referrer; the app never loads a WHO page in-process except to read its public summary meta tag.",
      "userInitiatedOnly": false,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "api.fda.gov",
      "scheme": "https",
      "pathPrefixes": [
        "/drug/enforcement.json"
      ],
      "purpose": "FDA drug enforcement reports for the news list. Read-only GET on the same news schedule as www.who.int - opening the home page, then at most every six hours - never in offline mode. Fixed date range, no identifiers.",
      "userInitiatedOnly": false,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "eutils.ncbi.nlm.nih.gov",
      "scheme": "https",
      "pathPrefixes": [
        "/entrez/eutils/"
      ],
      "purpose": "PubMed search and abstract fetch for the news list. Read-only GET on the same news schedule as www.who.int - opening the home page, then at most every six hours - never in offline mode. Fixed query text, no identifiers.",
      "userInitiatedOnly": false,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "127.0.0.1",
      "scheme": "http",
      "pathPrefixes": [],
      "purpose": "Loopback shell server used only by the Windows build to serve the bundled app. Never leaves the device.",
      "userInitiatedOnly": false,
      "localhost": true,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "localhost",
      "scheme": "http",
      "pathPrefixes": [],
      "purpose": "Loopback alias of the Windows shell server and the development server. Never leaves the device.",
      "userInitiatedOnly": false,
      "localhost": true,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "commons.wikimedia.org",
      "scheme": "https",
      "pathPrefixes": [
        "/w/api.php"
      ],
      "purpose": "The \"Photos\" section of the medicine page. Only when the reader presses Show photos; the request carries the product trade name as a search term and nothing else - no account, identifier, cookie, referrer, location, device data or patient information. No answer is stored on this device, and pressing Hide photos leaves nothing behind.",
      "userInitiatedOnly": true,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "thumb.wikimedia.org",
      "scheme": "https",
      "pathPrefixes": [
        "/wikipedia/commons/"
      ],
      "purpose": "The small previews in the \"Photos\" grid, fetched only after the reader pressed Show photos. Each is one image file; no file name from the reader's device, no identifier and no header that could single anyone out is sent, and the bytes live in memory until the modal is closed.",
      "userInitiatedOnly": true,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    },
    {
      "host": "upload.wikimedia.org",
      "scheme": "https",
      "pathPrefixes": [
        "/wikipedia/commons/"
      ],
      "purpose": "The full-size file shown in the \"Photos\" modal, fetched only when the reader taps a preview. Same rule as the previews: one image, no identifier, nothing written to storage.",
      "userInitiatedOnly": true,
      "localhost": false,
      "methods": [
        "GET"
      ],
      "maxBytes": 0
    }
  ],
  "forbiddenRequestHeaders": [
    "api-user-agent",
    "authorization",
    "cookie",
    "x-device-id",
    "x-install-id",
    "accept-language"
  ],
  "forbiddenUrlParameters": [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "client_id",
    "device_id",
    "did",
    "imei",
    "android_id",
    "adid",
    "idfa",
    "sid",
    "session_id",
    "user_id",
    "uid",
    "api_key"
  ],
  "bannedThirdPartyOrigins": [
    "*.wikipedia.org",
    "clinicaltables.nlm.nih.gov",
    "www.bing.com",
    "bing.com",
    "www.google.com",
    "encrypted-tbn*.googleusercontent.com",
    "tse*.mm.bing.net"
  ],
  "storage": {
    "localUserDataKeys": [
      "drugcopeia-ai-reminders-v1",
      "drugcopeia-ai-reminder-taken-v1",
      "drugcopeia-ai-custom-drugs-v1",
      "drugcopeia-ai-ai-chat-v1",
      "drugcopeia-ai-calc-history",
      "drugcopeia-ai-study-stats"
    ],
    "plaintextAllowedKeys": [
      "drugcopeia-ai-theme",
      "drugcopeia-ai-language",
      "drugcopeia-ai-type-scale",
      "drugcopeia-ai-offline-mode",
      "drugcopeia-ai-news-v1",
      "drugcopeia-ai-ai-model-state-v1",
      "drugcopeia-ai-ai-settings-v1"
    ]
  }
});
  root.DAWAYA_MODEL_DOWNLOAD = Object.freeze({
  "requiresOfflineModeOff": true,
  "userInitiatedOnly": true,
  "hosts": [
    {
      "host": "huggingface.co",
      "suffix": "",
      "scheme": "https",
      "purpose": "Serves the pinned model file URL and redirects it to the Hugging Face CDN."
    },
    {
      "host": "",
      "suffix": ".hf.co",
      "scheme": "https",
      "purpose": "Hugging Face CDN endpoints (cdn-lfs, cas-bridge, regional aws/gcp) that actually deliver the bytes. Matched by DNS suffix, so a look-alike domain cannot pass."
    },
    {
      "host": "github.com",
      "suffix": "",
      "scheme": "https",
      "purpose": "Serves the model file pinned as a release asset of the app's own repository (husseinsayed994/Drugcopeia-AI, tag model-v3) and redirects it to GitHub's asset CDN."
    },
    {
      "host": "release-assets.githubusercontent.com",
      "suffix": "",
      "scheme": "https",
      "purpose": "GitHub release asset CDN that delivers the model bytes."
    },
    {
      "host": "objects.githubusercontent.com",
      "suffix": "",
      "scheme": "https",
      "purpose": "Older GitHub release asset CDN host, still used for some redirects."
    }
  ],
  "maxRedirects": 5
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
