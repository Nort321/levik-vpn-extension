# Levik VPN — Chrome extension

Open source of the Levik VPN Manifest V3 extension for Chrome, published so
anyone can verify how it handles browsing data, credentials and proxy
settings. The server side (account gateway, proxy and node inventory) is not
part of this repository.

## Build

Requires Node 24+ and npm.

```sh
npm ci
npm run build
```

In Chrome open `chrome://extensions`, enable Developer mode, choose **Load
unpacked** and select `dist/`. `options.html` opens the same UI in a full tab.

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run package
```

`npm run package` writes a store ZIP to `release/` with the extension files at
its root: no source, `node_modules`, tests or credentials.

## Architecture

- `src/popup.ts`, `popup.css`: dependency-free UI, local SVG icons/CSS flags, localized accessible controls and user-facing error states.
- `src/i18n.ts`: fully typed English/Russian dictionaries; `_locales/en` and `_locales/ru` provide Chrome store-facing extension metadata.
- `src/model.ts`: normalized domain boundaries, PAC construction, trial/date helpers and credential-free view models.
- `src/background.ts`: serialized operations in the MV3 service worker; trusted-only persistent storage; proxy credentials scoped to `isProxy`, exact challenger host and port; bounded authentication retries; alarms, startup behavior, privacy setting cleanup and account refresh.
- `scripts/`: repeatable build, packaging, browser integration and store asset generation.

Only the worker accesses tokens and proxy passwords. The popup receives a redacted view. Cabinet authorization uses a one-time pairing exchange. The extension session and pending pairing persist in `chrome.storage.local` with `TRUSTED_CONTEXTS`; nothing is synced. No content scripts, cookies permission, remote JavaScript, inline scripts, analytics, injected page code or ad-blocking rules are included.

## Connection semantics

“Full VPN” protects supported Chrome HTTP/HTTPS browsing through an **HTTPS proxy**, not all operating-system traffic. “Smart routing” sends Russian domain zones (`.ru`, `.su`, `.рф`, `.рус`, `.moscow`, `.москва`, `.tatar`) and user-added direct exceptions outside the VPN; every other supported destination uses the selected HTTPS proxy. Classification is domain-based and deliberately performs no local DNS or IP-geolocation lookup. The proxy resolves routed destination hostnames. Chrome background DNS, direct/bypassed traffic, non-browser applications, extension updates and implicit Chrome loopback bypasses remain outside this protection.

`leviknet.com` and the configured proxy host are direct exceptions so account management remains reachable. `example.com` is always routed through the proxy for a small connection check, including smart mode; this is documented in the privacy policy. The extension shows Protected only after applying the proxy, checking ownership and completing that HTTPS request. If a configured proxy fails later, no DIRECT fallback is added to its PAC; the UI reports failure and the power control lets the user clear the proxy. Disconnect clears this extension's settings, restoring the previous/system configuration.

WebRTC protection uses `disable_non_proxied_udp` while connected and releases the setting on disconnect. It can affect calls. It is not an OS kill switch or a promise to eliminate every form of DNS/WebRTC leakage. HTTP destinations are plaintext between the Levik proxy and destination; HTTPS content remains encrypted end-to-end to the destination. [Chrome proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy), [Chrome privacy API](https://developer.chrome.com/docs/extensions/reference/api/privacy).

Chrome `webRequest` does not provide complete network byte totals. Uploaded/downloaded show `—`, with an explanatory tooltip, rather than simulated counters. Session duration is real; latency is `—` until supplied by a measured service. The reference's sample numbers are not represented as live measurements.

## Account and subscription

An explicit privacy consent precedes personal-cabinet authorization. A normal sign-in grants Pro only for an active Remnawave Regular or Multi subscription and expires on that subscription's actual date. The separate **Start 3-day free trial** action grants one account-bound 72-hour browser trial when no paid entitlement is active; normal sign-in never starts it implicitly. The extension does not request a Remnawave configuration with the user's HWID and therefore does not consume a user device slot. The worker releases expired proxy settings; the gateway independently denies expired credentials and closes expired tunnels.

The cabinet authorizes only active accounts after its existing session, origin, CSRF and rate-limit checks. Only `regular` and `multi` bridge subscriptions with a finite future expiry grant Pro access; LTE-only and trial products do not. The extension trial is tracked separately in the gateway and cannot be restarted by reinstalling the extension. The gateway checks that the account remains active in a background sweep, with a five-minute verification grace period during cabinet outages. The short-lived cabinet web session is used only during approval, is not stored by the gateway and does not limit extension access. Subscription entitlement expiry is captured at approval; paid changes are picked up on a new sign-in.

The UI says **Expires**, not “Renews”, because the extension does not charge users or auto-renew subscriptions. Upgrade opens the personal cabinet. Log out revokes the gateway session and releases local proxy/privacy settings even if the network is unavailable. User approval is explicit on the cabinet page, followed by “I approved sign-in” in the popup; no approval is inferred from opening a tab.

## License

Original Levik VPN source code is licensed under the [GNU AGPLv3](LICENSE).
The privacy policy is published at https://leviknet.org/legal/privacy.
