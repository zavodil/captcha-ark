# captcha-ark - Token Sale with CAPTCHA Verification

A complete example demonstrating how to use NEAR OutLayer for CAPTCHA verification in token sales, preventing bot purchases while maintaining decentralized execution.

## 🎯 Problem

Token sales on blockchain face a major challenge: **bots can instantly buy all tokens**, leaving real users empty-handed. Traditional CAPTCHA solutions require centralized servers and break the decentralized model.

## 💡 Solution

**OutLayer + CAPTCHA** provides the best of both worlds:
- ✅ **User solves CAPTCHA in their browser** (familiar UX)
- ✅ **Verification happens off-chain** (fast, no gas costs)
- ✅ **Final settlement on NEAR Layer 1** (secure, immutable)
- ✅ **Worker validates via launchpad API** (no centralized trust)

## 📐 Architecture

```
User Browser → Token Sale Contract → OutLayer → CAPTCHA Worker
      ↑                                            ↓
      └──────── Launchpad API (WebSocket) ←───────┘
```

### Flow:

1. **User** visits launchpad website, gets `session_id`
2. **User** calls `buy_tokens(session_id)` on smart contract with NEAR
3. **Contract** calls OutLayer with session_id
4. **OutLayer Worker** (captcha-ark):
   - Makes HTTP POST to launchpad `/api/captcha/challenge`
   - Launchpad sends CAPTCHA to user's browser via WebSocket
   - Worker polls `/api/captcha/verify/{id}` every 500ms
5. **User** sees modal with CAPTCHA, solves it
6. **Launchpad** receives solution, validates, marks challenge as "solved"
7. **Worker** gets verification result, returns to contract
8. **Contract** completes purchase or refunds based on result

## 📦 Components

### 1. WASI Worker (`captcha-ark`)

WASM module that verifies CAPTCHA by communicating with launchpad API.

**Location**: `/src/main.rs`

**Input**:
```json
{
  "session_id": "abc123",
  "buyer": "alice.testnet",
  "amount": "1000000000000000000000000",
  "launchpad_url": "http://localhost:3001"
}
```

**Output (Success)**:
```json
{
  "verified": true,
  "session_id": "abc123",
  "error": null,
  "error_type": null
}
```

**Output (Failure)**:
```json
{
  "verified": false,
  "session_id": "abc123",
  "error": "CAPTCHA verification failed",
  "error_type": "wrong_answer"  // or "timeout", "network_error", "system_error"
}
```

**Error handling**: Worker **immediately returns** on wrong answer or timeout. Contract **automatically refunds** buyer on any failure. See [ERROR_HANDLING.md](ERROR_HANDLING.md) for details.

### 2. Token Sale Contract

Smart contract that integrates OutLayer for CAPTCHA verification.

**Location**: `/token-sale-contract/src/lib.rs`

**Key methods**:
- `buy_tokens(session_id: String)` - Buy tokens with CAPTCHA verification
- `on_captcha_verified()` - Callback to complete/refund purchase
- `get_stats()` - View sale statistics

### 3. Launchpad Backend

Node.js API server that manages CAPTCHA challenges and WebSocket connections.

**Location**: `/launchpad-backend/server.js`

