const { EventEmitter } = require('events');

function createSseBus() {
  const emitter = new EventEmitter();
  const recent = [];
  const maxRecent = 100;

  function publish(event) {
    recent.push(event);
    if (recent.length > maxRecent) {
      recent.shift();
    }
    emitter.emit('event', event);
  }

  return {
    publish,
    subscribe(listener) {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
    getRecent() {
      return [...recent];
    },
  };
}

module.exports = { createSseBus };
