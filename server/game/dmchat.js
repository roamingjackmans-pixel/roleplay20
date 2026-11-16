// DM Chat: a player privately asks the Dungeon Master a question (a rule, their character, what their character knows
// or can see, how far something is). Only they see the question and the answer, even with the host's God view. It never
// uses a turn, never waits for the table and never changes the game.
import { askClaude, NoAIError } from '../ai/client.js';
import { DM_CHAT_CORE } from '../ai/prompts.js';
import { DM_CHAT_SCHEMA } from '../ai/schemas.js';
import { cachedCampaignContext, partyBlock, npcBlock, sceneBlock, historyBlock } from './context.js';
import { member } from './campaign.js';
import { getUser } from '../auth.js';
import * as E from './engine.js';
import * as K from './combat.js';

const answering = new Set(); // `${campaignId}:${userId}` while the DM works on that player's question

/** A player asks the DM something privately. The answer arrives as its own log entry, only to them. */
export function askDm(c, userId, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) return { error: 'Type your question for the DM.' };
  const m = member(c, userId);
  if (!m) return { error: 'Join the campaign first.' };
  const key = `${c.id}:${userId}`;
  if (answering.has(key)) return { error: 'The DM is still answering your last question.' };
  const q = E.addLog(c, { kind: 'dmchat', role: 'player', userId, name: getUser(userId)?.displayName || 'You', text: t, to: [userId], strictPrivate: true });
  answering.add(key);
  answer(c, userId, q).finally(() => answering.delete(key));
  return { ok: true, id: q.id };
}

export function isAnswering(c, userId) { return answering.has(`${c.id}:${userId}`); }

async function answer(c, userId, q) {
  try {
    const res = await askClaude({ task: 'dm_chat', system: DM_CHAT_CORE, cachedContext: cachedCampaignContext(c), prompt: dmChatPrompt(c, userId, q), schema: DM_CHAT_SCHEMA, ...E.dmBrain(c), maxTokens: 8000, campaignId: c.id });
    E.trackUsage(c, res);
    const a = String(res.data?.answer || '').trim();
    E.addLog(c, { kind: 'dmchat', role: 'dm', replyTo: q.id, text: a || "Hmm, I don't have a good answer for that one. Try asking it another way?", to: [userId], strictPrivate: true });
  } catch (e) {
    const why = e instanceof NoAIError
      ? "The AI Dungeon Master isn't connected right now, so it can't answer questions. Ask the host in Table Talk."
      : `The DM couldn't answer that just now (${String(e.message || e).slice(0, 120)}). Try asking again.`;
    E.addLog(c, { kind: 'dmchat', role: 'dm', replyTo: q.id, error: true, text: why, to: [userId], strictPrivate: true });
  }
}

/** Everything the DM needs for one private answer: who's asking, the party, the scene, the fight, recent play. */
export function dmChatPrompt(c, userId, q) {
  const m = member(c, userId);
  const myName = m?.characterId ? E.charName(c, m.characterId) : null;
  const asker = myName ? `${myName} (${m.characterId}), played by ${getUser(userId)?.displayName || '?'}` : `${getUser(userId)?.displayName || 'A player'} (no character yet)`;
  const earlier = c.log.filter((e) => e.kind === 'dmchat' && Array.isArray(e.to) && e.to.includes(userId) && e.id !== q.id).slice(-8)
    .map((e) => `${e.role === 'dm' ? 'DM' : 'Player'}: ${e.text}`);
  return [
    `# WHO IS ASKING\n${asker}`,
    `# PARTY\n${partyBlock(c, E.onlineUsers(c))}`,
    `# NPCs IN PLAY\n${npcBlock(c)}`,
    `# SCENE\n${sceneBlock(c)}`,
    fightBlock(c, m?.characterId),
    historyBlock(c),
    earlier.length ? `# YOUR EARLIER PRIVATE CHAT WITH THIS PLAYER (most recent last)\n${earlier.join('\n')}` : '',
    `# THEIR QUESTION\n${q.text}`,
  ].filter(Boolean).join('\n\n');
}

function fightBlock(c, characterId) {
  const k = c.combat;
  if (!k) return '';
  const cur = K.currentCombatant(c);
  const mine = Object.values(k.combatants).find((x) => x.characterId === characterId);
  const lines = [`A fight is on: round ${k.round}, ${cur ? `${cur.name}'s turn` : 'between turns'}.`];
  if (mine && cur && cur.id === mine.id) {
    const eco = K.movementInfo(c, mine);
    const done = k.economy?.[mine.id]?.done || [];
    lines.push(`It is their turn. Done this turn so far: ${done.length ? done.join('; ') : 'nothing yet'}. Left: action ${eco?.action ? 'used' : 'available'}, bonus action ${eco?.bonus ? 'used' : 'available if a feature grants one'}, ${eco?.left ?? 0} ft of movement.`);
  }
  for (const x of Object.values(k.combatants)) {
    const tok = c.tokens[x.tokenId];
    if (!tok || tok.dead || (tok.hidden && !K.isPc(x))) continue;
    lines.push(`- ${x.name} (${x.kind}) at ${tok.x},${tok.y}`);
  }
  return `# THE FIGHT (grid squares are 5 ft)\n${lines.join('\n')}`;
}
