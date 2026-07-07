# FOOTER_TODO — placeholders awaiting real business details (BIV-803)

The footer pages contain real product content, but business identity details
must not be invented. Every `{{TODO: …}}` placeholder in the pages is listed
here; fill them in once the legal/operational details exist, then delete the
corresponding row. The test `apps/web/src/routes/footer-pages.test.tsx`
cross-checks that the placeholders in the pages and the rows in this file
stay in sync.

| Placeholder | Page(s) | Field |
|---|---|---|
| `{{TODO: entitate juridică}}` | /despre („Cine suntem”), /contact („Date de identificare”), /politica-confidentialitate („Cine este operatorul”), /termeni („Legea aplicabilă și modificări”) | Numele entității juridice care operează Biviant (SRL/PFA/etc.) |
| `{{TODO: adresă sediu}}` | /contact („Date de identificare”), /politica-confidentialitate („Cine este operatorul”) | Adresa sediului social |
| `{{TODO: adresă de e-mail de contact}}` | /contact („Cum ne contactezi”), /politica-confidentialitate („Cine este operatorul”) | Adresa de e-mail de contact/suport pe domeniul biviant.com — de provizionat în Resend înainte de publicare (nu asertăm o adresă care nu există încă) |
| `{{TODO: data intrării în vigoare}}` | /politica-confidentialitate („Modificări ale politicii”), /termeni („Legea aplicabilă și modificări”) | Data intrării în vigoare a documentelor legale (de stabilit la lansare, ideal după o revizuire juridică) |

Notes:

- The privacy policy and the terms describe the *actual* current stack
  (Convex, Vercel, PostHog EU, Resend, Google/Apple OAuth, 7-day unverified
  account cleanup, profile-page account deletion). If the stack changes,
  update the pages.
- A lawyer should review /politica-confidentialitate and /termeni before
  public launch; the content is accurate to the implementation but is not
  legal advice.
- Ops check before launch: the privacy policy says account deletion triggers
  the PostHog identity deletion request — that backend call no-ops unless the
  PostHog personal-API deletion credentials are configured on the production
  deployment. Verify they are set.
