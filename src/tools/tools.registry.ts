import { Injectable, Inject } from '@nestjs/common';
import { ITool, TOOLS_TOKEN } from '../common/interfaces/tool.interface';

@Injectable()
export class ToolsRegistry {
  private readonly registry: Map<string, ITool>;

  constructor(@Inject(TOOLS_TOKEN) tools: ITool[]) {
    this.registry = new Map(tools.map((t) => [t.name, t]));
  }

  get(name: string): ITool {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Tool '${name}' not registered`);
    return tool;
  }

  list(): ITool[] {
    return Array.from(this.registry.values());
  }

  toLLMTools() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }
}
