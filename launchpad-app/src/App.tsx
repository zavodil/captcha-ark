import React, { useEffect, useState, useCallback } from 'react';
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupModal } from '@near-wallet-selector/modal-ui';
import type { WalletSelector, AccountState } from '@near-wallet-selector/core';
import { transactions } from 'near-api-js';
import '@near-wallet-selector/modal-ui/styles.css';
import './App.css';

declare global {
  interface Window {
    hcaptcha: any;
  }
}

interface SessionData {
  session_id: string;
  hcaptcha_site_key: string;
  contract_id: string;
  network: string;
}

// Generate random session ID
const generateSessionId = () => {
  return 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

function App() {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(generateSessionId());
  const contractId = process.env.REACT_APP_CONTRACT_ID || 'tokensale.testnet';
  const network = process.env.REACT_APP_NEAR_NETWORK || 'testnet';
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'https://launchpad.nearspace.info/api';
  const [hcaptchaSiteKey, setHcaptchaSiteKey] = useState<string>('');
  const [amount, setAmount] = useState<string>('1');
  const [status, setStatus] = useState<{ message: string; type: string } | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [currentChallengeId, setCurrentChallengeId] = useState<string | null>(null);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [hcaptchaWidgetId, setHcaptchaWidgetId] = useState<string | null>(null);

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3181'
    : apiBaseUrl;
  const WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:3181'
    : `wss://${window.location.host}`;

  // Initialize wallet on mount
  useEffect(() => {
    initSession();
  }, []);

  // Initialize WebSocket when sessionId is available
  useEffect(() => {
    if (sessionId) {
      connectWebSocket();
    }
    return () => {
      if (ws) {
        ws.close();
      }
    };
    // eslint-disable-next-line
  }, [sessionId]);

  // Initialize hCaptcha when modal opens
  useEffect(() => {
    if (showCaptchaModal && hcaptchaSiteKey && !hcaptchaWidgetId) {
      renderHCaptcha();
    }
    // eslint-disable-next-line
  }, [showCaptchaModal, hcaptchaSiteKey, hcaptchaWidgetId]);

  const initSession = async () => {
    try {
      // Initialize wallet selector
      await initWalletSelector(network);

      // hCaptcha site key from env or default test key
      setHcaptchaSiteKey(process.env.REACT_APP_HCAPTCHA_SITE_KEY || '10000000-ffff-ffff-ffff-000000000001');
    } catch (error) {
      console.error('Failed to initialize:', error);
      setStatus({ message: 'Failed to initialize wallet', type: 'error' });
    }
  };

  const initWalletSelector = async (networkId: string) => {
    const _selector = await setupWalletSelector({
      network: networkId as 'testnet' | 'mainnet',
      modules: [setupMyNearWallet()],
    });

    setSelector(_selector);

    // Check if already signed in
    const state = _selector.store.getState();
    if (state.accounts.length > 0) {
      setAccountId(state.accounts[0].accountId);
    }

    // Subscribe to account changes
    _selector.store.observable.subscribe((state: { accounts: AccountState[] }) => {
      if (state.accounts.length > 0) {
        setAccountId(state.accounts[0].accountId);
      } else {
        setAccountId(null);
      }
    });
  };

  const connectWebSocket = useCallback(() => {
    if (!sessionId) {
      console.log('No session ID yet, skipping WebSocket connection');
      return;
    }

    const websocket = new WebSocket(`${WS_URL}/ws?session_id=${sessionId}`);

    websocket.onopen = () => {
      console.log('WebSocket connected for session:', sessionId);
      setStatus({ message: 'Connected! Waiting for CAPTCHA challenge...', type: 'info' });
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message:', data);

      if (data.type === 'captcha_challenge') {
        console.log('Received CAPTCHA challenge:', data.challenge_id);
        setCurrentChallengeId(data.challenge_id);
        setShowCaptchaModal(true);
        setStatus({ message: 'CAPTCHA challenge received! Please solve it.', type: 'info' });
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket closed');
      setStatus({ message: 'Connection closed', type: 'warning' });
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus({ message: 'WebSocket connection error', type: 'error' });
    };

    setWs(websocket);
  }, [sessionId, WS_URL]);

  const renderHCaptcha = () => {
    if (!window.hcaptcha) {
      setTimeout(renderHCaptcha, 100);
      return;
    }

    const widgetId = window.hcaptcha.render('hcaptcha-container', {
      sitekey: hcaptchaSiteKey,
      callback: onCaptchaSuccess,
      'error-callback': onCaptchaError,
      'expired-callback': onCaptchaExpired,
    });

    setHcaptchaWidgetId(widgetId);
  };

  const onCaptchaSuccess = (token: string) => {
    console.log('CAPTCHA solved');
  };

  const onCaptchaError = () => {
    setStatus({ message: 'CAPTCHA error. Please try again.', type: 'error' });
  };

  const onCaptchaExpired = () => {
    if (hcaptchaWidgetId !== null) {
      window.hcaptcha.reset(hcaptchaWidgetId);
    }
  };

  const handleConnectWallet = async () => {
    if (!selector) return;

    if (accountId) {
      // Disconnect
      const wallet = await selector.wallet();
      await wallet.signOut();
      setAccountId(null);
    } else {
      // Connect
      const modal = setupModal(selector, { contractId });
      modal.show();
    }
  };

  const handleBuyTokens = async () => {
    if (!accountId || !selector) {
      setStatus({ message: 'Please connect your wallet first', type: 'error' });
      return;
    }

    try {
      setStatus({ message: 'Preparing transaction...', type: 'info' });

      const wallet = await selector.wallet();
      const purchaseAmount = parseFloat(amount);
      const outlayerFee = 0.1;
      const totalDeposit = purchaseAmount + outlayerFee;

      // Convert NEAR to yoctoNEAR (1 NEAR = 10^24 yoctoNEAR)
      const depositYocto = BigInt(Math.floor(totalDeposit * 1e24));

      await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId: contractId,
        actions: [
          transactions.functionCall(
            'buy_tokens',
            { session_id: sessionId },
            BigInt('300000000000000'),
            depositYocto
          ),
        ],
      });

      setStatus({ message: 'Transaction sent! Waiting for CAPTCHA challenge...', type: 'info' });
      // WebSocket is already connected, worker will send challenge
    } catch (error: any) {
      console.error('Transaction error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    }
  };

  const handleSubmitCaptcha = async () => {
    if (!hcaptchaWidgetId || !currentChallengeId) return;

    const hcaptchaToken = window.hcaptcha.getResponse(hcaptchaWidgetId);

    if (!hcaptchaToken) {
      alert('Please complete the CAPTCHA');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/captcha/solve/${currentChallengeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcaptcha_token: hcaptchaToken }),
      });

      const data = await res.json();

      setShowCaptchaModal(false);

      if (data.verified) {
        setStatus({ message: '✅ CAPTCHA verified! Purchase complete.', type: 'success' });
      } else {
        setStatus({ message: '❌ CAPTCHA failed. Transaction cancelled.', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      setShowCaptchaModal(false);
    }
  };

  return (
    <div className="App">
      <div className="container">
        <h1>🚀 Token Sale Launchpad</h1>
        <p className="subtitle">Buy tokens with CAPTCHA verification via NEAR OutLayer</p>

        <div className="stats">
          <div className="stat-box">
            <div className="stat-label">Price</div>
            <div className="stat-value">100 tokens/NEAR</div>
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="session-id">Your Session ID</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              id="session-id"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              style={{ flex: 1 }}
              placeholder="sess_..."
            />
            <button
              className="btn btn-green"
              onClick={() => setSessionId(generateSessionId())}
              style={{ whiteSpace: 'nowrap' }}
            >
              🎲 New
            </button>
          </div>
          <small style={{ color: '#999', fontSize: '12px' }}>
            Session ID is used to match your transaction with CAPTCHA. Keep it unique per purchase.
          </small>
        </div>

        <div className="input-group">
          <label>Wallet Connection</label>
          <button className="btn btn-green" onClick={handleConnectWallet} disabled={!selector}>
            {accountId ? `${accountId.substring(0, 20)}...` : 'Connect Wallet'}
          </button>
        </div>

        <div className="input-group">
          <label htmlFor="amount">Amount (NEAR)</label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            step="0.1"
          />
        </div>

        <button className="btn" onClick={handleBuyTokens} disabled={!accountId}>
          Buy Tokens
        </button>

        {status && (
          <div className={`status ${status.type}`}>
            {status.message}
          </div>
        )}
      </div>

      {/* CAPTCHA Modal */}
      {showCaptchaModal && (
        <div className="modal active">
          <div className="modal-content">
            <h2>🔒 Verify You're Human</h2>
            <p>Complete the CAPTCHA to continue with your token purchase.</p>
            <div className="captcha-container">
              <div id="hcaptcha-container"></div>
            </div>
            <button className="modal-btn" onClick={handleSubmitCaptcha}>
              Submit Verification
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
