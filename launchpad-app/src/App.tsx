import React, { useEffect, useState, useCallback } from 'react';
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupModal } from '@near-wallet-selector/modal-ui';
import type { WalletSelector, AccountState } from '@near-wallet-selector/core';
import { actionCreators } from '@near-js/transactions';
import confetti from 'canvas-confetti';
import '@near-wallet-selector/modal-ui/styles.css';
import './App.css';

declare global {
  interface Window {
    hcaptcha: any;
  }
}


// Generate random session ID
const generateSessionId = () => {
  return 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

function App() {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null); // Changed: now state, not constant
  const contractId = process.env.REACT_APP_CONTRACT_ID || 'tokensale.testnet';
  const network = process.env.REACT_APP_NEAR_NETWORK || 'testnet';
  const [hcaptchaSiteKey, setHcaptchaSiteKey] = useState<string>('');
  const [amount, setAmount] = useState<string>('0.1');
  const [status, setStatus] = useState<{ message: string; type: string } | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [currentChallengeId, setCurrentChallengeId] = useState<string | null>(null);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [hcaptchaWidgetId, setHcaptchaWidgetId] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false); // Track if purchase is in progress
  const [purchaseDetails, setPurchaseDetails] = useState<{buyer: string, amount: string, session_id: string, transaction_hash: string} | null>(null);
  const [showDetails, setShowDetails] = useState(false); // Toggle for details visibility

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3181'
    : 'https://api-launchpad.nearspace.info';
  const WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:3181'
    : 'wss://api-launchpad.nearspace.info';

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
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message:', data);

      if (data.type === 'captcha_challenge') {
        console.log('Received CAPTCHA challenge:', data.challenge_id);
        setCurrentChallengeId(data.challenge_id);
        setPurchaseDetails({
          buyer: data.buyer,
          amount: data.amount,
          session_id: sessionId || 'unknown',
          transaction_hash: data.transaction_hash || 'unknown'
        });
        setShowCaptchaModal(true);
        setStatus({ message: '🔒 Please solve the CAPTCHA to complete your purchase', type: 'info' });
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket closed');
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
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

    if (isPurchasing) {
      setStatus({ message: 'Purchase already in progress. Please wait...', type: 'warning' });
      return;
    }

    const purchaseAmount = parseFloat(amount);
    if (purchaseAmount < 0.1) {
      setStatus({ message: 'Minimum purchase amount is 0.1 NEAR', type: 'error' });
      return;
    }

    try {
      // Generate new session ID for this purchase
      const newSessionId = generateSessionId();
      setSessionId(newSessionId);
      setIsPurchasing(true);
      setStatus({ message: 'Preparing transaction...', type: 'info' });

      const wallet = await selector.wallet();
      const outlayerFee = 0.01; // 0.01 NEAR for OutLayer execution (unused amount will be refunded)
      const totalDeposit = purchaseAmount + outlayerFee;

      // Create action using actionCreators (same as dashboard)
      const action = actionCreators.functionCall(
        'buy_tokens',
        { session_id: newSessionId },
        BigInt('300000000000000'), // 300 TGas
        BigInt(Math.floor(totalDeposit * 1e24)) // deposit in yoctoNEAR
      );

      // Send transaction
      wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      }).catch((error: any) => {
        // Ignore "Failed to fetch" errors - transaction is processing on blockchain
        if (error.message && !error.message.includes('Failed to fetch')) {
          console.error('Transaction error:', error);
          setStatus({ message: `Error: ${error.message}`, type: 'error' });
          setIsPurchasing(false);
          setSessionId(null);
        }
      });

      setStatus({ message: '⏳ Please sign the transaction in your wallet, then return here to verify CAPTCHA.', type: 'info' });
      // WebSocket will be connected automatically via useEffect when sessionId changes
    } catch (error: any) {
      // Ignore "Failed to fetch" errors - transaction is processing on blockchain
      if (error.message && !error.message.includes('Failed to fetch')) {
        console.error('Transaction error:', error);
        setStatus({ message: `Error: ${error.message}`, type: 'error' });
        setIsPurchasing(false);
        setSessionId(null);
      }
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
      setStatus({ message: '⏳ Verifying CAPTCHA...', type: 'info' });

      const res = await fetch(`${API_URL}/api/captcha/solve/${currentChallengeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcaptcha_token: hcaptchaToken }),
      });

      const data = await res.json();

      setShowCaptchaModal(false);

      console.log('CAPTCHA verification result:', data);

      // Small delay to ensure UI updates properly
      await new Promise(resolve => setTimeout(resolve, 100));

      if (data.verified) {
        console.log('✅ CAPTCHA verified! Waiting for blockchain confirmation...');
        setStatus({ message: '✅ CAPTCHA verified! Waiting for blockchain confirmation...', type: 'info' });

        // Wait for transaction to finalize on blockchain (~3-5 seconds)
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('✅ Token purchase completed successfully!');
        setStatus({ message: '✅ Token purchase completed successfully!', type: 'success' });

        // Launch confetti after 2 seconds!
        setTimeout(() => {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
          });
        }, 2000);
      } else {
        console.log('❌ CAPTCHA verification failed');
        setStatus({ message: '❌ CAPTCHA verification failed. Transaction has been cancelled and your funds have been refunded.', type: 'error' });
      }

      // Reset state for next purchase
      setIsPurchasing(false);
      setSessionId(null);
      setCurrentChallengeId(null);
      setHcaptchaWidgetId(null);
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      setShowCaptchaModal(false);
      setIsPurchasing(false);
      setSessionId(null);
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
          <label>Wallet Connection</label>
          <button className="btn btn-green" onClick={handleConnectWallet} disabled={!selector}>
            {accountId ? `${accountId.substring(0, 20)}...` : 'Connect Wallet'}
          </button>
        </div>

        <div className="input-group">
          <label htmlFor="amount">Purchase Amount (NEAR)</label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.1"
            step="0.1"
            disabled={isPurchasing}
          />
          <small style={{ color: '#9ca3af', fontSize: '12px', marginTop: '6px', display: 'block' }}>
            Minimum: 0.1 NEAR + 0.01 NEAR for OutLayer execution (unused amount refunded)
          </small>
        </div>

        <button className="btn" onClick={handleBuyTokens} disabled={!accountId || isPurchasing}>
          {isPurchasing ? 'Purchase in progress...' : `Buy Tokens (Total: ${(parseFloat(amount) + 0.01).toFixed(2)} NEAR)`}
        </button>

        {status?.type !== 'success' && (
          <div style={{
            padding: '14px 16px',
            marginTop: '16px',
            backgroundColor: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#92400e',
            lineHeight: '1.6'
          }}>
            ⚠️ <strong>Anti-bot protection:</strong> After sending the transaction, you will need to solve a CAPTCHA on this page to confirm you're human and complete your purchase.
          </div>
        )}

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
            {purchaseDetails && (
              <div style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
                textAlign: 'left'
              }}>
                <p style={{ margin: '0', fontSize: '14px', color: '#374151', lineHeight: '1.5' }}>
                  ℹ️ <strong>We received your purchase request for {purchaseDetails.amount} NEAR{purchaseDetails.transaction_hash && purchaseDetails.transaction_hash !== 'unknown' ? ` in transaction ${purchaseDetails.transaction_hash.substring(0, 8)}...` : ''}.</strong> To confirm you are a human and complete this transaction, please solve the CAPTCHA below.
                </p>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  style={{
                    marginTop: '12px',
                    background: 'none',
                    border: 'none',
                    color: '#6366f1',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                >
                  {showDetails ? '▼ Hide Details' : '▶ Show Details'}
                </button>
                {showDetails && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #d1d5db' }}>
                    <p style={{ margin: '8px 0', fontSize: '13px', color: '#374151' }}>
                      <strong>Account:</strong> <code style={{ backgroundColor: '#f3f4f6', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', color: '#111827' }}>{purchaseDetails.buyer}</code>
                    </p>
                    <p style={{ margin: '8px 0', fontSize: '13px', color: '#374151' }}>
                      <strong>Amount:</strong> <span style={{ color: '#6366f1', fontWeight: 'bold' }}>{purchaseDetails.amount} NEAR</span>
                    </p>
                    <p style={{ margin: '8px 0', fontSize: '13px', color: '#374151', wordBreak: 'break-all' }}>
                      <strong>Transaction:</strong> <code style={{ fontSize: '11px', backgroundColor: '#f3f4f6', padding: '3px 6px', borderRadius: '4px', color: '#111827' }}>{purchaseDetails.transaction_hash}</code>
                    </p>
                    <p style={{ margin: '8px 0', fontSize: '13px', color: '#374151' }}>
                      <strong>Request ID:</strong> <code style={{ fontSize: '11px', backgroundColor: '#f3f4f6', padding: '3px 6px', borderRadius: '4px', color: '#111827' }}>{purchaseDetails.session_id}</code>
                    </p>
                  </div>
                )}
              </div>
            )}
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
