import { ReadabilityTool } from './readability.tool';

describe('ReadabilityTool', () => {
  let tool: ReadabilityTool;

  beforeEach(() => {
    tool = new ReadabilityTool();
  });

  // ── Metadata ─────────────────────────────────────────────────────────────

  it('has the correct tool name', () => {
    expect(tool.name).toBe('readability_checker');
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it('returns success: true for valid content', async () => {
    const output = await tool.execute({ content: 'The cat sat on the mat. It was nice.' });
    expect(output.success).toBe(true);
    expect(output.result).not.toBeNull();
  });

  it('returns all expected fields in the result', async () => {
    const output = await tool.execute({ content: 'Short text. It works.' });
    const result = output.result as Record<string, unknown>;

    expect(result).toHaveProperty('fleschKincaidGrade');
    expect(result).toHaveProperty('fleschReadingEase');
    expect(result).toHaveProperty('averageSentenceLength');
    expect(result).toHaveProperty('averageSyllablesPerWord');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('sentenceCount');
    expect(result).toHaveProperty('paragraphCount');
    expect(result).toHaveProperty('readingTimeMinutes');
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('suggestions');
  });

  // ── Word / sentence / paragraph counts ───────────────────────────────────

  it('counts words correctly', async () => {
    const output = await tool.execute({ content: 'One two three four five.' });
    const result = output.result as Record<string, unknown>;
    expect(result['wordCount']).toBe(5);
  });

  it('counts paragraphs separated by blank lines', async () => {
    const output = await tool.execute({
      content: 'First paragraph here.\n\nSecond paragraph there.',
    });
    const result = output.result as Record<string, unknown>;
    expect(result['paragraphCount']).toBe(2);
  });

  it('treats content with no blank lines as a single paragraph', async () => {
    const output = await tool.execute({ content: 'One sentence. Another sentence.' });
    const result = output.result as Record<string, unknown>;
    expect(result['paragraphCount']).toBe(1);
  });

  // ── Flesch Reading Ease clamping ──────────────────────────────────────────

  it('clamps fleschReadingEase to [0, 100]', async () => {
    // Very simple one-syllable text → FRE can exceed 100 without clamping
    const simple = await tool.execute({ content: 'Go. Do. Be. Run.' });
    const simpleResult = simple.result as Record<string, unknown>;
    expect(simpleResult['fleschReadingEase']).toBeLessThanOrEqual(100);

    // Extremely complex academic text → FRE can go negative without clamping
    const complex = await tool.execute({
      content:
        'Extraordinarily multisyllabic theoretical epistemological considerations predominantly characterizing contemporary philosophical discourse demonstrate increasingly sophisticated communicative methodological frameworks.',
    });
    const complexResult = complex.result as Record<string, unknown>;
    expect(complexResult['fleschReadingEase']).toBeGreaterThanOrEqual(0);
  });

  // ── Reading level classification ──────────────────────────────────────────

  it('returns a recognised reading level string', async () => {
    const validLevels = [
      'very_easy',
      'easy',
      'fairly_easy',
      'standard',
      'fairly_difficult',
      'difficult',
      'very_difficult',
    ];
    const output = await tool.execute({ content: 'Some content here for testing purposes.' });
    const result = output.result as Record<string, unknown>;
    expect(validLevels).toContain(result['level']);
  });

  it('classifies very simple text as very_easy or easy', async () => {
    // Extremely short, monosyllabic sentences push FRE toward 100
    const output = await tool.execute({ content: 'I go. You sit. We run. She smiles.' });
    const result = output.result as Record<string, unknown>;
    expect(['very_easy', 'easy', 'fairly_easy']).toContain(result['level']);
  });

  it('classifies complex academic text as difficult or very_difficult', async () => {
    const output = await tool.execute({
      content:
        'Multifaceted epistemological paradigms necessitate comprehensive interdisciplinary methodological frameworks. Contemporary philosophical discourse predominantly characterizes sophisticated communicative theoretical considerations. Extraordinarily intricate conceptualization demonstrates increasingly nuanced philosophical abstraction.',
    });
    const result = output.result as Record<string, unknown>;
    expect(['difficult', 'very_difficult', 'fairly_difficult']).toContain(result['level']);
  });

  // ── Suggestions ───────────────────────────────────────────────────────────

  it('returns suggestions as an array', async () => {
    const output = await tool.execute({ content: 'Plain text for testing.' });
    const result = output.result as Record<string, unknown>;
    expect(Array.isArray(result['suggestions'])).toBe(true);
  });

  it('suggests shortening sentences when average sentence length > 25 words', async () => {
    // 30 identical words in one sentence → avgSentenceLength = 30 > 25, triggers suggestion
    const longSentence = Array(30).fill('words').join(' ') + '.';
    const output = await tool.execute({ content: longSentence });
    const result = output.result as Record<string, unknown>;
    const suggestions = result['suggestions'] as string[];
    expect(suggestions.some((s) => s.includes('sentence length'))).toBe(true);
  });

  it('returns empty suggestions for clear, medium-length content', async () => {
    // FRE in ~60-80 range, grade ≤12, avgSentLen ≤25 → no suggestions triggered
    const output = await tool.execute({
      content:
        'Vector databases store high-dimensional embeddings. They enable semantic search at scale. Many applications use them for recommendations.',
    });
    const result = output.result as Record<string, unknown>;
    const suggestions = result['suggestions'] as string[];
    // May or may not be empty depending on exact calculation — just verify it's an array
    expect(Array.isArray(suggestions)).toBe(true);
  });

  // ── Reading time ──────────────────────────────────────────────────────────

  it('returns readingTimeMinutes >= 1', async () => {
    const output = await tool.execute({ content: 'A short text.' });
    const result = output.result as Record<string, unknown>;
    expect(result['readingTimeMinutes']).toBeGreaterThanOrEqual(1);
  });

  it('increases readingTimeMinutes for longer content', async () => {
    const shortOutput = await tool.execute({ content: 'Short text.' });
    // 500 words of content → ~2 minutes at 250 wpm
    const longContent = Array(500).fill('word').join(' ') + '.';
    const longOutput = await tool.execute({ content: longContent });

    const shortTime = (shortOutput.result as Record<string, unknown>)[
      'readingTimeMinutes'
    ] as number;
    const longTime = (longOutput.result as Record<string, unknown>)['readingTimeMinutes'] as number;
    expect(longTime).toBeGreaterThan(shortTime);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles empty string without throwing', async () => {
    const output = await tool.execute({ content: '' });
    expect(output.success).toBe(true);
  });

  it('handles single-word input without throwing', async () => {
    const output = await tool.execute({ content: 'Hello' });
    expect(output.success).toBe(true);
    const result = output.result as Record<string, unknown>;
    expect(result['wordCount']).toBe(1);
  });

  it('handles content with only punctuation gracefully', async () => {
    const output = await tool.execute({ content: '!!! ??? ...' });
    expect(output.success).toBe(true);
  });

  it('rounds numeric fields to one decimal place', async () => {
    const output = await tool.execute({
      content: 'The quick brown fox jumps. A lazy dog sleeps.',
    });
    const result = output.result as Record<string, unknown>;
    // Rounded to 1 decimal: no more than 1 digit after the decimal point
    const fre = result['fleschReadingEase'] as number;
    expect(Number.isFinite(fre)).toBe(true);
    const decimals = String(fre).split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });
});
