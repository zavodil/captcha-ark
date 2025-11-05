# Configuration Guide - CAPTCHA-ARK

## 🔧 How Components Discover Each Other

### Architecture Overview:

```
┌────────────────────────────────────────────────────────────┐
│  Token Sale Contract (tokensale.testnet)                   │
│  ├─ Stores: launchpad_url                                  │
│  │  Passed during initialization via new()                 │
│  │  Used by worker to verify CAPTCHA                       │
│  └─ Constant: OUTLAYER_CONTRACT_ID = "outlayer.testnet"    │
└────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Launchpad Backend (server.js on port 3181)                 │
│  ├─ Handles CAPTCHA challenges from worker                  │
│  ├─ WebSocket connection with frontend                      │
│  └─ Verifies hCaptcha tokens with hCaptcha API              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────┐
│  Launchpad Frontend (React app)                            │
│  ├─ ENV: REACT_APP_CONTRACT_ID from .env                   │
│  ├─ ENV: REACT_APP_HCAPTCHA_SITE_KEY from .env             │
│  └─ Connects to backend via WebSocket                      │
└────────────────────────────────────────────────────────────┘
```

### Configuration Flow:

1. **During contract deployment**, specify `launchpad_url`:
   ```bash
   near contract deploy tokensale.testnet \
     with-init-call new \
     json-args '{
       "owner": "alice.testnet",
       "total_supply": "10000",
       "launchpad_url": "https://api-launchpad.nearspace.info"
     }'
   ```

2. **Backend .env** configuration:
   ```bash
   PORT=3181
   HCAPTCHA_SITE_KEY=
   HCAPTCHA_SECRET=
   ALLOWED_ORIGINS=https://launchpad.nearspace.info
   ```

3. **Frontend .env** configuration:
   ```bash
   REACT_APP_CONTRACT_ID=tokensale.testnet
   REACT_APP_NEAR_NETWORK=testnet
   REACT_APP_HCAPTCHA_SITE_KEY=
   ```

4. **User flow**:
   - User connects wallet on frontend
   - Clicks "Buy Tokens" → transaction sent
   - Worker creates CAPTCHA challenge → sent via WebSocket
   - User solves CAPTCHA → frontend submits to backend
   - Backend verifies with hCaptcha API → returns to worker
   - Worker submits result to contract → transaction completes

## 📝 Environment Variables

### Backend (.env)

```bash
# Server Configuration
PORT=3181
NODE_ENV=production

# hCaptcha Configuration (REQUIRED)
# Get your keys at: https://dashboard.hcaptcha.com/
HCAPTCHA_SITE_KEY=
HCAPTCHA_SECRET=

# CORS Configuration
# Comma-separated list of allowed origins
ALLOWED_ORIGINS=https://launchpad.nearspace.info

# Session Configuration
SESSION_SECRET=change-this-to-a-random-string-in-production
```

**Important**: You must add `dotenv` package and import it:
```javascript
import 'dotenv/config';  // First line in server.js
```

### Frontend (.env)

```bash
# NEAR Contract Configuration
REACT_APP_CONTRACT_ID=tokensale.testnet
REACT_APP_NEAR_NETWORK=testnet

# hCaptcha Configuration (same site key as backend)
REACT_APP_HCAPTCHA_SITE_KEY=
```

### Contract (lib.rs)

```rust
// Hardcoded constants
const OUTLAYER_CONTRACT_ID: &str = "outlayer.testnet";  // or "outlayer.near"
const MIN_PURCHASE: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR
const TOKENS_PER_NEAR: u128 = 100;

// Dynamic parameters from new()
struct TokenSaleContract {
    owner: AccountId,
    total_supply: u128,
    launchpad_url: String,  // Passed during initialization
}
```

## 🔄 How to Change Configuration

### Change Token Sale Contract

```bash
# 1. Update frontend .env
nano /path/to/launchpad-app/.env
# Change REACT_APP_CONTRACT_ID=your-new-contract.testnet

# 2. Rebuild frontend
npm run build

# 3. Deploy to server
```

