// How fast a campaign's story moves. The story (its backbone) is the same size at any pace; the pace decides how many
// sessions it takes to play through: a slow burn takes about 20, a fast game about 5. Shared by the server (the DM's
// instructions) and the client (the pickers on the new-campaign page and the DM Screen).

export const STORY_PACES = [
  {
    id: 'slow', label: 'Slow burn', sessions: 20,
    blurb: 'Take your time. Every NPC has to be really talked to, information is earned, and scenes breathe. About 20 sessions for the whole story.',
    dm: 'Let scenes breathe. NPCs never hand over what they know: the party earns it through real conversation, trust, favours, good questions and the right approach, and secrets come out a piece at a time over several talks. Clues are scattered and the players connect them. Linger on travel, downtime, side characters and small personal moments; one or two key scenes in a session is plenty. Move the main story forward by about one beat a session.',
  },
  {
    id: 'relaxed', label: 'Relaxed', sessions: 14,
    blurb: 'Plenty of conversation and side moments, with the story moving every session. About 14 sessions for the whole story.',
    dm: 'Give conversations room: NPCs open up once the party asks well or builds a little trust, and important secrets take some digging. Leave space for side moments and character scenes, but make sure each session moves the main story forward at least one clear beat.',
  },
  {
    id: 'steady', label: 'Steady', sessions: 10,
    blurb: 'A balance of talking, exploring and story. About 10 sessions for the whole story.',
    dm: 'Balance it. NPCs share what they reasonably would when asked; deeper secrets need a good question, a check or a favour. Keep travel and downtime short unless the players want to linger. Each session should move the main story forward a beat or two.',
  },
  {
    id: 'brisk', label: 'Brisk', sessions: 7,
    blurb: 'The story keeps moving: NPCs get to the point and the next lead is never far away. About 7 sessions for the whole story.',
    dm: 'Keep things moving. NPCs get to the point and share what matters after a question or two; clues point clearly to the next step. Summarise travel, shopping and downtime in a line or two. Each session should cover two or three beats of the main story.',
  },
  {
    id: 'fast', label: 'Fast', sessions: 5,
    blurb: 'Fast-paced: exposition comes quickly and easily, and each session covers a lot of the story. About 5 sessions for the whole story.',
    dm: 'Move fast. Exposition comes quickly and plainly: NPCs tell the party what they need the first time they ask (often before they ask), and clues lead straight to the next step. Skip or summarise travel, shopping, rests and downtime in a sentence and cut to the next scene that matters. Nearly every turn should advance the main story, and a session should cover several beats, often most of an act. Side content only when the players go looking for it.',
  },
];

export const DEFAULT_PACE = 'steady';

/** The pace a campaign plays at (the default for a campaign that never chose one). */
export function paceOf(settings) {
  return STORY_PACES.find((p) => p.id === settings?.storyPace) || STORY_PACES.find((p) => p.id === DEFAULT_PACE);
}

export const isPace = (id) => STORY_PACES.some((p) => p.id === id);
