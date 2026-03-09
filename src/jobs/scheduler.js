const cron = require('node-cron');
const { cleanupTmpDir, listInboxExcels } = require('../services/fileStore');

function startScheduler({ env, emitEvent, ingestionFlow, reviewFlow }) {
  const tasks = [];
  const jobState = {
    ingest: false,
    review: false,
  };

  function createGuardedJob(jobName, handler) {
    return async () => {
      if (jobState[jobName]) {
        emitEvent('warn', 'JOB_SKIPPED_OVERLAP', `Job omitido por ejecucion en curso: ${jobName}`, { jobName });
        return;
      }

      jobState[jobName] = true;
      try {
        await handler();
      } catch (error) {
        emitEvent('error', 'JOB_FAILED', `Job fallo: ${jobName}`, { jobName, error: error.message });
      } finally {
        jobState[jobName] = false;
      }
    };
  }

  const ingestTask = cron.schedule(env.ingestCron, createGuardedJob('ingest', async () => {
    const existingFiles = listInboxExcels();
    emitEvent('info', 'INGEST_JOB_STARTED', 'Ejecucion automatica de ingesta', {
      inboxFiles: existingFiles.length,
      autoFetch: env.autoFetchPublicExcel,
    });
    await ingestionFlow.runIngestionCycle();
  }));

  const reviewTask = cron.schedule(env.reviewCron, createGuardedJob('review', async () => {
    emitEvent('info', 'REVIEW_JOB_STARTED', 'Ejecucion automatica de revision diaria', {});
    try {
      await reviewFlow.reviewDueProcesses();
    } finally {
      cleanupTmpDir();
    }
  }));

  tasks.push(ingestTask, reviewTask);

  emitEvent('info', 'SCHEDULER_STARTED', 'Scheduler operativo', {
    ingestCron: env.ingestCron,
    reviewCron: env.reviewCron,
  });

  return {
    stop() {
      for (const task of tasks) {
        task.stop();
      }
    },
  };
}

module.exports = { startScheduler };
