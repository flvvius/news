# Email Setup with Resend

This guide explains how to set up email sending for waitlist notifications using Resend.

## 1. Get Your Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Verify your email address
3. Go to **API Keys** in the dashboard
4. Click **Create API Key**
5. Copy the key (it starts with `re_`)

## 2. Add API Key to Environment Variables

### For Local Development

Add to your `.env.local` file in the `packages/backend` directory:

```bash
RESEND_API_KEY=re_your_api_key_here
```

### For Production (Convex Dashboard)

1. Go to your Convex project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new variable:
   - Key: `RESEND_API_KEY`
   - Value: Your Resend API key
4. Save and redeploy

## 3. Verify Your Domain (For Production)

By default, Resend lets you send from `onboarding@resend.dev`, but for production you need to verify your own domain.

### Steps:

1. In Resend dashboard, go to **Domains**
2. Click **Add Domain**
3. Enter your domain (e.g., `biviant.com`)
4. Add the DNS records Resend provides to your domain registrar
5. Wait for verification (usually 5-10 minutes)
6. Update the `from` field in `emails.ts`:

```typescript
from: "Biviant <onboarding@yourdomain.com>",
```

## 4. Email Templates

We have two email templates:

### Welcome Email (`sendWelcomeEmail`)

Sent immediately when someone joins the waitlist.

**Includes:**

- Personalized greeting (uses first name from signup)
- Their position in the waitlist (#1, #2, etc.)
- What to expect next
- Referral link to move up the list

### Invite Email (`sendInviteEmail`)

Sent when you're ready to give early access.

**Includes:**

- Unique invite code
- Direct signup link
- Instructions to get started

## 5. Testing Emails Locally

### Option A: Use Resend Test Mode (Recommended)

1. Use your Resend API key even in development
2. Emails will be sent to real addresses (use your own email for testing)
3. View sent emails in Resend dashboard → **Emails**

### Option B: Skip Email Sending

If `RESEND_API_KEY` is not set, the app will skip email sending (no errors).

## 6. Sending Invite Emails (Manual Process)

When you're ready to invite someone from the waitlist:

1. Query the waitlist table to get pending users
2. Generate a unique invite code
3. Call the `sendInviteEmail` action manually or via a script

### Example Script (Future Implementation):

```typescript
// In a Convex mutation or script
const user = await ctx.db
  .query("waitlist")
  .withIndex("by_status")
  .filter((q) => q.eq(q.field("status"), "pending"))
  .first();

const inviteCode = crypto.randomUUID();

await ctx.db.patch(user._id, {
  status: "invited",
  inviteCode,
  invitedAt: Date.now(),
});

await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
  email: user.email,
  name: user.name,
  inviteCode,
});
```

## 7. Monitoring Email Delivery

### In Resend Dashboard:

- **Emails** → See all sent emails, delivery status, opens, clicks
- **Webhooks** → Get notified of bounces, complaints, opens
- **Analytics** → Track email performance

### Common Issues:

1. **Emails not sending**: Check if `RESEND_API_KEY` is set correctly
2. **Emails in spam**: Verify your domain and set up SPF/DKIM
3. **Bounced emails**: Update user status to "bounced" in waitlist table

## 8. Best Practices

### Rate Limiting

Resend free tier: 3,000 emails/month, 100 emails/day

For bulk sends (e.g., update emails to entire waitlist), batch them:

```typescript
const users = await ctx.db
  .query("waitlist")
  .withIndex("by_status")
  .filter((q) => q.eq(q.field("status"), "pending"))
  .collect();

// Send in batches of 50
for (let i = 0; i < users.length; i += 50) {
  const batch = users.slice(i, i + 50);

  for (const user of batch) {
    await ctx.scheduler.runAfter(i * 1000, internal.emails.sendUpdateEmail, {
      email: user.email,
      name: user.name,
    });
  }
}
```

### Unsubscribe Handling

The email templates include an unsubscribe link. You'll need to:

1. Create an `/unsubscribe` route
2. Update the user's `unsubscribed` field to `true`
3. Filter out unsubscribed users when sending emails

### Email Personalization

- Always use first name when available
- Include their waitlist position (creates urgency)
- Add relevant context (e.g., "You signed up on Feb 15, 2026")

## 9. Future Enhancements

- [ ] Add React Email templates for better design
- [ ] Set up webhooks to track bounces/complaints
- [ ] Create email sequences (Welcome → Update #1 → Update #2 → Invite)
- [ ] Add A/B testing for email copy
- [ ] Implement referral tracking
- [ ] Auto-send monthly update emails

## Resources

- [Resend Documentation](https://resend.com/docs)
- [React Email Templates](https://react.email)
- [Email Best Practices](https://resend.com/docs/best-practices)
