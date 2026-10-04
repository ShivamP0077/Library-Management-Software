import open from 'open';
open('http://localhost:3000', { app: { name: 'google chrome', arguments: ['--user-data-dir=' + process.cwd() + '/scratch/chrome_test_profile'] } });
