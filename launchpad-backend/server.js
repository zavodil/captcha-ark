import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import fetch from 'node-fetch';
import fs from 'fs';

// Debug logging to file
const DEBUG_LOG = '/tmp/captcha-backend-debug.log';
function debugLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(DEBUG_LOG, logMessage);
}

const app = express();
const PORT = process.env.PORT || 3181;

// NEAR contract configuration
const TOKEN_SALE_CONTRACT_ID = process.env.TOKEN_SALE_CONTRACT_ID || 'capturedlaunchpad.testnet';
const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';

// hCaptcha configuration
// Get your keys at: https://www.hcaptcha.com/
const HCAPTCHA_SITE_KEY = process.env.HCAPTCHA_SITE_KEY || '10000000-ffff-ffff-ffff-000000000001'; // Test key
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || '0x0000000000000000000000000000000000000000'; // Test secret
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

// Allowed origins for CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:8000', 'https://launchpad.nearspace.info'];

// Middleware
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.indexOf(origin) !== -1 || ALLOWED_ORIGINS.includes('*')) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(null, true); // Allow in dev mode, set to false in production
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'captcha-ark-secret-key-change-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true with HTTPS
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// In-memory storage
const pendingChallenges = new Map();
const wsConnections = new Map(); // session_id -> WebSocket

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    // Extract session ID from query
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session_id');

    if (!sessionId) {
        ws.close(1008, 'Session ID required');
        return;
    }

    console.log(`WebSocket connected: ${sessionId}`);
    wsConnections.set(sessionId, ws);

    ws.on('close', () => {
        console.log(`WebSocket disconnected: ${sessionId}`);
        wsConnections.delete(sessionId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${sessionId}:`, error);
    });
});

// Verify hCaptcha token with hCaptcha API
async function verifyHCaptchaToken(token, remoteip) {
    try {
        debugLog(`🔍 Verifying hCaptcha token (length: ${token ? token.length : 0})`);
        debugLog(`   Using secret: ${HCAPTCHA_SECRET.substring(0, 10)}...`);
        debugLog(`   Remote IP: ${remoteip || 'not provided'}`);

        const response = await fetch(HCAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                secret: HCAPTCHA_SECRET,
                response: token,
                remoteip: remoteip || ''
            })
        });

        const data = await response.json();
        debugLog(`📊 hCaptcha response: ${JSON.stringify(data)}`);

        if (!data.success) {
            debugLog(`❌ hCaptcha failed. Error codes: ${JSON.stringify(data['error-codes'])}`);
        }

        return data.success === true;
    } catch (error) {
        debugLog(`❌ hCaptcha verification error: ${error.message}`);
        return false;
    }
}


// API: Create CAPTCHA challenge
app.post('/api/captcha/challenge', (req, res) => {
    const { session_id, buyer, amount, transaction_hash } = req.body;

    if (!session_id) {
        return res.status(400).json({ error: 'session_id is required' });
    }

    // Create challenge
    const challenge_id = uuidv4();

    const challenge = {
        session_id,
        buyer,
        amount,
        transaction_hash,
        status: 'pending',
        verified: false,
        created_at: Date.now()
    };

    pendingChallenges.set(challenge_id, challenge);

    console.log(`📝 hCaptcha challenge created: ${challenge_id} for session ${session_id}`);
    console.log(`   Buyer: ${buyer}, Amount: ${amount}, TX: ${transaction_hash || 'unknown'}`);

    // Send to user's browser via WebSocket
    const ws = wsConnections.get(session_id);
    if (ws && ws.readyState === ws.OPEN) {
        // Format amount for display (convert from yoctoNEAR string to NEAR)
        const amountInNear = amount ? (parseFloat(amount) / 1e24).toFixed(4) : '0';

        ws.send(JSON.stringify({
            type: 'captcha_challenge',
            challenge_id,
            buyer,
            amount: amountInNear,
            amount_yocto: amount,
            transaction_hash: transaction_hash || 'unknown',
            captcha_type: 'hcaptcha',
            site_key: HCAPTCHA_SITE_KEY
        }));
        console.log(`   ✅ Sent to WebSocket (amount: ${amountInNear} NEAR, tx: ${transaction_hash})`);
    } else {
        console.log(`   ⚠️  No WebSocket connection for session ${session_id}`);
    }

    res.json({ challenge_id });
});

// API: Long-polling for worker - wait for challenge result
app.get('/api/captcha/wait/:challenge_id', (req, res) => {
    const { challenge_id } = req.params;
    const timeout = parseInt(req.query.timeout) || 60; // Default 60 seconds
    const maxTimeout = Math.min(timeout, 120); // Max 120 seconds

    const challenge = pendingChallenges.get(challenge_id);

    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    const startTime = Date.now();
    const checkInterval = 500; // Check every 500ms

    const checkStatus = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        const challengeAge = (Date.now() - challenge.created_at) / 1000;

        // Check if challenge was solved
        if (challenge.status === 'solved') {
            console.log(`✅ Worker received result for ${challenge_id}: verified=${challenge.verified}`);
            pendingChallenges.delete(challenge_id);
            return res.json({
                status: 'solved',
                verified: challenge.verified
            });
        }

        // Check if challenge timed out (60 seconds from creation)
        if (challengeAge > 60) {
            pendingChallenges.delete(challenge_id);
            return res.json({
                status: 'timeout',
                verified: false
            });
        }

        // Check if long-polling timed out
        if (elapsed >= maxTimeout) {
            return res.json({
                status: 'pending',
                verified: false
            });
        }

        // Continue polling
        setTimeout(checkStatus, checkInterval);
    };

    checkStatus();
});

// API: Submit hCaptcha token (from user's browser)
app.post('/api/captcha/solve/:challenge_id', async (req, res) => {
    const { challenge_id } = req.params;
    const { hcaptcha_token } = req.body;

    const challenge = pendingChallenges.get(challenge_id);

    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    if (challenge.status !== 'pending') {
        return res.status(400).json({ error: 'Challenge already solved' });
    }

    // Verify hCaptcha token with hCaptcha API
    const remoteip = req.ip || req.connection.remoteAddress;
    const verified = await verifyHCaptchaToken(hcaptcha_token, remoteip);

    challenge.status = 'solved';
    challenge.verified = verified;

    console.log(`✅ hCaptcha challenge ${challenge_id} solved: ${verified ? 'PASS ✓' : 'FAIL ✗'}`);

    res.json({ verified });
});

// API: Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        active_challenges: pendingChallenges.size,
        active_connections: wsConnections.size,
        hcaptcha_configured: HCAPTCHA_SITE_KEY !== '10000000-ffff-ffff-ffff-000000000001'
    });
});

// Cleanup old challenges every 60 seconds
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, challenge] of pendingChallenges.entries()) {
        if (now - challenge.created_at > 60000) { // 60 seconds
            pendingChallenges.delete(id);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} old challenges`);
    }
}, 60000);

// Start server
server.listen(PORT, () => {
    console.log(`\n🚀 Launchpad Backend API running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server running on ws://localhost:${PORT}/ws`);
    console.log(`\n🔐 hCaptcha Configuration:`);
    console.log(`   Site Key: ${HCAPTCHA_SITE_KEY}`);
    console.log(`   Mode: ${HCAPTCHA_SITE_KEY === '10000000-ffff-ffff-ffff-000000000001' ? 'TEST MODE (always passes)' : 'PRODUCTION'}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /api/session                        - Get session ID + hCaptcha site key`);
    console.log(`  POST /api/captcha/challenge              - Create challenge`);
    console.log(`  GET  /api/captcha/verify/:challenge_id   - Check status (worker polls)`);
    console.log(`  POST /api/captcha/solve/:challenge_id    - Submit hCaptcha token`);
    console.log(`  GET  /health                             - Health check`);
    console.log(``);
    console.log(`💡 To use real hCaptcha, set environment variables:`);
    console.log(`   HCAPTCHA_SITE_KEY=your_site_key`);
    console.log(`   HCAPTCHA_SECRET=your_secret_key`);
    console.log(`   Get keys at: https://www.hcaptcha.com/\n`);
});
