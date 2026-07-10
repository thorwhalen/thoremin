/**
 * Emoji picking for custom tags (issue #113), fully client-side and dependency-free —
 * honoring thoremin's no-backend ethos and the repo's dependency-lock caution (no new
 * npm dep for a tags feature). A single curated {@link EMOJI_POOL} of ~110 high-contrast,
 * single-glyph emojis serves BOTH roles the issue asks for:
 *  - the auto-assign pool (a new tag gets a random unused emoji), and
 *  - the keyword search corpus ("type cat -> select the cat"), via each entry's
 *    hand-written `keywords`.
 *
 * The pool is deliberately biased toward mutual contrast at small size (distinct
 * animals / foods / objects / nature / shapes) so a row of tag emojis in the list stays
 * easy to tell apart. The exact set is a PROPOSAL flagged for the maintainer's sign-off
 * (see the PR); tweaking it is a one-line edit here. System-tag glyphs (see
 * {@link ./systemTags}) are intentionally EXCLUDED so a custom emoji never collides with
 * a derived one in the same column.
 *
 * If broader "search any emoji" is ever wanted, swapping the search corpus for a lazy
 * `emojilib` import is a drop-in change behind {@link searchEmoji} — the pool stays the
 * auto-assign source.
 */

/** One curated emoji: the glyph plus lowercase search keywords (label included). */
export interface EmojiEntry {
  char: string;
  keywords: string[];
}

/**
 * The curated pool (PROPOSAL — sign-off pending). ~110 visually distinct single glyphs.
 * Grouped only for readability; order is otherwise irrelevant. Deliberately avoids the
 * system-tag glyphs (colored circles, face/pose/hand cues) to prevent column collisions.
 */
