# U-News

A bias-aware news aggregation platform that clusters articles into events and provides personalized insights.

## Tech Stack

- **Frontend**: TanStack Start (React), TailwindCSS
- **Backend**: Convex (serverless database + functions)
- **Auth**: Better Auth with Convex adapter
- **Mobile**: Expo (React Native)

---

## Database Schema Documentation

The schema is designed around the concept of **Events** (news stories) that aggregate multiple **Articles** from different **Sources**, allowing users to see multiple perspectives on the same story.

### 1. Topics

**Purpose**: Normalized taxonomy for categorizing events (e.g., "Economy", "Tech", "Politics").

| Field         | Type     | Description                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `slug`        | `string` | URL-friendly identifier (e.g., `"economy"`, `"tech"`). Used in URLs and queries. |
| `displayName` | `string` | Human-readable name (e.g., `"Economy"`, `"Technology"`). Shown in the UI.        |

**Indexes**:

- `by_slug` - Fast lookup by slug for URL routing.

---

### 2. Sources

**Purpose**: Reputation layer for news outlets. Stores bias and reliability metadata for each publication.

| Field              | Type     | Description                                                                                                             |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `domain`           | `string` | The publication's domain (e.g., `"nytimes.com"`, `"foxnews.com"`). Used to match incoming articles.                     |
| `name`             | `string` | Display name (e.g., `"The New York Times"`, `"Fox News"`).                                                              |
| `baseBias`         | `number` | Political bias score from **-5** (Far Left) to **+5** (Far Right). `0` = Center/Neutral.                                |
| `reliabilityScore` | `number` | Factual reliability from **1** (Tabloid/Unreliable) to **10** (Academic/Wire Service). Reuters/AP typically score 9-10. |
| `logoUrl`          | `string` | URL to the source's logo for UI display.                                                                                |

**Indexes**:

- `by_domain` - Fast lookup when ingesting articles to find their source.

**Bias Scale Reference**:

```
-5    -3    -1    0    +1    +3    +5
Far   Left  Lean  Ctr  Lean  Right Far
Left        Left       Right       Right
```

---

### 3. Events

**Purpose**: The core entity. An "Event" represents a news story/cluster that aggregates multiple articles covering the same topic from different perspectives.

| Field                         | Type                          | Description                                                                                |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `title`                       | `string`                      | The event headline (e.g., `"Federal Reserve Raises Interest Rates to 5.5%"`).              |
| `slug`                        | `string`                      | URL-friendly identifier for routing (e.g., `"fed-raises-rates-2024"`).                     |
| `perspectiveSummaries`        | `object`                      | AI-generated summaries from different political viewpoints.                                |
| `perspectiveSummaries.center` | `string`                      | **Required**. Neutral/factual summary of the event.                                        |
| `perspectiveSummaries.left`   | `string?`                     | Optional. How left-leaning sources frame this story.                                       |
| `perspectiveSummaries.right`  | `string?`                     | Optional. How right-leaning sources frame this story.                                      |
| `globalImpact`                | `string`                      | The "So What?" explanation for guest/anonymous users. General impact statement.            |
| `topicIds`                    | `Id<"topics">[]`              | Array of topic IDs this event belongs to. Enables multi-topic categorization.              |
| `embedding`                   | `number[]`                    | 1536-dimension vector embedding for semantic similarity search (OpenAI ada-002).           |
| `embeddingVersion`            | `number`                      | Version tracking for embeddings. Increment when re-generating.                             |
| `status`                      | `"processing" \| "published"` | Workflow state. `processing` = still clustering articles, `published` = ready for display. |
| `firstPublishedAt`            | `number`                      | Unix timestamp (ms) when the event was first published. Used for sorting by recency.       |
| `lastSummarizedAt`            | `number`                      | Unix timestamp (ms) of the last AI summarization. Used to detect stale summaries.          |

**Indexes**:

- `by_embedding` - Vector index for semantic similarity search (find related events).
- `by_slug` - Fast lookup for URL routing.
- `by_topic_recency` - Compound index for filtering by status and sorting by date.

