# Privacy Practices handoff

Review against the actual deployed service before submitting. Do not claim “no data collected” simply because this extension has no analytics.

| Item | Implementation and disclosure |
| --- | --- |
| Single purpose | Encrypted browser proxy routing controlled by the user |
| Authentication information | Cabinet pairing, with a secret polling token; extension session persists locally and hashed server-side |
| Personally identifiable information | Account label if it identifies a person; source IP processed for abuse limits, hashed for trial eligibility |
| Web/network activity | Destinations and connection traffic necessarily processed by gateway; no browsing history log in supplied code |
| Local rules/preferences | Stored locally, not synced or sent as browsing history |
| Public inventory | Direct HTTPS request to sub.leviknet.com:2095 on opening/every minute, even before login; no account credentials; source IP necessarily visible; no request logging in inventory service |
| Third-party probe | example.com receives one connection-check request through proxy, without account credentials |
| Advertising/analytics | None in this code |
| Sale / unrelated transfer | None in this code; hosting providers still process necessary traffic |
| Retention/deletion | See bundled policies; deployer must disclose infrastructure retention and implement support deletion workflow |

`proxy`: apply/clear Chrome routing. `storage`: session, settings, pending pairing. `alarms`: account refresh and expiry. `webRequest`/`webRequestAuthProvider`: answer authenticated proxy challenges for routed destinations. `privacy`: manage WebRTC UDP policy only while connected. `<all_urls>`: proxy authentication may be requested for any user-selected website.

The ZIP contains only bundled local scripts and a restrictive CSP. No remote executable code, content scripts, analytics, history access, ad blocking, or embedded credentials. `tabs.create` opens the account/privacy pages without requiring the tabs permission.

Store screenshots: final generated `listing-*.png` show the real disconnected UI. Raw `*-fixture.png` files are labeled QA fixtures in filenames and must not be presented as proof of live locations or measurements. Include the privacy policy at a stable public HTTPS URL and confirm publisher identity, support contact, paid-service descriptions and review access before upload.

Official references: [privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy), [listing assets](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest).
