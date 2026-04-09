'use strict';

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.log.level,
  ...(config.log.pretty && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '[{module}] {msg}',
      },
    },
  }),
  base: {
    service: 'lejerli-server',
    env: config.env,
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  redact: {
    paths: ['req.headers.authorization', 'passwordHash', 'password', '*.secret', '*.token'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
