// Security Manager for Heyming OS
class SecurityManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.users = new Map();
    this.groups = new Map();
    this.capabilities = new Map();
    this.securityPolicies = new Map();
    this.auditLog = [];

    // Security levels
    this.SECURITY_LEVELS = {
      NONE: 0,
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      PARANOID: 4
    };

    this.currentSecurityLevel = this.SECURITY_LEVELS.MEDIUM;

    // Capabilities (Linux-style)
    this.CAPABILITIES = {
      CAP_CHOWN: 0,
      CAP_DAC_OVERRIDE: 1,
      CAP_DAC_READ_SEARCH: 2,
      CAP_FOWNER: 3,
      CAP_FSETID: 4,
      CAP_KILL: 5,
      CAP_SETGID: 6,
      CAP_SETUID: 7,
      CAP_SETPCAP: 8,
      CAP_LINUX_IMMUTABLE: 9,
      CAP_NET_BIND_SERVICE: 10,
      CAP_NET_BROADCAST: 11,
      CAP_NET_ADMIN: 12,
      CAP_NET_RAW: 13,
      CAP_IPC_LOCK: 14,
      CAP_IPC_OWNER: 15,
      CAP_SYS_MODULE: 16,
      CAP_SYS_RAWIO: 17,
      CAP_SYS_CHROOT: 18,
      CAP_SYS_PTRACE: 19,
      CAP_SYS_PACCT: 20,
      CAP_SYS_ADMIN: 21,
      CAP_SYS_BOOT: 22,
      CAP_SYS_NICE: 23,
      CAP_SYS_RESOURCE: 24,
      CAP_SYS_TIME: 25,
      CAP_SYS_TTY_CONFIG: 26,
      CAP_MKNOD: 27,
      CAP_LEASE: 28,
      CAP_AUDIT_WRITE: 29,
      CAP_AUDIT_CONTROL: 30,
      CAP_SETFCAP: 31
    };
  }

  async initialize() {
    this.kernel.log('Security Manager initializing');

    // Create default users and groups
    await this.createDefaultUsers();
    await this.createDefaultGroups();

    // Initialize security policies
    this.initializeSecurityPolicies();

    // Set up audit logging
    this.setupAuditLogging();
  }

  async createDefaultUsers() {
    // Root user
    this.users.set(0, {
      uid: 0,
      username: 'root',
      gid: 0,
      home: '/root',
      shell: '/bin/jsh',
      capabilities: new Set(Object.values(this.CAPABILITIES)),
      passwordHash: null, // No password for demo
      locked: false,
      lastLogin: null,
      loginAttempts: 0
    });

    // Default user
    const defaultUser = window.parent?.HeymingOS?.Config?.USER || 'jheyming';
    const defaultHome = window.parent?.HeymingOS?.Config?.HOME || '/home/jheyming';
    this.users.set(1000, {
      uid: 1000,
      username: defaultUser,
      gid: 1000,
      home: defaultHome,
      shell: '/bin/jsh',
      capabilities: new Set([this.CAPABILITIES.CAP_DAC_READ_SEARCH, this.CAPABILITIES.CAP_FOWNER]),
      passwordHash: null,
      locked: false,
      lastLogin: null,
      loginAttempts: 0
    });

    // System users
    this.users.set(1, {
      uid: 1,
      username: 'daemon',
      gid: 1,
      home: '/',
      shell: '/bin/false',
      capabilities: new Set(),
      passwordHash: null,
      locked: true,
      lastLogin: null,
      loginAttempts: 0
    });

    this.kernel.log('Default users created');
  }

  async createDefaultGroups() {
    const defaultUser = window.parent?.HeymingOS?.Config?.USER || 'jheyming';

    // Root group
    this.groups.set(0, {
      gid: 0,
      groupname: 'root',
      members: new Set([0])
    });

    // User group
    this.groups.set(1000, {
      gid: 1000,
      groupname: defaultUser,
      members: new Set([1000])
    });

    // System groups
    this.groups.set(1, {
      gid: 1,
      groupname: 'daemon',
      members: new Set([1])
    });

    this.groups.set(100, {
      gid: 100,
      groupname: 'users',
      members: new Set([1000])
    });

    this.groups.set(27, {
      gid: 27,
      groupname: 'sudo',
      members: new Set([1000])
    });

    this.kernel.log('Default groups created');
  }

  initializeSecurityPolicies() {
    // File access policy
    this.securityPolicies.set('file_access', {
      enforcePermissions: true,
      allowSetuid: false,
      allowSetgid: false,
      restrictedPaths: new Set(['/etc', '/boot', '/sys']),
      executablePaths: new Set(['/bin', '/usr/bin', '/usr/local/bin'])
    });

    // Network policy
    this.securityPolicies.set('network', {
      allowOutbound: true,
      allowInbound: false,
      restrictedPorts: new Set([22, 23, 25, 53, 80, 443]),
      requireCapabilityForPrivilegedPorts: true
    });

    // Process policy
    this.securityPolicies.set('process', {
      maxProcessesPerUser: 100,
      allowFork: true,
      allowExec: true,
      restrictedExecutables: new Set(['/bin/su', '/bin/sudo']),
      requireCapabilityForKill: true
    });

    // Resource policy
    this.securityPolicies.set('resource', {
      maxMemoryPerProcess: 100 * 1024 * 1024, // 100MB
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxOpenFiles: 1024,
      maxCpuTime: 60000 // 60 seconds
    });

    this.kernel.log('Security policies initialized');
  }

  setupAuditLogging() {
    // Listen for security-relevant events
    this.kernel.on('process:created', (process) => {
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'process_create',
        uid: process.uid,
        pid: process.pid,
        executable: process.executable,
        success: true
      });
    });

    this.kernel.on('file:access', (data) => {
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'file_access',
        uid: data.uid,
        path: data.path,
        operation: data.operation,
        success: data.success
      });
    });

    // Keep audit log size manageable
    setInterval(() => {
      if (this.auditLog.length > 10000) {
        this.auditLog = this.auditLog.slice(-5000);
      }
    }, 60000);
  }

  // Authentication
  async authenticate(username, password) {
    const user = Array.from(this.users.values()).find((u) => u.username === username);

    if (!user) {
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'login_attempt',
        username: username,
        success: false,
        reason: 'user_not_found'
      });
      return null;
    }

    if (user.locked) {
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'login_attempt',
        username: username,
        uid: user.uid,
        success: false,
        reason: 'account_locked'
      });
      return null;
    }

    // For demo purposes, allow login without password
    if (!password && !user.passwordHash) {
      user.lastLogin = Date.now();
      user.loginAttempts = 0;

      this.auditLog.push({
        timestamp: Date.now(),
        event: 'login_success',
        username: username,
        uid: user.uid,
        success: true
      });

      return user;
    }

    // In a real system, verify password hash
    if (user.passwordHash && this.verifyPassword(password, user.passwordHash)) {
      user.lastLogin = Date.now();
      user.loginAttempts = 0;

      this.auditLog.push({
        timestamp: Date.now(),
        event: 'login_success',
        username: username,
        uid: user.uid,
        success: true
      });

      return user;
    }

    // Failed login
    user.loginAttempts++;
    if (user.loginAttempts >= 5) {
      user.locked = true;
    }

    this.auditLog.push({
      timestamp: Date.now(),
      event: 'login_failure',
      username: username,
      uid: user.uid,
      success: false,
      reason: 'invalid_password',
      attempts: user.loginAttempts
    });

    return null;
  }

  // Authorization checks
  checkPermission(operation, resource, process) {
    if (!process) {
      return false;
    }

    const user = this.users.get(process.uid);
    if (!user) {
      return false;
    }

    // Root can do anything
    if (process.uid === 0) {
      return true;
    }

    // Check specific operation permissions
    switch (operation) {
      case 'file_read':
        return this.checkFilePermission(resource, 'read', process);
      case 'file_write':
        return this.checkFilePermission(resource, 'write', process);
      case 'file_execute':
        return this.checkFilePermission(resource, 'execute', process);
      case 'process_kill':
        return this.checkProcessKillPermission(resource, process);
      case 'network_bind':
        return this.checkNetworkBindPermission(resource, process);
      case 'capability':
        return user.capabilities.has(resource);
      default:
        return false;
    }
  }

  checkFilePermission(path, operation, process) {
    const policy = this.securityPolicies.get('file_access');

    // Check if path is restricted
    for (const restrictedPath of policy.restrictedPaths) {
      if (path.startsWith(restrictedPath) && process.uid !== 0) {
        return false;
      }
    }

    // For execute operations, check if path is in executable directories
    if (operation === 'execute') {
      let inExecutablePath = false;
      for (const execPath of policy.executablePaths) {
        if (path.startsWith(execPath)) {
          inExecutablePath = true;
          break;
        }
      }
      if (!inExecutablePath && process.uid !== 0) {
        return false;
      }
    }

    // Additional checks would go here (file ownership, mode bits, etc.)
    return true;
  }

  checkProcessKillPermission(targetPid, process) {
    const policy = this.securityPolicies.get('process');
    const targetProcess = this.kernel.processManager.getProcess(targetPid);

    if (!targetProcess) {
      return false;
    }

    // Can kill own processes
    if (targetProcess.uid === process.uid) {
      return true;
    }

    // Need CAP_KILL capability to kill other processes
    const user = this.users.get(process.uid);
    return user && user.capabilities.has(this.CAPABILITIES.CAP_KILL);
  }

  checkNetworkBindPermission(port, process) {
    const policy = this.securityPolicies.get('network');

    // Privileged ports (< 1024) require CAP_NET_BIND_SERVICE
    if (port < 1024 && policy.requireCapabilityForPrivilegedPorts) {
      const user = this.users.get(process.uid);
      return user && user.capabilities.has(this.CAPABILITIES.CAP_NET_BIND_SERVICE);
    }

    // Check if port is restricted
    if (policy.restrictedPorts.has(port) && process.uid !== 0) {
      return false;
    }

    return true;
  }

  // Resource limits
  checkResourceLimit(resource, amount, process) {
    const policy = this.securityPolicies.get('resource');
    const user = this.users.get(process.uid);

    if (!user || process.uid === 0) {
      return true; // Root has no limits
    }

    switch (resource) {
      case 'memory':
        return amount <= policy.maxMemoryPerProcess;
      case 'file_size':
        return amount <= policy.maxFileSize;
      case 'open_files':
        return amount <= policy.maxOpenFiles;
      case 'cpu_time':
        return amount <= policy.maxCpuTime;
      case 'processes':
        const userProcesses = this.kernel.processManager
          .getAllProcesses()
          .filter((p) => p.uid === process.uid).length;
        return userProcesses < policy.maxProcessesPerUser;
      default:
        return true;
    }
  }

  // Capability management
  grantCapability(uid, capability) {
    const user = this.users.get(uid);
    if (user) {
      user.capabilities.add(capability);
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'capability_granted',
        uid: uid,
        capability: capability,
        success: true
      });
    }
  }

  revokeCapability(uid, capability) {
    const user = this.users.get(uid);
    if (user) {
      user.capabilities.delete(capability);
      this.auditLog.push({
        timestamp: Date.now(),
        event: 'capability_revoked',
        uid: uid,
        capability: capability,
        success: true
      });
    }
  }

  // User management
  createUser(username, uid, gid, home, shell) {
    if (this.users.has(uid)) {
      throw new Error(`User ID ${uid} already exists`);
    }

    const user = {
      uid: uid,
      username: username,
      gid: gid,
      home: home,
      shell: shell,
      capabilities: new Set(),
      passwordHash: null,
      locked: false,
      lastLogin: null,
      loginAttempts: 0
    };

    this.users.set(uid, user);

    this.auditLog.push({
      timestamp: Date.now(),
      event: 'user_created',
      uid: uid,
      username: username,
      success: true
    });

    return user;
  }

  deleteUser(uid) {
    const user = this.users.get(uid);
    if (!user) {
      throw new Error(`User ID ${uid} not found`);
    }

    if (uid === 0) {
      throw new Error('Cannot delete root user');
    }

    this.users.delete(uid);

    this.auditLog.push({
      timestamp: Date.now(),
      event: 'user_deleted',
      uid: uid,
      username: user.username,
      success: true
    });
  }

  // Group management
  createGroup(groupname, gid) {
    if (this.groups.has(gid)) {
      throw new Error(`Group ID ${gid} already exists`);
    }

    const group = {
      gid: gid,
      groupname: groupname,
      members: new Set()
    };

    this.groups.set(gid, group);
    return group;
  }

  addUserToGroup(uid, gid) {
    const group = this.groups.get(gid);
    if (!group) {
      throw new Error(`Group ID ${gid} not found`);
    }

    group.members.add(uid);
  }

  removeUserFromGroup(uid, gid) {
    const group = this.groups.get(gid);
    if (group) {
      group.members.delete(uid);
    }
  }

  // Security level management
  setSecurityLevel(level) {
    if (!Object.values(this.SECURITY_LEVELS).includes(level)) {
      throw new Error('Invalid security level');
    }

    this.currentSecurityLevel = level;

    // Adjust policies based on security level
    this.adjustPoliciesForSecurityLevel(level);

    this.auditLog.push({
      timestamp: Date.now(),
      event: 'security_level_changed',
      level: level,
      success: true
    });
  }

  adjustPoliciesForSecurityLevel(level) {
    const filePolicy = this.securityPolicies.get('file_access');
    const processPolicy = this.securityPolicies.get('process');
    const resourcePolicy = this.securityPolicies.get('resource');

    switch (level) {
      case this.SECURITY_LEVELS.NONE:
        filePolicy.enforcePermissions = false;
        processPolicy.allowFork = true;
        processPolicy.allowExec = true;
        break;

      case this.SECURITY_LEVELS.LOW:
        filePolicy.enforcePermissions = true;
        processPolicy.allowFork = true;
        processPolicy.allowExec = true;
        resourcePolicy.maxProcessesPerUser = 200;
        break;

      case this.SECURITY_LEVELS.MEDIUM:
        filePolicy.enforcePermissions = true;
        processPolicy.allowFork = true;
        processPolicy.allowExec = true;
        resourcePolicy.maxProcessesPerUser = 100;
        break;

      case this.SECURITY_LEVELS.HIGH:
        filePolicy.enforcePermissions = true;
        filePolicy.allowSetuid = false;
        processPolicy.allowFork = true;
        processPolicy.allowExec = true;
        resourcePolicy.maxProcessesPerUser = 50;
        break;

      case this.SECURITY_LEVELS.PARANOID:
        filePolicy.enforcePermissions = true;
        filePolicy.allowSetuid = false;
        filePolicy.allowSetgid = false;
        processPolicy.allowFork = false;
        processPolicy.allowExec = false;
        resourcePolicy.maxProcessesPerUser = 10;
        break;
    }
  }

  // Utility methods
  verifyPassword(password, hash) {
    // In a real system, use proper password hashing (bcrypt, scrypt, etc.)
    // For demo, just compare directly
    return password === hash;
  }

  hashPassword(password) {
    // In a real system, use proper password hashing
    // For demo, return the password as-is
    return password;
  }

  getUserByName(username) {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }

  getGroupByName(groupname) {
    return Array.from(this.groups.values()).find((g) => g.groupname === groupname);
  }

  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  // Get security statistics
  getSecurityStats() {
    return {
      securityLevel: this.currentSecurityLevel,
      userCount: this.users.size,
      groupCount: this.groups.size,
      auditLogSize: this.auditLog.length,
      lockedUsers: Array.from(this.users.values()).filter((u) => u.locked).length,
      recentFailedLogins: this.auditLog.filter(
        (entry) => entry.event === 'login_failure' && Date.now() - entry.timestamp < 3600000 // Last hour
      ).length
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SecurityManager };
} else if (typeof window !== 'undefined') {
  window.SecurityManager = SecurityManager;
}
