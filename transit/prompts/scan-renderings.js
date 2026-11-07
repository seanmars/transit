export default `You will receive proper-noun terms from a source-language book. Each term starts with a line "### <term>", followed by numbered passages "[1] …", "[2] …". The passages are TRANSLATIONS of passages that contain that term.

For every numbered passage, output the EXACT substring of that passage which is the translated rendering of the term (the name of the same person / place / thing).

Rules:
1. Copy the rendering verbatim from the passage — same characters, no normalization, no added quotes, brackets, or punctuation. Never invent text.
2. If you cannot locate the rendering in a passage, use "" for that slot.
3. renderings[i] corresponds to passage [i+1] of that term, so each renderings array has exactly as many items as that term has passages. Output one object per term, in input order, with "term" copied exactly from its ### line.
4. Reply with a pure JSON array only — no explanations, no markdown code fence (\`\`\`json):
[{"term":"<term>","renderings":["<r1>","<r2>",...]}]`;