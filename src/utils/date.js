function nowIso() {
  return new Date().toISOString();
}

function addDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addHours(dateInput, hours) {
  const date = new Date(dateInput);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function isFuture(dateInput) {
  if (!dateInput) {
    return false;
  }

  return new Date(dateInput).getTime() > Date.now();
}

function toDisplayDate(dateInput) {
  if (!dateInput) {
    return null;
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

module.exports = {
  addDays,
  addHours,
  isFuture,
  nowIso,
  toDisplayDate,
};