**CAPTCHA Provider**: [hCaptcha](https://www.hcaptcha.com/) - Free, privacy-focused CAPTCHA service

**Endpoints**:
- `GET /api/session` - Get session ID + hCaptcha site key
- `POST /api/captcha/challenge` - Create CAPTCHA challenge
- `GET /api/captcha/verify/:id` - Check challenge status (polled by worker)
- `POST /api/captcha/solve/:id` - Submit hCaptcha token for verification
- `WebSocket /ws?session_id=X` - Real-time communication with browser

**Environment Variables**:
- `HCAPTCHA_SITE_KEY` - Your hCaptcha site key (optional, uses test key by default)
- `HCAPTCHA_SECRET` - Your hCaptcha secret key (optional, uses test key by default)
- `PORT` - Server port (default: 3001)

**Test Mode**: By default, uses hCaptcha test keys that always pass verification. Perfect for development!

### 4. Launchpad Frontend

Single-page application with NEAR Wallet integration and hCaptcha.

**Location**: `/launchpad-frontend/index.html`

**Features**:
- **NEAR Wallet Selector** - MyNearWallet integration via CDN
- **Session management** - Backend session tracking
- **WebSocket connection** - Real-time CAPTCHA delivery
- **hCaptcha widget** - Privacy-focused CAPTCHA in modal
- **Smart contract calls** - Direct transaction signing via wallet
- **Auto-configuration** - Gets contract ID from backend API
- **Network detection** - Works on testnet/mainnet

## 🚀 Quick Start

### Prerequisites

- Rust toolchain with `wasm32-wasip2` target
- Node.js 18+
- NEAR CLI
- hCaptcha account (free at [hcaptcha.com](https://www.hcaptcha.com/))
- Web server with SSL (for production)
- Running OutLayer coordinator

### High-Level Setup

1. **Build WASI Worker** - Compiles to WASM for off-chain CAPTCHA verification
2. **Deploy Smart Contract** - Token sale logic on NEAR blockchain
3. **Start Backend Server** - Handles CAPTCHA challenges and WebSocket
4. **Build & Deploy Frontend** - User interface for token purchase
5. **Configure Networking** - Set up domains and SSL certificates

See [CONFIGURATION.md](CONFIGURATION.md) for detailed setup instructions.

### 1. Build WASI Worker

```bash
cd captcha-ark

# Add WASM target
rustup target add wasm32-wasip2

# Build
cargo build --target wasm32-wasip2 --release

# Output: target/wasm32-wasip2/release/captcha-ark.wasm (~459KB)

# Push to GitHub (worker will be compiled by OutLayer)
git push origin main
```

### 2. Deploy Token Sale Contract

```bash
cd token-sale-contract

# Build contract
cargo near build

# Deploy to testnet with your launchpad backend URL
near contract deploy tokensale.testnet \
  use-file target/near/token_sale_contract/token_sale_contract.wasm \
  with-init-call new \
  json-args '{
    "owner": "your-account.testnet",
    "total_supply": "10000",
    "launchpad_url": "https://api-launchpad.your domain.com"
  }' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send
```

### 3. Configure & Start Backend

```bash
cd launchpad-backend

# Install dependencies (including dotenv)
npm install dotenv

# Create .env file with your hCaptcha keys
cat > .env <<EOF
PORT=3181
HCAPTCHA_SITE_KEY=your_site_key_from_hcaptcha
HCAPTCHA_SECRET=your_secret_from_hcaptcha
ALLOWED_ORIGINS=https://launchpad.yourdomain.com
SESSION_SECRET=$(openssl rand -base64 32)
EOF

# Start server
npm start

# Server runs on http://localhost:3181
# WebSocket available at ws://localhost:3181/ws
```

**Important**: Backend requires `dotenv` package and `import 'dotenv/config';` at the top of `server.js`.

### 4. Build & Deploy Frontend

```bash
cd launchpad-app

# Install dependencies
npm install

# Create .env file
cat > .env <<EOF
REACT_APP_CONTRACT_ID=tokensale.testnet
REACT_APP_NEAR_NETWORK=testnet
REACT_APP_HCAPTCHA_SITE_KEY=your_site_key_from_hcaptcha
EOF

# Build production app
npm run build

# Deploy build/ folder to your web server
# Frontend should be accessible at: https://launchpad.yourdomain.com
```

### 5. Production Deployment

For production deployment, you need:

1. **Two domains with SSL**:
   - `launchpad.yourdomain.com` - Frontend (serves React app)
   - `api-launchpad.yourdomain.com` - Backend (Node.js server + WebSocket)

2. **Web server configuration** (nginx/Apache):
   - Frontend: Serve static files from `launchpad-app/build/`
   - Backend: Reverse proxy to Node.js on port 3181
   - WebSocket: Proxy `/ws` path with Upgrade headers

3. **hCaptcha dashboard**:
   - Add both domains to allowed domains list
   - Copy Site Key and Secret to `.env` files

See [CONFIGURATION.md](CONFIGURATION.md) for complete production setup guide.

## 🧪 Testing the Flow

### Step 1: Open Frontend & Connect Wallet

1. Visit `http://localhost:8000`
2. Click **"Connect Wallet"** button
3. Select MyNearWallet (or other wallet)
4. Sign in with your NEAR account: `alice.testnet`
5. Approve connection
6. See your account displayed in the button

### Step 2: Buy Tokens

1. Enter amount: `1` NEAR
2. Click **"Buy Tokens"** button
3. Wallet popup appears - review transaction:
   - Method: `buy_tokens`
   - Deposit: 1.1 NEAR (1 for tokens + 0.1 for OutLayer)
   - Gas: 300 TGas
4. Click **"Approve"** in wallet
5. Transaction is sent to blockchain

### Step 3: Solve CAPTCHA

1. CAPTCHA modal appears automatically in browser
2. Complete the hCaptcha challenge (checkbox or image selection)
3. Click **"Submit Verification"**
4. Worker verifies CAPTCHA with backend
5. Result sent back to contract

### Step 4: Check Result

```bash
# View transaction result
near tx-status TRANSACTION_HASH --accountId alice.testnet

# Check contract stats
near view tokensale.testnet get_stats
```

## 📊 Example Transaction Flow

```
User: alice.testnet
Action: buy_tokens("abc123")
Deposit: 1.1 NEAR

↓

OutLayer Worker (captcha-ark):
  1. POST /api/captcha/challenge
     {session_id: "abc123", buyer: "alice.testnet", amount: "1000..."}
  2. Poll GET /api/captcha/verify/challenge_xyz
  3. User solves CAPTCHA in browser
  4. Return: {verified: true, session_id: "abc123"}

↓

Contract Callback:
  - CAPTCHA verified ✅
  - Issue 100 tokens to alice.testnet
  - Log success

Result: alice.testnet receives 100 tokens
```

## 🔧 Configuration

### Contract Configuration

Edit `token-sale-contract/src/lib.rs`:

```rust
const OUTLAYER_CONTRACT_ID: &str = "outlayer.testnet";  // or "outlayer.near"
const MIN_PURCHASE: u128 = 1_000_000_000_000_000_000_000_000;  // 1 NEAR
const TOKENS_PER_NEAR: u128 = 100;
```

### Worker Configuration

Update `code_source.repo` in contract to point to your GitHub repo:

```rust
let code_source = near_sdk::serde_json::json!({
    "repo": "https://github.com/YOUR_USERNAME/YOUR_REPO",
    "commit": "main",
    "build_target": "wasm32-wasip2"
});
```

### Backend Configuration

Create `.env` file in `launchpad-backend/`:

```bash
# Optional: Use real hCaptcha keys for production
# Get keys at: https://www.hcaptcha.com/
HCAPTCHA_SITE_KEY=your_site_key_here
HCAPTCHA_SECRET=your_secret_key_here

# Server port
PORT=3001
```

**Test Mode**: If no environment variables are set, the backend uses hCaptcha test keys:
- Site key: `10000000-ffff-ffff-ffff-000000000001` (always shows simple checkbox)
- Secret: `0x0000000000000000000000000000000000000000` (always passes verification)

For production, set `secure: true` in session config (requires HTTPS).

## 📝 Contract Interface

### Buy Tokens

```bash
near call tokensale.testnet buy_tokens \
  '{"session_id":"YOUR_SESSION_ID"}' \
  --accountId buyer.testnet \
  --deposit 1.1 \
  --gas 300000000000000
```

### View Stats

```bash
near view tokensale.testnet get_stats
# Returns: ["0", "10000"]  (tokens_sold, total_supply)
```

### View Price

```bash
near view tokensale.testnet get_price
# Returns: "100 tokens per 1 NEAR"
```

## 🎨 Customization

### Using Real hCaptcha Keys

1. **Sign up** at [https://www.hcaptcha.com/](https://www.hcaptcha.com/)
2. **Create a new site** and get your Site Key and Secret Key
3. **Set environment variables** in `launchpad-backend/.env`:
   ```bash
   HCAPTCHA_SITE_KEY=your_actual_site_key
   HCAPTCHA_SECRET=your_actual_secret_key
   ```
4. **Restart backend** - now uses real hCaptcha with image challenges

### Alternative CAPTCHA Providers

To use reCAPTCHA or other providers, modify:

**Backend** (`launchpad-backend/server.js`):
```javascript
// Replace hCaptcha verification with your provider's API
async function verifyHCaptchaToken(token, remoteip) {
    // Your CAPTCHA provider verification logic
}
```

**Frontend** (`launchpad-frontend/index.html`):
```html
<!-- Replace hCaptcha script with your provider -->
<script src="https://www.google.com/recaptcha/api.js"></script>
```

### Token Distribution Logic

Edit `token-sale-contract/src/lib.rs` → `on_captcha_verified()`:

```rust
// Current: Simple token counter
self.tokens_sold += tokens_amount;

// Add: Token transfer, NFT minting, etc.
// Promise::new(buyer).transfer(tokens);
```

## ⚠️ Security Considerations

### 1. Session Validation

Launchpad backend should validate session IDs properly:

```javascript
// TODO: Add proper session validation
const session = await validateSession(session_id);
if (!session || session.account_id !== buyer) {
    return res.status(401).json({ error: 'Invalid session' });
}
```

### 2. Worker Authentication

**CRITICAL:** Backend must verify that CAPTCHA challenge requests come from authorized OutLayer workers only. Without this, attackers can spam your backend with fake challenge requests.

```javascript
// Example: API key authentication
const WORKER_API_KEY = process.env.WORKER_API_KEY; // Store securely

app.post('/api/captcha/challenge', (req, res) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || apiKey !== WORKER_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Continue with challenge creation...
});
```

**Options for worker authentication:**
1. **API Key:** Shared secret between worker and backend (simplest for MVP)
2. **JWT tokens:** Backend issues short-lived tokens to verified workers
3. **IP Whitelist:** Allow requests only from known worker IPs
4. **Request signing:** Worker signs requests with private key, backend verifies with public key

### 3. Rate Limiting

Add rate limiting to prevent abuse:

```javascript
// TODO: Add rate limiter
const rateLimit = require('express-rate-limit');
app.use('/api/captcha/', rateLimit({
    windowMs: 60000,
    max: 10
}));
```

### 4. Timeout Handling

Worker times out after 40 seconds. Backend cleans up after 60 seconds:

```javascript
// Cleanup interval in server.js
setInterval(() => {
    for (const [id, challenge] of pendingChallenges.entries()) {
        if (now - challenge.created_at > 60000) {
            pendingChallenges.delete(id);
        }
    }
}, 60000);
```

### 5. HTTPS in Production

Use HTTPS for all communication in production:

```javascript
// Update CORS origin
app.use(cors({
    origin: 'https://yourdomain.com',
    credentials: true
}));

// Update WebSocket URL in frontend
ws = new WebSocket(`wss://yourdomain.com/ws?session_id=${sessionId}`);
```

## 🐛 Troubleshooting

### "WebSocket connection failed"

**Solution**: Make sure backend is running on port 3001:
```bash
cd launchpad-backend
npm start
```

### "Challenge not found"

**Problem**: Challenge expired (>40 seconds)

**Solution**: Worker polls for 40s. User must solve CAPTCHA within this time.

### "Execution failed"

**Problem**: Worker couldn't reach launchpad API

**Solution**: Check `launchpad_url` in contract init:
```bash
near view tokensale.testnet get_launchpad_url
```

### "Wrong WASM target"

**Problem**: Built for wrong target

**Solution**: Must use `wasm32-wasip2`:
```bash
cargo build --target wasm32-wasip2 --release
```

## 📚 Learn More

- [WASI Tutorial](../WASI_TUTORIAL.md)
- [OutLayer Documentation](../../README.md)
- [Random Number Example](../random-ark/)
- [NEAR Smart Contracts](https://docs.near.org/develop/contracts/introduction)

## 📄 License

MIT

## 🤝 Contributing

This is a demo example. Feel free to fork and customize for your use case!

---

**Built with ❤️ using NEAR OutLayer**
