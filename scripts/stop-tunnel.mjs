// Ends the background Cloudflare tunnel (it normally keeps running between server restarts so the address stays the same).
// Run with:  npm run stop-tunnel
process.env.TUNNEL = 'off';
const { stopTunnel } = await import('../server/tunnel.js');
console.log(stopTunnel() ? 'Tunnel stopped. The next server start opens a new one with a new address.' : 'No tunnel was running.');
