const { spawn } = require('child_process');
const server = spawn('npx', ['next', 'dev', '-p', '3000', '-H', '0.0.0.0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  cwd: '/home/z/my-project'
});
server.stdout.on('data', d => process.stdout.write(d));
server.stderr.on('data', d => process.stderr.write(d));
server.on('exit', () => {
  console.log('Server exited, restarting...');
  setTimeout(() => process.exit(42), 1000);
});
// Keep this process alive
setInterval(() => {}, 60000);