### Switch from Testnet to Mainnet

**Contract:**
```rust
const OUTLAYER_CONTRACT_ID: &str = "outlayer.near";
```

**Frontend .env:**
```bash
REACT_APP_CONTRACT_ID=tokensale.near
REACT_APP_NEAR_NETWORK=mainnet
```

**Deploy contract:**
```bash
near contract deploy tokensale.near \
  with-init-call new \
  json-args '{
    "owner":"yourproject.near",
    "total_supply":"1000000",
    "launchpad_url":"https://api-launchpad.yourproject.com"
  }'
```

### Update Launchpad URL

**Option 1: Redeploy contract** with new `launchpad_url`

**Option 2: Add update method to contract:**
```rust
pub fn update_launchpad_url(&mut self, new_url: String) {
    assert_eq!(env::predecessor_account_id(), self.owner, "Only owner");
    self.launchpad_url = new_url;
}
```

## ✅ Configuration Checklist

### Backend Setup

- [ ] Created `.env` file with all required variables
- [ ] Added `dotenv` package: `npm install dotenv`
- [ ] Added `import 'dotenv/config';` as first line in `server.js`
- [ ] Got hCaptcha keys from https://dashboard.hcaptcha.com/
- [ ] Added domains to hCaptcha dashboard: `launchpad.nearspace.info`, `api-launchpad.nearspace.info`
- [ ] Verified backend starts without errors: `npm start`

### Frontend Setup

- [ ] Created `.env` file with contract ID and network
- [ ] Set same `REACT_APP_HCAPTCHA_SITE_KEY` as in backend
- [ ] Built production app: `npm run build`
- [ ] Verified build folder exists: `launchpad-app/build/`

### Contract Setup

- [ ] Updated `OUTLAYER_CONTRACT_ID` constant
- [ ] Set correct `MIN_PURCHASE` and `TOKENS_PER_NEAR`
- [ ] Built contract: `cargo near build`
- [ ] Deployed with correct `launchpad_url` parameter

### Networking Setup

- [ ] Frontend accessible at `https://launchpad.nearspace.info`
- [ ] Backend accessible at `https://api-launchpad.nearspace.info`
- [ ] WebSocket accessible at `wss://api-launchpad.nearspace.info/ws`
- [ ] CORS configured (backend only, not nginx)
- [ ] SSL certificates installed for both domains

## 🔍 Verification

### Test Backend is Working

```bash
curl https://api-launchpad.nearspace.info/health
# Should return: OK
```

### Test hCaptcha Configuration

```bash
# Check backend logs when user solves CAPTCHA
# Should see:
# 🔍 Verifying hCaptcha token (length: 1898)
#    Using secret: ES_9b0fb9c...
# 📊 hCaptcha response: {"success":true}
```

### Test Frontend Connection

Open browser console on `https://launchpad.nearspace.info`:
```
WebSocket connected for session: sess_abc123...
```

### Test Complete Flow

1. Connect wallet
2. Click "Buy Tokens (Total: 0.11 NEAR)"
3. Approve transaction in wallet
4. See "Transaction sent! Waiting for CAPTCHA challenge..."
5. CAPTCHA modal appears
6. Solve CAPTCHA
7. See "✅ CAPTCHA verified! Waiting for blockchain confirmation..."
8. After 5 seconds: "✅ Token purchase completed successfully!"

## 🚨 Common Issues

### ❌ Backend shows "Using secret: 0x00000000..."

**Cause**: `dotenv` not installed or not imported

**Solution**:
```bash
npm install dotenv
```

Add to top of `server.js`:
```javascript
import 'dotenv/config';
```

### ❌ CAPTCHA always fails with error codes

**Cause**: Wrong secret key or domain not added to hCaptcha dashboard

