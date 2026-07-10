# L9 — Image and thumbnail policy

Three tiers, enforced in code (`lib/imagePolicy.ts` is the decision point):

| Tier | Policy | Where enforced |
|---|---|---|
| (a) favicons / source logos | Allowed; may be cached/served small (share cards) | `shareAssetsNode.fetchSourceLogoData` |
| (b) publisher og:image thumbnails | **Hotlink only** — never downloaded or rehosted; displayed small with attribution, wrapped in a link to the original article; only while the domain's L5 state is `full` and no kill switch is on | `events.getEventBySlug`, `lib/publicEventPreviews.syncPublicEventPreview`, event page `<figure>` |
| (c) full editorial images | Never fetched, stored, or displayed | `imagePolicy.test.ts` lint: `ctx.storage.store` allowed only in `shareAssetsNode.ts` (own-rendered brand card, publisher photo removed) |

Kill switches:

- **Global**: config key `og_image_display_enabled` (default `true`) — set to
  `false` and every event page / feed preview drops publisher thumbnails.
- **Per-domain**: `domainPermissions.imagesDisabled` via
  `domainPermissions.setDomainImagePolicyForAdmin` — also triggers
  `purgeDomainEventImages` for existing heroes.
- **Automatic**: any L5 opt-out (state ≠ `full`) strips thumbnails and the
  purge clears stored `imageUrl` references (article + event, previews
  resynced).

Notes:

- `imageVerification` fetches only the first KB of an image to sniff magic
  numbers (validity check) — bytes are dropped, nothing stored.
- Share cards (`shareAssetsNode`) previously baked the publisher og:image
  into a stored JPEG; since L9 they render the brand layout with source
  logos only.
