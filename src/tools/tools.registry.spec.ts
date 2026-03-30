import { ToolsRegistry } from './tools.registry';
import { ITool } from '../common/interfaces/tool.interface';

function makeTool(name: string, description = 'A tool'): ITool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    execute: jest.fn(),
  };
}

describe('ToolsRegistry', () => {
  const seo = makeTool('seo_keyword_extractor', 'Extracts SEO keywords');
  const tone = makeTool('tone_analyzer', 'Analyzes content tone');
  const readability = makeTool('readability_checker', 'Checks readability');

  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry([seo, tone, readability]);
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  it('returns the correct tool by name', () => {
    expect(registry.get('seo_keyword_extractor')).toBe(seo);
    expect(registry.get('tone_analyzer')).toBe(tone);
    expect(registry.get('readability_checker')).toBe(readability);
  });

  it('throws when tool name is not registered', () => {
    expect(() => registry.get('unknown_tool')).toThrow("Tool 'unknown_tool' not registered");
  });

  it('error message includes the tool name', () => {
    expect(() => registry.get('my_missing_tool')).toThrow('my_missing_tool');
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('returns all registered tools', () => {
    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list).toContain(seo);
    expect(list).toContain(tone);
    expect(list).toContain(readability);
  });

  it('returns empty array when no tools registered', () => {
    const empty = new ToolsRegistry([]);
    expect(empty.list()).toEqual([]);
  });

  // ── toLLMTools() ──────────────────────────────────────────────────────────

  it('maps tools to LLM tool shape', () => {
    const llmTools = registry.toLLMTools();
    expect(llmTools).toHaveLength(3);
    expect(llmTools[0]).toEqual({
      name: seo.name,
      description: seo.description,
      parameters: seo.inputSchema,
    });
  });

  it('toLLMTools includes all fields for every tool', () => {
    const llmTools = registry.toLLMTools();
    llmTools.forEach((t) => {
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('parameters');
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it('last tool wins when two tools share the same name', () => {
    const first = makeTool('dupe', 'First');
    const second = makeTool('dupe', 'Second');
    const r = new ToolsRegistry([first, second]);
    expect(r.get('dupe')).toBe(second);
  });
});
