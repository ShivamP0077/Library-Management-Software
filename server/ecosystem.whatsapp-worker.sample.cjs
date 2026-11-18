/**
 * Sample only. Do not load this in production until the process split is approved.
 * The API should set WHATSAPP_JOBS_IN_WORKER=true so these jobs are not also in-process.
 */
module.exports = {
  apps: [
    {
      name: 'lms-whatsapp-worker',
      script: 'src/whatsapp-worker.js',
      cwd: __dirname,
      env: {
        WHATSAPP_JOBS_IN_WORKER: 'true',
      },
    },
  ],
};
