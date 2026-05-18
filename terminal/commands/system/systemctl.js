// systemctl — minimal driver for HeymingOS.services.
//
// Subcommands (subset):
//   status [UNIT]            show units (or one)
//   list-units [--all]       same as status
//   start UNIT               start a previously-registered service
//   stop UNIT                stop a running service
//   restart UNIT             stop then start
//   is-active UNIT           exit 0 if active, 3 otherwise
//   enable / disable UNIT    informational no-op (no boot config in jsh)
//
// jsh: services are JS modules registered via window.heymingOS.services.

const SYSTEMCTL_HELP = `Usage: systemctl [OPTIONS] COMMAND [UNIT]
Control HeymingOS services.

Commands:
  status [UNIT]      show all units (or just UNIT)
  list-units [--all] list registered units
  start UNIT         start a registered service
  stop UNIT          stop a running service
  restart UNIT       stop, then start
  is-active UNIT     exit 0 when active, 3 otherwise
  enable / disable   informational only (no boot-config in jsh)
  help               show this help

jsh: not a real systemd; works against HeymingOS.services + ServiceClass
registry. There is no enable-at-boot semantics.
`;

function getOs() {
  if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).heymingOS) {
    return /** @type {any} */ (globalThis).heymingOS;
  }
  if (typeof window !== 'undefined' && /** @type {any} */ (window).heymingOS) {
    return /** @type {any} */ (window).heymingOS;
  }
  return null;
}

function formatStatus(name, info) {
  const lines = [];
  const state = info ? 'active (running)' : 'inactive (dead)';
  lines.push(`● ${name}.service - HeymingOS service "${name}"`);
  lines.push(`     Loaded: loaded (HeymingOS.services)`);
  lines.push(`     Active: ${state}`);
  if (info) {
    const started = info.started ? new Date(info.started).toISOString() : 'unknown';
    const uptimeSec = info.started ? Math.floor((Date.now() - info.started) / 1000) : 0;
    lines.push(`   Main PID: ${info.process?.pid != null ? info.process.pid : '-'}`);
    lines.push(`     Started: ${started} (${uptimeSec}s ago)`);
  }
  return lines.join('\n') + '\n';
}

async function systemctlHandler(terminal, args) {
  if (!args.length || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    return { stdout: SYSTEMCTL_HELP, stderr: '', exitCode: 0 };
  }
  const sub = args[0];
  const rest = args.slice(1);
  const os = getOs() || terminal.os;
  if (!os || !os.services) {
    return { stdout: '', stderr: 'systemctl: HeymingOS not initialized\n', exitCode: 1 };
  }
  switch (sub) {
    case 'status': {
      if (rest.length === 0) {
        const all = typeof os.listServices === 'function' ? os.listServices() : [];
        if (all.length === 0) return { stdout: 'No services running\n', stderr: '', exitCode: 0 };
        return { stdout: all.map((s) => `${s.name}: pid ${s.pid}, up ${Math.floor((Date.now() - s.started) / 1000)}s`).join('\n') + '\n', stderr: '', exitCode: 0 };
      }
      const unit = rest[0].replace(/\.service$/, '');
      const info = os.services.get(unit);
      return { stdout: formatStatus(unit, info), stderr: '', exitCode: info ? 0 : 3 };
    }
    case 'list-units': {
      const all = typeof os.listServices === 'function' ? os.listServices() : [];
      if (all.length === 0) return { stdout: 'No services running\n', stderr: '', exitCode: 0 };
      const header = 'UNIT                  ACTIVE  PID  UPTIME';
      const rows = all.map(
        (s) =>
          `${s.name.padEnd(22)}active  ${String(s.pid).padEnd(5)} ${Math.floor((Date.now() - s.started) / 1000)}s`
      );
      return { stdout: header + '\n' + rows.join('\n') + '\n', stderr: '', exitCode: 0 };
    }
    case 'start': {
      if (!rest.length) return { stdout: '', stderr: 'systemctl: start requires a UNIT\n', exitCode: 2 };
      const unit = rest[0].replace(/\.service$/, '');
      const registry = os.serviceRegistry || {};
      const ServiceClass = registry[unit];
      if (!ServiceClass) {
        return {
          stdout: '',
          stderr: `Failed to start ${unit}.service: Unit not found (register in heymingOS.serviceRegistry).\n`,
          exitCode: 5
        };
      }
      try {
        await os.startService(unit, ServiceClass);
      } catch (e) {
        return { stdout: '', stderr: `systemctl: ${e.message}\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    case 'stop': {
      if (!rest.length) return { stdout: '', stderr: 'systemctl: stop requires a UNIT\n', exitCode: 2 };
      const unit = rest[0].replace(/\.service$/, '');
      try {
        await os.stopService(unit);
      } catch (e) {
        return { stdout: '', stderr: `systemctl: ${e.message}\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    case 'restart': {
      if (!rest.length) return { stdout: '', stderr: 'systemctl: restart requires a UNIT\n', exitCode: 2 };
      const unit = rest[0].replace(/\.service$/, '');
      try {
        if (os.services.has(unit)) await os.stopService(unit);
        const registry = os.serviceRegistry || {};
        const ServiceClass = registry[unit];
        if (!ServiceClass) {
          return { stdout: '', stderr: `Failed to restart ${unit}.service: Unit not found.\n`, exitCode: 5 };
        }
        await os.startService(unit, ServiceClass);
      } catch (e) {
        return { stdout: '', stderr: `systemctl: ${e.message}\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    case 'is-active': {
      if (!rest.length) return { stdout: '', stderr: 'systemctl: is-active requires a UNIT\n', exitCode: 2 };
      const unit = rest[0].replace(/\.service$/, '');
      const info = os.services.get(unit);
      return { stdout: (info ? 'active' : 'inactive') + '\n', stderr: '', exitCode: info ? 0 : 3 };
    }
    case 'enable':
    case 'disable':
      return {
        stdout: `${sub} is a no-op in jsh (no boot-config). The unit must already be registered.\n`,
        stderr: '',
        exitCode: 0
      };
    default:
      return {
        stdout: '',
        stderr: `systemctl: unknown subcommand '${sub}'\n${SYSTEMCTL_HELP}`,
        exitCode: 2
      };
  }
}

export default {
  name: 'systemctl',
  handler: systemctlHandler,
  description: 'control HeymingOS services (status/list-units/start/stop/restart/is-active)',
  category: 'System'
};
