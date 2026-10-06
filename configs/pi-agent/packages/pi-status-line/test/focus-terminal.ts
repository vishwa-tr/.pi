import { createFocusBridge as subagents } from '../../pi-subagents/extensions/subagents/tui/focus.ts';
import { createFocusBridge as teams } from '../../pi-teams/extensions/teams/tui/focus.ts';
import { appendFileSync } from 'node:fs';
export default function(pi: any) {
 const bridges: any[] = [];
 pi.on('session_start', (_event: any, ctx: any) => {
  for (const [source, bridge] of [['subagents', subagents], ['teams', teams]] as const) {
   const address = `${source}/reviewer`;
   const core: any = {
    status: async () => [{ address, label: `${source} focus fixture`, state: 'dormant' }],
    onEvent: () => () => {},
    peek: async () => ({ address, label: `${source} focus fixture`, state: 'dormant', sessionFile: null }),
    sendAsUser: async (args: any) => { appendFileSync(process.env.FOCUS_OUTPUT!, JSON.stringify(args)+'\n'); return { delivery: 'queued', disposition: 'held' }; },
   };
   bridges.push(bridge(pi, core, ctx.ui, ctx.cwd));
  }
 });
 pi.on('session_shutdown', () => bridges.forEach(bridge => bridge.dispose()));
 pi.registerCommand('focus-ready', { description: 'Offline terminal fixture', handler: (_args: any, ctx: any) => ctx.ui.notify('FOCUS_READY', 'info') });
}