export const EMOJI_POOL: readonly EmojiEntry[] = [
  // Animals — distinct silhouettes.
  { char: '🐱', keywords: ['cat', 'kitten', 'meow'] },
  { char: '🐶', keywords: ['dog', 'puppy', 'woof'] },
  { char: '🦊', keywords: ['fox'] },
  { char: '🐼', keywords: ['panda', 'bear'] },
  { char: '🦁', keywords: ['lion'] },
  { char: '🐸', keywords: ['frog', 'toad'] },
  { char: '🐵', keywords: ['monkey', 'ape'] },
  { char: '🐰', keywords: ['rabbit', 'bunny', 'hare'] },
  { char: '🐷', keywords: ['pig', 'oink'] },
  { char: '🐔', keywords: ['chicken', 'hen'] },
  { char: '🦉', keywords: ['owl'] },
  { char: '🦋', keywords: ['butterfly'] },
  { char: '🐙', keywords: ['octopus'] },
  { char: '🦈', keywords: ['shark'] },
  { char: '🐢', keywords: ['turtle', 'tortoise'] },
  { char: '🦩', keywords: ['flamingo'] },
  { char: '🦥', keywords: ['sloth'] },
  { char: '🐝', keywords: ['bee', 'honey'] },
  { char: '🐬', keywords: ['dolphin'] },
  { char: '🦄', keywords: ['unicorn'] },
  { char: '🐺', keywords: ['wolf'] },
  { char: '🐧', keywords: ['penguin'] },
  { char: '🐴', keywords: ['horse'] },
  { char: '🐮', keywords: ['cow', 'moo'] },
  { char: '🐍', keywords: ['snake', 'serpent'] },
  { char: '🦖', keywords: ['dinosaur', 'dino', 'rex'] },
  { char: '🐳', keywords: ['whale'] },
  { char: '🐞', keywords: ['ladybug', 'beetle', 'bug'] },
  // Food & fruit.
  { char: '🍎', keywords: ['apple', 'red'] },
  { char: '🍋', keywords: ['lemon', 'citrus'] },
  { char: '🍇', keywords: ['grapes', 'grape'] },
  { char: '🍑', keywords: ['peach'] },
  { char: '🍒', keywords: ['cherry', 'cherries'] },
  { char: '🥝', keywords: ['kiwi'] },
  { char: '🥑', keywords: ['avocado'] },
  { char: '🌶️', keywords: ['pepper', 'chili', 'hot', 'spicy'] },
  { char: '🍄', keywords: ['mushroom', 'fungus'] },
  { char: '🥕', keywords: ['carrot'] },
  { char: '🌽', keywords: ['corn', 'maize'] },
  { char: '🍔', keywords: ['burger', 'hamburger'] },
  { char: '🍕', keywords: ['pizza'] },
  { char: '🍩', keywords: ['donut', 'doughnut'] },
  { char: '🍰', keywords: ['cake', 'slice'] },
  { char: '🍓', keywords: ['strawberry', 'berry'] },
  { char: '🍌', keywords: ['banana'] },
  { char: '🍉', keywords: ['watermelon', 'melon'] },
  { char: '🍍', keywords: ['pineapple'] },
  { char: '🥥', keywords: ['coconut'] },
  { char: '🥨', keywords: ['pretzel'] },
  { char: '🧀', keywords: ['cheese'] },
  { char: '🍦', keywords: ['icecream', 'ice', 'cream', 'soft', 'serve'] },
  { char: '🍭', keywords: ['lollipop', 'candy', 'sweet'] },
  { char: '🍫', keywords: ['chocolate', 'choc'] },
  { char: '🫐', keywords: ['blueberry', 'berries'] },
  { char: '🥐', keywords: ['croissant'] },
  // Objects & instruments.
  { char: '🔑', keywords: ['key', 'unlock'] },
  { char: '🔔', keywords: ['bell', 'ring'] },
  { char: '🎈', keywords: ['balloon', 'party'] },
  { char: '🎁', keywords: ['gift', 'present', 'box'] },
  { char: '🎯', keywords: ['target', 'dart', 'bullseye', 'aim'] },
  { char: '🎲', keywords: ['dice', 'die', 'random', 'roll'] },
  { char: '🧩', keywords: ['puzzle', 'jigsaw', 'piece'] },
  { char: '🪁', keywords: ['kite'] },
  { char: '🔨', keywords: ['hammer', 'tool', 'build'] },
  { char: '🧲', keywords: ['magnet', 'magnetism', 'attract'] },
  { char: '🕯️', keywords: ['candle', 'flame', 'wax'] },
  { char: '🔦', keywords: ['flashlight', 'torch', 'light'] },
  { char: '🎸', keywords: ['guitar', 'rock', 'strings'] },
  { char: '🎹', keywords: ['piano', 'keyboard', 'keys'] },
  { char: '🎺', keywords: ['trumpet', 'brass', 'horn'] },
  { char: '🥁', keywords: ['drum', 'drums', 'beat', 'percussion'] },
  { char: '🎻', keywords: ['violin', 'fiddle', 'strings'] },
  { char: '🎤', keywords: ['microphone', 'mic', 'sing', 'vocal'] },
  { char: '🎧', keywords: ['headphones', 'audio', 'listen'] },
  { char: '🚀', keywords: ['rocket', 'launch', 'space'] },
  { char: '⏰', keywords: ['clock', 'alarm', 'time', 'tempo'] },
  { char: '📎', keywords: ['clip', 'paperclip'] },
  { char: '✏️', keywords: ['pencil', 'write', 'edit'] },
  { char: '📌', keywords: ['pin', 'pushpin', 'mark'] },
  { char: '🔮', keywords: ['crystal', 'ball', 'magic', 'fortune'] },
  { char: '🪀', keywords: ['yoyo', 'toy'] },
  { char: '🎳', keywords: ['bowling', 'strike'] },
  { char: '🧪', keywords: ['test', 'tube', 'lab', 'experiment', 'science'] },
  { char: '🪘', keywords: ['conga', 'drum', 'percussion'] },
  // Nature & weather.
  { char: '⚡', keywords: ['lightning', 'bolt', 'electric', 'zap', 'energy'] },
  { char: '🔥', keywords: ['fire', 'flame', 'hot', 'lit'] },
  { char: '❄️', keywords: ['snowflake', 'snow', 'cold', 'ice', 'winter'] },
  { char: '🌈', keywords: ['rainbow', 'color', 'pride'] },
  { char: '🌙', keywords: ['moon', 'crescent', 'night'] },
  { char: '⭐', keywords: ['star', 'favorite'] },
  { char: '🍀', keywords: ['clover', 'luck', 'lucky', 'four'] },
  { char: '🌵', keywords: ['cactus', 'desert'] },
  { char: '🌸', keywords: ['blossom', 'flower', 'cherry', 'sakura', 'pink'] },
  { char: '🌊', keywords: ['wave', 'water', 'ocean', 'sea'] },
  { char: '🌻', keywords: ['sunflower', 'flower', 'sun'] },
  { char: '🌴', keywords: ['palm', 'tree', 'tropical', 'beach'] },
  { char: '🍁', keywords: ['maple', 'leaf', 'autumn', 'fall'] },
  { char: '🌷', keywords: ['tulip', 'flower', 'spring'] },
  { char: '🌲', keywords: ['tree', 'evergreen', 'pine', 'forest'] },
  { char: '🌰', keywords: ['chestnut', 'nut', 'acorn'] },
  { char: '🐚', keywords: ['shell', 'seashell', 'spiral'] },
  { char: '☄️', keywords: ['comet', 'meteor', 'space'] },
  // Shapes & symbols — very high contrast small.
  { char: '🔺', keywords: ['triangle', 'red', 'up'] },
  { char: '🔻', keywords: ['triangle', 'down', 'red'] },
  { char: '🟦', keywords: ['blue', 'square', 'box'] },
  { char: '🟩', keywords: ['green', 'square', 'box'] },
  { char: '🟨', keywords: ['yellow', 'square', 'box'] },
  { char: '🟧', keywords: ['orange', 'square', 'box'] },
  { char: '🟫', keywords: ['brown', 'square', 'box'] },
  { char: '💎', keywords: ['gem', 'diamond', 'jewel', 'crystal'] },
  { char: '🎵', keywords: ['music', 'note', 'melody', 'tune'] },
  { char: '🎨', keywords: ['palette', 'art', 'paint', 'color'] },
  { char: '❤️', keywords: ['heart', 'red', 'love'] },
  { char: '💙', keywords: ['heart', 'blue'] },
  { char: '💚', keywords: ['heart', 'green'] },
  { char: '💛', keywords: ['heart', 'yellow'] },
  { char: '🧡', keywords: ['heart', 'orange'] },
  { char: '💜', keywords: ['heart', 'purple'] },
  { char: '🖤', keywords: ['heart', 'black', 'dark'] },
  { char: '🟠', keywords: ['orange', 'circle', 'dot'] },
] as const;

