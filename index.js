'use strict';

const util     = require('util');
const authn    = require('./authn');
const aliases  = require('./aliases');
const rcpt_to  = require('./rcpt_to');
const authz    = require('./authz');
const LdapPool = require('./pool').LdapPool;

const AUTH_COMMAND = 'AUTH';
const AUTH_METHOD_PLAIN = 'PLAIN';
const AUTH_METHOD_LOGIN = 'LOGIN';

exports.handle_authn = function (next, connection, params) {
    // we use this as hook so we can ignore auth calls with disabled auth plugin
    // see: auth/auth_base.js, exports.hook_unrecognized_command
    if (!connection.server.notes.ldappool.config.authn) {
        return next();
    }
    const plugin = this;
    if (params[0].toUpperCase() === AUTH_COMMAND && params[1]) {
        return plugin.select_auth_method(next, connection,
            params.slice(1).join(' '));
    }
    if (!connection.notes.authenticating) { return next(); }

    const am = connection.notes.auth_method;
    if (am === AUTH_METHOD_LOGIN) {
        return plugin.auth_login(next, connection, params);
    }
    if (am === AUTH_METHOD_PLAIN) {
        return plugin.auth_plain(next, connection, params);
    }
    return next();
};

exports.hook_capabilities = function (next, connection) {
    // Don't offer AUTH capabilities by default unless session is encrypted
    if (connection.using_tls) {
        const methods = [ 'PLAIN', 'LOGIN' ];
        connection.capabilities.push(`AUTH ${  methods.join(' ')}`);
        connection.notes.allowed_auth_methods = methods;
    }
    next();
};

exports.check_plain_passwd = function () {
    authn.check_plain_passwd.apply(authn, arguments);
};

exports.aliases = function (next, connection, params) {
    if (!connection.server.notes.ldappool.config.aliases) {
        return next();
    }
    aliases.aliases.apply(aliases, arguments);
};

exports.check_rcpt = function (next, connection, params) {
    if (!connection.server.notes.ldappool.config.rcpt_to) {
        return next();
    }
    rcpt_to.check_rcpt.apply(rcpt_to, arguments);
};

exports.check_authz = function (next, connection, params) {
    if (!connection.server.notes.ldappool.config.authz) {
        return next();
    }
    authz.check_authz.apply(authz, arguments);
};

exports.register = function () {
    const plugin = this;
    this.inherits('auth/auth_base');
    plugin.register_hook('init_master',  '_init_ldappool');
    plugin.register_hook('init_child',   '_init_ldappool');
    plugin.register_hook('rcpt', 'aliases');
    plugin.register_hook('rcpt', 'check_rcpt');
    plugin.register_hook('mail', 'check_authz');
    plugin.register_hook('unrecognized_command', 'handle_authn');
    plugin._load_ldap_ini();
};

exports._load_ldap_ini = function () {
    const plugin = this;
    plugin.loginfo("loading ldap.ini");
    const cfg = plugin.config.get('ldap.ini', function () {
        plugin._load_ldap_ini();
    });
    if (plugin._pool) {
        plugin._pool._set_config(cfg);
        plugin.logdebug(`Current config: ${  util.inspect(plugin._pool.config)}`);
    }
    else {
        plugin._tmp_pool_config = cfg;
    }
};

exports._init_ldappool = function (next, server) {
    const plugin = this;
    if (!server.notes.ldappool) {
        server.notes.ldappool = new LdapPool();
        if (plugin._tmp_pool_config) {
            server.notes.ldappool._set_config(plugin._tmp_pool_config);
            plugin._tmp_pool_config = undefined;
            plugin.logdebug(`Current config: ${  util.inspect(server.notes.ldappool.config)}`);
        }
    }
    this._pool = server.notes.ldappool;
    next();
};

exports.shutdown = function (next) {
    const cb = next || function () { };
    if (this._pool) {
        this._pool.close(cb);
    }
};
