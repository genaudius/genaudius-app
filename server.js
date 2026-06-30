// server.js (Entry point for Hostinger Node.js App)
// This file simply imports the compiled SvelteKit server.
// Hostinger's Passenger will automatically pass the PORT environment variable.

import('./build/index.js').catch((err) => {
    console.error('Error starting server:', err);
    process.exit(1);
});
