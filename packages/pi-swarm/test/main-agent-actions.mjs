/** Test driver for the production main-agent tools (never a production slash alias). */
export async function mainAgentAction(tools, ctx, text, update = () => {}) {
 const [action = 'view', ...parts] = text.trim().split(/\s+/);
 const rest = text.trimStart().replace(/^\S+\s*/, '');
 let name = 'swarm_control'; let args = { action };
 if (action === 'start') { name = 'swarm_start'; args = { objective: rest }; }
 else if (action === 'status') { name = 'swarm_status'; args = {}; }
 else if (!action || action === 'dashboard') args = { action: 'view' };
 else if (action === 'restore' || action === 'reconcile') args = { action, ...(parts[0] ? { runId: parts[0] } : {}) };
 const result = await tools.get(name).execute('main-agent-fixture', args, undefined, update, ctx);
 if (result.isError) throw new Error(result.details.error);
 return result.details;
}
