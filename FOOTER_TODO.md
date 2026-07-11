# FOOTER — business-identity notes (BIV-803)

The footer pages render real product content. The former
`{{TODO: adresă de e-mail de contact}}` placeholders on /contact and
/politica-confidentialitate have been **removed**: there is no public contact
mailbox, so the pages route users to the existing complaint channel — the
„Raportează o eroare" form, opened in a dialog on the current screen from the
AI-disclosure label on every event — and to the /contact page.
`apps/web/src/routes/footer-pages.test.tsx` enforces that no `{{TODO: …}}`
placeholder is reintroduced into a footer page.

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
