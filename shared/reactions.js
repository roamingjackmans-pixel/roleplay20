// Reactions on what other players say and do at the table (their actions and table talk), the same set Facebook
// Messenger offers by default. Used by the server (which ones are allowed) and the client (the picker).
export const REACTIONS = [
  { emoji: '❤️', label: 'Love' },
  { emoji: '😆', label: 'Haha' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '😠', label: 'Angry' },
  { emoji: '👍', label: 'Like' },
];

export const REACTION_EMOJI = REACTIONS.map((r) => r.emoji);

/** Log entries that can be reacted to: a player's declared action and table talk. */
export const REACTABLE_KINDS = ['action', 'chat'];