---

### 4. Articles

**Purpose**: Individual news articles that serve as "evidence" for events. Each article belongs to one source and optionally one event.

| Field          | Type                                          | Description                                                                                                                               |
| -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `eventId`      | `Id<"events">?`                               | The event this article belongs to. `null` if not yet clustered.                                                                           |
| `sourceId`     | `Id<"sources">`                               | **Required**. The publication that wrote this article.                                                                                    |
| `title`        | `string`                                      | Article headline.                                                                                                                         |
| `url`          | `string`                                      | Original URL where the article was found.                                                                                                 |
| `canonicalUrl` | `string`                                      | Deduplicated URL (removes tracking params). Used to prevent duplicate ingestion.                                                          |
| `summary`      | `string`                                      | AI-generated summary of the article content.                                                                                              |
| `atomicFacts`  | `string[]?`                                   | Extracted factual claims (e.g., `["Vote count: 60-40", "Passed on: Tuesday"]`). Fed to the event synthesizer for efficient summarization. |
| `aiBiasScore`  | `number`                                      | AI-detected bias in the article's framing. Scale: **-5** to **+5**. May differ from source's `baseBias`.                                  |
| `embedding`    | `number[]?`                                   | Vector embedding for clustering similar articles into events.                                                                             |
| `status`       | `"unprocessed" \| "clustered" \| "discarded"` | Processing state. `unprocessed` = new, `clustered` = assigned to event, `discarded` = duplicate/irrelevant.                               |
| `publishedAt`  | `string`                                      | ISO 8601 date string when the article was originally published.                                                                           |

**Indexes**:

- `by_event` - List all articles belonging to an event.
- `by_canonical_url` - Deduplication check before ingesting new articles.
- `by_embedding` - Vector index for clustering similar articles.

---

### 5. Users

**Purpose**: User profiles with both public data (safe for UI) and private context (for personalization).

| Field                             | Type       | Description                                                                                                   |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `authUserId`                      | `string`   | Reference to Better Auth user ID. Links to authentication system.                                             |
| `email`                           | `string`   | User's email address.                                                                                         |
| **`profile`**                     | `object`   | **Public profile data** (safe to render in UI).                                                               |
| `profile.name`                    | `string?`  | Display name.                                                                                                 |
| `profile.age`                     | `number?`  | User's age (for demographic-aware insights).                                                                  |
| `profile.avatar`                  | `string?`  | Profile picture URL.                                                                                          |
| `profile.job`                     | `string?`  | Occupation (e.g., `"Software Engineer"`). Used for personalized impact.                                       |
| `profile.location`                | `string?`  | City/region. Used for location-relevant insights.                                                             |
| **`privateContext`**              | `object?`  | **🔒 Sensitive data** (requires strict RLS). Used for "Personal Impact" generation.                           |
| `privateContext.incomeBracket`    | `string?`  | Income range (e.g., `"$75k-$100k"`). Affects financial news personalization.                                  |
| `privateContext.concerns`         | `string[]` | User's concerns (e.g., `["Inflation", "Housing", "Healthcare"]`).                                             |
| `privateContext.interests`        | `string[]` | Topics of interest (e.g., `["AI", "Climate"]`).                                                               |
| `privateContext.politicalLeaning` | `string?`  | Self-reported leaning. Used to ensure balanced content exposure.                                              |
| **`stats`**                       | `object`   | **Gamification stats** for engagement tracking.                                                               |
| `stats.currentStreak`             | `number`   | Current daily reading streak.                                                                                 |
| `stats.longestStreak`             | `number`   | All-time longest streak.                                                                                      |
| `stats.articlesRead`              | `number`   | Total articles clicked/read.                                                                                  |
| `stats.biasBalance`               | `number`   | Reading balance from **-100** (only left sources) to **+100** (only right sources). `0` = perfectly balanced. |

**Indexes**:

- `by_email` - Lookup by email.
- `by_auth_user_id` - Lookup by auth provider ID.

---

### 6. User Insights

**Purpose**: Cached personalized "So What?" results for each user-event combination. Stores AI-generated personal impact statements.

