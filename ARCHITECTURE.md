# CAPTCHA-ARK Architecture

## Overview

This example demonstrates a complete CAPTCHA verification system for token sales using NEAR OutLayer.

## Components

```
captcha-ark/
├── src/main.rs                    # WASI Worker (Rust)
├── token-sale-contract/           # Smart Contract (Rust)
│   └── src/lib.rs
├── launchpad-backend/             # API Server (Node.js)
│   ├── package.json
│   └── server.js
├── launchpad-frontend/            # Web UI (HTML/JS)
│   └── index.html
└── README.md                      # Full documentation
```

## Data Flow

### 1. User Initiates Purchase

```
User Browser
    ↓ (connect WebSocket)
Launchpad Backend
    ↓ (get session_id)
User Browser
    ↓ (call buy_tokens with session_id)
Token Sale Contract
```

### 2. Contract Calls OutLayer

```
Token Sale Contract
    ↓ (request_execution with session_id)
OutLayer Contract
    ↓ (emit event)
OutLayer Worker
    ↓ (compile captcha-ark from GitHub)
WASM Executor
```

### 3. Worker Verifies CAPTCHA

```
WASM Executor (captcha-ark)
    ↓ (POST /api/captcha/challenge)
Launchpad Backend
    ↓ (WebSocket push)
User Browser (shows modal)
    ↓ (user solves CAPTCHA)
Launchpad Backend (POST /api/captcha/solve)
    ↓ (worker polls GET /api/captcha/verify)
WASM Executor
    ↓ (return {verified: true})
OutLayer Worker
```

### 4. Contract Completes Purchase

```
OutLayer Worker
    ↓ (resolve_execution)
OutLayer Contract
    ↓ (callback)
Token Sale Contract (on_captcha_verified)
    ↓ (if verified: issue tokens, else: refund)
User receives tokens ✅
```

## Key Design Decisions

### Why WebSocket?

Worker polls launchpad API every 500ms, but launchpad needs to send CAPTCHA to browser instantly. WebSocket provides real-time push notification.

**Alternative**: Long-polling from browser, but WebSocket is more efficient.

### Why Not Just CAPTCHA in Contract?

Smart contracts can't:
- Show UI to users
- Wait for user input
- Make HTTP requests

OutLayer enables all of these off-chain while maintaining on-chain settlement.

### Why Session ID?

Links browser session to blockchain transaction. Worker uses session_id to:
1. Ask launchpad to show CAPTCHA to correct user
2. Poll for that specific user's response

### Security Model

1. **Session validation**: Launchpad validates session_id belongs to buyer
2. **Timeout**: Worker times out after 40 seconds if no response
3. **Single-use**: Each challenge_id used once
4. **Layer 1 settlement**: Final state change happens on NEAR blockchain

## Message Formats

### Worker Input (from contract)

```json
{
  "session_id": "abc123def456",
  "buyer": "alice.testnet",
  "amount": "1000000000000000000000000",
  "launchpad_url": "https://launchpad.io"
}
```

### Challenge Request (worker → launchpad)

```json
POST /api/captcha/challenge
{
  "session_id": "abc123def456",
  "buyer": "alice.testnet",
  "amount": "1000000000000000000000000"
}
```

### Challenge Response (launchpad → worker)

```json
{
  "challenge_id": "xyz789"
}
```

### WebSocket Push (launchpad → browser)

```json
{
  "type": "captcha_challenge",
  "challenge_id": "xyz789",
  "buyer": "alice.testnet",
  "amount": "1000000000000000000000000",
  "captcha_question": "5 + 3 = ?"
}
```

### Solution Submit (browser → launchpad)

```json
POST /api/captcha/solve/xyz789
{
  "solution": "8"
}
```

### Verify Poll (worker → launchpad)

```json
GET /api/captcha/verify/xyz789

Response:
{
  "status": "solved",  // or "pending", "timeout"
  "verified": true
}
```

### Worker Output (to contract)

```json
{
  "verified": true,
  "session_id": "abc123def456",
  "error": null
}
```

## Timing

- **Challenge creation**: ~50ms
- **User solves CAPTCHA**: 5-20 seconds (human time)
- **Worker polling interval**: 500ms
- **Worker timeout**: 40 seconds
- **Challenge cleanup**: 60 seconds

## Failure Modes

### 1. User doesn't solve CAPTCHA

- Worker polls for 40 seconds
- Times out, returns `verified: false`
- Contract refunds buyer

### 2. WebSocket disconnected

- User can't see CAPTCHA
- Worker times out
- Contract refunds buyer

### 3. Launchpad API down

- Worker can't create challenge
- Returns error immediately
- Contract refunds buyer

### 4. Wrong answer

- Launchpad marks challenge as `verified: false`
- Worker returns immediately
- Contract refunds buyer

## Scalability

### Current (MVP)

- Single launchpad server
- In-memory challenge storage
- ~100 concurrent users

### Production Ready

- Multiple launchpad servers behind load balancer
- Redis for shared challenge storage
- ~10,000+ concurrent users
- Add rate limiting per session/IP

## Future Improvements

1. **Multiple CAPTCHA types**: hCaptcha, reCAPTCHA, image recognition
2. **Difficulty levels**: Harder CAPTCHAs for larger purchases
3. **Bot detection**: Track solve times, patterns
4. **Fallback**: If launchpad down, use alternative verification
5. **Analytics**: Track success rates, bot attempts

## Testing Checklist

- [ ] User completes CAPTCHA correctly → tokens issued
- [ ] User enters wrong answer → refund
- [ ] User doesn't respond (timeout) → refund
- [ ] WebSocket disconnected → refund
- [ ] Launchpad API down → refund
- [ ] Multiple concurrent users → all work independently
- [ ] Challenge expired → new challenge required

---

**Note**: This is a demo example. Prod requirements: HTTPS, proper session management, database storage, monitoring, rate limiting.