/** Every glyph currently in the pool (for de-duping / collision checks). */
export const POOL_CHARS: readonly string[] = EMOJI_POOL.map((e) => e.char);

/**
 * Keyword/substring search over the curated pool. Ranks whole-keyword matches
 * (`cat` === `cat`) above prefix matches (`cat` starts `catfish`) above looser
 * substring hits, so the most obvious glyph surfaces first. An empty query returns the
 * whole pool (the picker's default grid). Pure — no dependency, no network.
 */
export function searchEmoji(query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...EMOJI_POOL];
  const scored: Array<{ e: EmojiEntry; score: number }> = [];
  for (const e of EMOJI_POOL) {
    let best = 0;
    for (const k of e.keywords) {
      if (k === q) best = Math.max(best, 3);
      else if (k.startsWith(q)) best = Math.max(best, 2);
      else if (k.includes(q)) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ e, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.e);
}

/** The confident name-based match for a label (a whole- or prefix-keyword hit), or
 *  null when nothing in the pool clearly matches. Used to prefer a meaningful emoji
 *  over a random one when a tag is created (e.g. a "cat" tag -> the cat). */
export function suggestEmojiForLabel(label: string): string | null {
  const q = normalizeForSuggest(label);
  if (!q) return null;
  for (const e of EMOJI_POOL) {
    if (e.keywords.some((k) => k === q)) return e.char;
  }
  for (const e of EMOJI_POOL) {
    // A single-token label that prefixes a keyword (or vice-versa) still counts as
    // confident (e.g. "cats" -> "cat"); multi-word labels fall through to random.
    if (e.keywords.some((k) => k.startsWith(q) || q.startsWith(k))) return e.char;
  }
  return null;
}

/** First word, lowercased alpha-only — the token a name-based suggestion matches on. */
function normalizeForSuggest(label: string): string {
  return (label.trim().toLowerCase().match(/[a-z]+/) ?? [''])[0];
}

/**
 * Auto-assign an emoji for a brand-new tag: prefer a confident name match
 * ({@link suggestEmojiForLabel}); otherwise pick a random glyph from the pool minus
 * those already `used`, so a fresh set of tags stays easy to tell apart. Falls back to
 * a random pool glyph once every one is used (the pool is finite), then to the first
 * glyph if the pool were ever empty. `rng` is injectable so the pick is deterministic
 * under test (dependency injection over a hidden `Math.random`).
 */
export function autoAssignEmoji(
  label: string,
  used: Iterable<string>,
  rng: () => number = Math.random,
): string {
  const usedSet = new Set(used);
  const suggestion = suggestEmojiForLabel(label);
  if (suggestion && !usedSet.has(suggestion)) return suggestion;
  const free = POOL_CHARS.filter((c) => !usedSet.has(c));
  const from = free.length > 0 ? free : POOL_CHARS;
  if (from.length === 0) return '🏷️'; // pool never empty in practice; a safe label glyph
  const i = Math.min(from.length - 1, Math.max(0, Math.floor(rng() * from.length)));
  return from[i];
}