**Solution**:
1. Check dashboard shows your Enterprise Secret (starts with `ES_`)
2. Add domains: `launchpad.nearspace.info` and `api-launchpad.nearspace.info`
3. Restart backend: `pm2 restart launchpad-backend`

### ❌ CORS error: "multiple values"

**Cause**: Both nginx and Express adding CORS headers

**Solution**: Remove CORS from nginx config, let Express handle it:
```nginx
location /api/ {
    proxy_pass http://launchpad_backend;
    # CORS is handled by Express backend - don't add headers here
}
```

### ❌ WebSocket connection failed

**Cause**: Wrong WebSocket URL or nginx not configured

**Solution**:
- Frontend should use: `wss://api-launchpad.nearspace.info/ws`
- Nginx should proxy `/ws` with `Upgrade` headers

### ❌ Frontend shows wrong contract ID

**Cause**: `.env` not loaded or wrong path

**Solution**:
```bash
# Check .env exists in launchpad-app/
ls -la /path/to/launchpad-app/.env

# Rebuild app
npm run build
```

## 📚 Example Configurations

### Development (localhost)

**Backend .env**:
```bash
PORT=3181
NODE_ENV=development
HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
HCAPTCHA_SECRET=0x0000000000000000000000000000000000000000
ALLOWED_ORIGINS=http://localhost:3000
SESSION_SECRET=dev-secret
```

**Frontend .env**:
```bash
REACT_APP_CONTRACT_ID=tokensale.testnet
REACT_APP_NEAR_NETWORK=testnet
REACT_APP_HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
```

**Contract init**:
```bash
near contract deploy tokensale.testnet \
  with-init-call new \
  json-args '{
    "owner":"alice.testnet",
    "total_supply":"10000",
    "launchpad_url":"http://localhost:3181"
  }'
```

### Production (mainnet)

**Backend .env**:
```bash
PORT=3181
NODE_ENV=production
HCAPTCHA_SITE_KEY=your_real_site_key
HCAPTCHA_SECRET=ES_your_real_secret
ALLOWED_ORIGINS=https://launchpad.yourproject.com
SESSION_SECRET=super-secret-random-string-here
```

**Frontend .env**:
```bash
REACT_APP_CONTRACT_ID=tokensale.near
REACT_APP_NEAR_NETWORK=mainnet
REACT_APP_HCAPTCHA_SITE_KEY=your_real_site_key
```

**Contract init**:
```bash
near contract deploy tokensale.near \
  with-init-call new \
  json-args '{
    "owner":"yourproject.near",
    "total_supply":"1000000",
    "launchpad_url":"https://api-launchpad.yourproject.com"
  }'
```

## 🔐 Security Best Practices

1. **Never hardcode** production URLs in code
2. **Always use** environment variables
3. **Verify** ALLOWED_ORIGINS in production
4. **Use HTTPS** for all production endpoints
5. **Change** SESSION_SECRET to a random string
6. **Keep** HCAPTCHA_SECRET secure (never commit to git)
7. **Add** `.env` to `.gitignore`
8. **Use** real hCaptcha keys in production (not test keys)

## 📝 Quick Reference

| Component | Config Location | Key Variables |
|-----------|----------------|---------------|
| Backend | `launchpad-backend/.env` | `HCAPTCHA_SECRET`, `ALLOWED_ORIGINS` |
| Frontend | `launchpad-app/.env` | `REACT_APP_CONTRACT_ID`, `REACT_APP_HCAPTCHA_SITE_KEY` |
| Contract | `token-sale-contract/src/lib.rs` | `OUTLAYER_CONTRACT_ID`, `MIN_PURCHASE` |
| Worker | Built WASM in `target/wasm32-wasip2/release/` | N/A (reads from contract) |

## 🆘 Getting Help

If you encounter issues:

1. Check backend logs: `cat /tmp/captcha-backend-debug.log`
2. Check browser console (F12) for frontend errors
3. Verify hCaptcha dashboard settings
4. Test with curl commands from this guide
5. Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`
