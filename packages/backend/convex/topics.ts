import { query } from "./_generated/server";

export const getTopics = query({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    return topics.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});
