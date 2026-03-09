const pino = require('pino');
const { env } = require('../config/env');

const transport = process.env.NODE_ENV === 'production'
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard',
      },
    };

const logger = pino({
  level: env.logLevel,
  transport,
});

module.exports = { logger };
