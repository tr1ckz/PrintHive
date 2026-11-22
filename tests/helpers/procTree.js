import fs from 'node:fs';

/**
 * Snapshot of the Linux process table from /proc, used to assert that code
 * spawns no child processes and leaves no zombies behind.
 * Each entry: { pid, ppid, state, comm } — state 'Z' is a zombie.
 */
export function listProcesses() {
  const processes = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
    } catch {
      continue; // exited while we were reading
    }
    // "pid (comm) state ppid ..." — comm may itself contain spaces or parens.
    const open = stat.indexOf('(');
    const close = stat.lastIndexOf(')');
    const [state, ppid] = stat.slice(close + 2).split(' ');
    processes.push({
      pid: Number(entry),
      ppid: Number(ppid),
      state,
      comm: stat.slice(open + 1, close),
    });
  }
  return processes;
}

/** All descendants (children, grandchildren, ...) of `rootPid`. */
export function descendantsOf(rootPid, processes = listProcesses()) {
  const found = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const proc of processes) {
      if (proc.ppid === parent) {
        found.push(proc);
        queue.push(proc.pid);
      }
    }
  }
  return found;
}

export function isAlive(pid) {
  return listProcesses().some((proc) => proc.pid === pid && proc.state !== 'Z');
}

export async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 25, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
