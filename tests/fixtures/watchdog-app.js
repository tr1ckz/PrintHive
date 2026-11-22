// Stand-in for simple-server.js in the watchdog tests. Appends one line per
// lifecycle event to APP_LOG so the test can follow starts and signals.
// APP_MODE=ignore-term simulates a hung app that never exits on SIGTERM.
const fs = require('fs');

const log = (line) => fs.appendFileSync(process.env.APP_LOG, `${line}\n`);

log(`start ${process.pid}`);

process.on('SIGTERM', () => {
  log(`sigterm ${process.pid}`);
  if (process.env.APP_MODE !== 'ignore-term') process.exit(0);
});

setInterval(() => {}, 1000);
