// Offline test driver only: executes the registered main-agent tools with real UI.
import { mainAgentAction } from '../main-agent-actions.mjs';
export function driveMainAgentTools(pi) {
 if (!process.env.SWARM_TERMINAL_FIXTURE || process.env.PI_OFFLINE !== '1') throw new Error('Offline fixture required');
 const tools = new Map();
 const api = Object.create(pi);
 api.registerTool = definition => { tools.set(definition.name, definition); pi.registerTool(definition); };
 pi.registerCommand('fixture-swarm', { handler: async (args, ctx) => mainAgentAction(tools, ctx, args,
  update => pi.sendMessage({ customType: 'swarm-agreement', content: update.content[0].text, display: true }, { triggerTurn: false })) });
 return api;
}
