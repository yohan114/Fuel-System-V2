// PM2 process definition for the fuel system.
//
//     cd <the checkout>
//     sudo -u fuelapp PM2_HOME=/home/fuelapp/.pm2 \
//       /opt/node-24/bin/npx pm2 start deploy/ecosystem.config.js
//
// PM2 IS SAFE HERE ONLY BECAUSE OF THE ISOLATION. PM2 keeps all of its state —
// the daemon socket, the logs, and dump.pm2, the list it replays on boot — in
// $PM2_HOME, one daemon per home. `pm2 save` does not merge into dump.pm2, it
// overwrites it with whatever the daemon shows at that instant. So if this app
// shared a PM2_HOME with WorkshopOne, every fuel deploy would rewrite
// WorkshopOne's boot list, and anything stopped at that moment would simply not
// come back after the next reboot — with nothing logged anywhere.
//
// It does not share one. This app runs as `fuelapp` with PM2_HOME pinned to
// /home/fuelapp/.pm2, and `pm2 startup -u fuelapp` installs pm2-fuelapp.service,
// which cannot collide with pm2-root.service or WorkshopOne's own unit.
// deploy/start-app.sh checks that separation before it touches anything and
// refuses if the homes have converged.
//
// Never run this app's pm2 commands as root, and never without PM2_HOME set —
// both land you back in a shared home.

// Where the checkout actually is, derived from this file rather than declared.
// It used to be the literal "/var/www/fuelsystem", which silently broke a deploy
// to any other path: PM2 sets cwd BEFORE it runs anything, so a wrong value here
// does not fail loudly — Next starts in a directory with no .next and no
// node_modules and the error names the module, not the directory.
//
// APP_DIR still wins when it is set, so the value stays consistent with
// start-app.sh, which takes the same override.
const path = require("path");
const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, "..");
const NODE_PREFIX = process.env.NODE_PREFIX || "/opt/node-24";
const APP_USER = process.env.APP_USER || "fuelapp";
const PORT = process.env.PORT || "3300";

module.exports = {
  apps: [
    {
      name: "fuelsystem",
      cwd: APP_DIR,

      // The PRIVATE Node, by absolute path. /usr/bin/node belongs to whatever
      // else runs on this box; better-sqlite3 here is compiled against 24 and
      // resolving a different one at boot is how you get "Module did not
      // self-register" a week after the deploy that caused it.
      interpreter: `${NODE_PREFIX}/bin/node`,
      script: "node_modules/next/dist/bin/next",
      // -H 127.0.0.1 binds to loopback. Without it the app is reachable
      // directly on :3300 from the internet, bypassing nginx, Cloudflare and
      // every header this deployment depends on.
      args: `start -H 127.0.0.1 -p ${PORT}`,

      // One instance, deliberately. src/instrumentation.ts starts the Ceypetco
      // price scheduler and the 5-minute WorkshopOne poller once per process,
      // so a second instance would run both twice.
      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
        // Billing derives day keys from local time in several places. On a UTC
        // host every Colombo day boundary shifts 5.5 hours and fuel issued
        // after 18:30 lands in the wrong invoice month. Set per-process so the
        // machine's own clock is left alone for WorkshopOne.
        TZ: "Asia/Colombo",
        PORT: String(PORT),
        PATH: `${NODE_PREFIX}/bin:/usr/local/bin:/usr/bin:/bin`,
      },

      // Two Node apps and two SQLite databases on one small VM. A runaway here
      // gets killed rather than taking the machine — and WorkshopOne — with it.
      max_memory_restart: "1500M",

      // A crash loop should give up rather than hammer a shared box.
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,

      out_file: `/home/${APP_USER}/.pm2/logs/fuelsystem-out.log`,
      error_file: `/home/${APP_USER}/.pm2/logs/fuelsystem-error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