| Field                    | Type           | Description                                                                                                                              |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `userId`                 | `Id<"users">`  | The user this insight belongs to.                                                                                                        |
| `eventId`                | `Id<"events">` | The event this insight is about.                                                                                                         |
| **`content`**            | `object`       | The generated insight content.                                                                                                           |
| `content.personalImpact` | `string`       | Personalized explanation (e.g., `"This tax bill could affect your software engineer salary by reducing deductions for remote work..."`). |
| `content.actionableTip`  | `string`       | Suggested action (e.g., `"Consider reviewing your W-4 withholdings"`).                                                                   |
| `eventLastUpdated`       | `number`       | Timestamp of the event when insight was generated. Used to invalidate if event is updated.                                               |
| `generatedAt`            | `number`       | Unix timestamp (ms) when this insight was created.                                                                                       |
| `expiresAt`              | `number`       | Unix timestamp (ms) when this insight should be deleted (TTL ~30 days).                                                                  |
| `lastNotifiedAt`         | `number?`      | When the user was last notified about this insight. Prevents notification spam.                                                          |

**Indexes**:

- `by_user_event` - Fast lookup for a specific user's insight on a specific event.

---

### 7. Interactions

**Purpose**: Immutable event log tracking all user interactions. Used for analytics, bias balance calculation, and recommendation tuning.

| Field                            | Type              | Description                                                 |
| -------------------------------- | ----------------- | ----------------------------------------------------------- |
| `userId`                         | `Id<"users">`     | The user who performed the action.                          |
| `eventId`                        | `Id<"events">`    | The event being interacted with.                            |
| `articleId`                      | `Id<"articles">?` | Specific article (if applicable, e.g., for `click_source`). |
| `type`                           | `enum`            | The interaction type (see below).                           |
| **`context`**                    | `object`          | Snapshot of bias/reliability at interaction time.           |
| `context.biasRating`             | `number`          | The article/source bias at time of interaction.             |
| `context.sourceReliability`      | `number`          | The source reliability score at time of interaction.        |
| **`metadata`**                   | `object`          | Additional interaction details.                             |
| `metadata.timeSpentSeconds`      | `number?`         | How long the user spent (for `view` events).                |
| `metadata.scrollDepthPercentage` | `number?`         | How far they scrolled (0.0 to 1.0).                         |
| `metadata.deviceType`            | `string?`         | `"mobile"`, `"desktop"`, `"tablet"`.                        |
| `metadata.extras`                | `any?`            | Flexible field for additional data.                         |
| `timestamp`                      | `number`          | Unix timestamp (ms) when interaction occurred.              |

**Interaction Types**:
| Type | Description |
|------|-------------|
| `view` | User viewed an event card/summary. |
| `click_source` | User clicked through to read original article. |
| `bookmark` | User saved the event for later. |
| `dismiss` | User dismissed/hid the event. |
| `share` | User shared the event. |
| `feedback_bias` | User provided feedback on perceived bias. |

**Indexes**:

- `by_user` - Query all interactions for a specific user.

---

## Entity Relationship Diagram

```
┌─────────┐       ┌─────────┐       ┌──────────┐
│ Topics  │◄──────│ Events  │───────►│ Articles │
└─────────┘  N:M  └─────────┘  1:N   └──────────┘
                       │                   │
                       │                   │
                       ▼                   ▼
                 ┌───────────┐       ┌─────────┐
                 │UserInsights│      │ Sources │
                 └───────────┘       └─────────┘
                       ▲
                       │
┌─────────┐       ┌─────────┐
│  Users  │◄──────│Interactions│
└─────────┘  1:N  └─────────┘
```

---

## Seeding the Database

Run the seed script to populate test data:

```bash
cd packages/backend
npx convex run seeds:seedDB
```

Verify the data:

```bash
npx convex run seeds:verifySeedData
```

This creates:

- 2 Topics (Economy, Tech)
- 3 Sources (CNN, Fox News, Reuters)
- 2 Events with perspective summaries
- 6 Articles (3 per event, one from each source)
