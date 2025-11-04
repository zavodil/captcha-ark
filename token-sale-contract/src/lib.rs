use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use near_sdk::{env, ext_contract, log, near_bindgen, AccountId, Gas, NearToken, Promise, PromiseError};

/// Minimum purchase amount (for demo purposes)
const MIN_PURCHASE: u128 = 100_000_000_000_000_000; // 0.0001 NEAR

/// Tokens per NEAR
const TOKENS_PER_NEAR: u128 = 100; // 100 tokens per 1 NEAR

/// Fixed gas for callback
const CALLBACK_GAS: u64 = 10_000_000_000_000; // 10 TGas

/// OutLayer contract ID
/// For testnet: "outlayer.testnet"
/// For mainnet: "outlayer.near"
const OUTLAYER_CONTRACT_ID: &str = "outlayer.testnet";

/// External contract interface for OutLayer
#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    fn request_execution(
        &mut self,
        code_source: near_sdk::serde_json::Value,
        resource_limits: near_sdk::serde_json::Value,
        input_data: String,
        secrets_ref: Option<near_sdk::serde_json::Value>,
        response_format: String,
        payer_account_id: Option<AccountId>,
    );
}

/// External contract interface for self callbacks
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_captcha_verified(
        &mut self,
        buyer: AccountId,
        amount: NearToken,
        #[callback_result] result: Result<Option<CaptchaResponse>, PromiseError>,
    ) -> String;
}

/// CAPTCHA verification response from WASM
#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CaptchaResponse {
    pub verified: bool,
    pub session_id: String,
    pub error: Option<String>,
    pub error_type: Option<String>, // "timeout", "wrong_answer", "network_error", "system_error"
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct TokenSaleContract {
    owner: AccountId,
    tokens_sold: u128,
    total_supply: u128,
    launchpad_url: String,
}

impl Default for TokenSaleContract {
    fn default() -> Self {
        env::panic_str("Contract must be initialized")
    }
}

#[near_bindgen]
impl TokenSaleContract {
    /// Initialize the contract
    ///
    /// # Arguments
    /// * `owner` - Contract owner account
    /// * `total_supply` - Total number of tokens available for sale
    /// * `launchpad_url` - URL of the launchpad backend API
    #[init]
    pub fn new(owner: AccountId, total_supply: U128, launchpad_url: String) -> Self {
        Self {
            owner,
            tokens_sold: 0,
            total_supply: total_supply.0,
            launchpad_url,
        }
    }

    /// Buy tokens with CAPTCHA verification
    ///
    /// # Arguments
    /// * `session_id` - User's browser session ID from launchpad website
    ///
    /// # Payment
    /// Attach at least 1 NEAR (minimum purchase)
    /// Plus additional 0.1 NEAR for OutLayer execution
    ///
    /// # Returns
    /// Promise that will resolve with success/failure message
    #[payable]
    pub fn buy_tokens(&mut self, session_id: String) -> Promise {
        let buyer = env::predecessor_account_id();
        let total_attached = env::attached_deposit();

        // Minimum: 0.0001 NEAR for tokens + 0.11 NEAR for execution (demo)
        let min_total = MIN_PURCHASE + 110_000_000_000_000_000_000_000; // 0.1101 NEAR
        assert!(
            total_attached.as_yoctonear() >= min_total,
            "Attach at least 0.11 NEAR (0.0001 NEAR minimum purchase + 0.11 NEAR for OutLayer execution)"
        );

        // Calculate purchase amount (first NEAR goes to tokens, rest to execution)
        let purchase_amount = if total_attached.as_yoctonear() >= MIN_PURCHASE * 2 {
            total_attached.as_yoctonear() - 100_000_000_000_000_000_000_000 // Leave 0.1 for execution
        } else {
            MIN_PURCHASE
        };

        let tokens_amount = (purchase_amount / 1_000_000_000_000_000_000_000_000) * TOKENS_PER_NEAR;

        assert!(
            self.tokens_sold + tokens_amount <= self.total_supply,
            "Not enough tokens available. Sold: {}, Requested: {}, Total: {}",
            self.tokens_sold,
            tokens_amount,
            self.total_supply
        );

        log!(
            "User {} requested {} tokens (session: {}). Verifying CAPTCHA...",
            buyer,
            tokens_amount,
            session_id
        );

        // Hardcoded parameters for captcha-ark
        let code_source = near_sdk::serde_json::json!({
            "repo": "https://github.com/zavodil/captcha-ark",
            "commit": "main",
            "build_target": "wasm32-wasip1"
        });

        let resource_limits = near_sdk::serde_json::json!({
            "max_instructions": 50000000000u64,
            "max_memory_mb": 128u32,
            "max_execution_seconds": 40u64
        });

        let input_data = near_sdk::serde_json::json!({
            "session_id": session_id,
            "buyer": buyer.to_string(),
            "amount": purchase_amount.to_string(),
            "launchpad_url": self.launchpad_url
        });

        // Call OutLayer using ext_contract
        // Pass buyer as payer_account_id so refund goes to buyer, not this contract
        ext_outlayer::ext(OUTLAYER_CONTRACT_ID.parse().unwrap())
            .with_attached_deposit(total_attached)
            .with_unused_gas_weight(1) // All unused gas goes to request_execution
            .request_execution(
                code_source,
                resource_limits,
                input_data.to_string(),
                None,
                "Json".to_string(),
                Some(buyer.clone()), // Refund to buyer, not this contract
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_gas(CALLBACK_GAS))
                    .on_captcha_verified(buyer, NearToken::from_yoctonear(purchase_amount)),
            )
    }

    /// Callback to handle CAPTCHA verification result
    ///
    /// Expected input:
    /// - Ok(Some(CaptchaResponse{verified: true})) - CAPTCHA passed, proceed with sale
    /// - Ok(Some(CaptchaResponse{verified: false})) - CAPTCHA failed, refund buyer
    /// - Ok(None) - Execution failed (worker error, timeout, etc.), refund buyer
    /// - Err(_) - Promise system error (should never happen)
    #[private]
    pub fn on_captcha_verified(
        &mut self,
        buyer: AccountId,
        amount: NearToken,
        #[callback_result] result: Result<Option<CaptchaResponse>, PromiseError>,
    ) -> String {
        match result {
            // Success case: We received Some(CaptchaResponse)
            Ok(Some(response)) if response.verified => {
                log!("✅ CAPTCHA verified for {}: {:?}", buyer, response.verified);

                // Calculate tokens to issue
                let tokens_amount =
                    (amount.as_yoctonear() / 1_000_000_000_000_000_000_000_000) * TOKENS_PER_NEAR;

                // Update state
                self.tokens_sold += tokens_amount;

                log!(
                    "Token sale completed: {} bought {} tokens for {} NEAR",
                    buyer,
                    tokens_amount,
                    amount.as_near()
                );

                format!(
                    "Success! You bought {} tokens for {} NEAR. Session: {}",
                    tokens_amount,
                    amount.as_near(),
                    response.session_id
                )
            }

            // CAPTCHA failed case
            Ok(Some(response)) => {
                let error_type = response.error_type.as_deref().unwrap_or("unknown");

                log!(
                    "❌ CAPTCHA verification failed for {} (type: {}): {:?}",
                    buyer,
                    error_type,
                    response.error
                );

                // Refund the buyer
                Promise::new(buyer.clone()).transfer(amount);

                // Different messages for different error types
                match error_type {
                    "wrong_answer" => format!(
                        "❌ CAPTCHA failed: Wrong answer. Transaction cancelled. Refunded {} NEAR.",
                        amount.as_near()
                    ),
                    "timeout" => format!(
                        "⏱ CAPTCHA timeout: You didn't complete CAPTCHA in time. Transaction cancelled. Refunded {} NEAR.",
                        amount.as_near()
                    ),
                    "network_error" => format!(
                        "🌐 Network error during CAPTCHA verification. Transaction cancelled. Refunded {} NEAR.",
                        amount.as_near()
                    ),
                    _ => format!(
                        "❌ CAPTCHA verification failed. Transaction cancelled. Refunded {} NEAR. Error: {:?}",
                        amount.as_near(),
                        response.error.unwrap_or_else(|| "Unknown error".to_string())
                    ),
                }
            }

            // Execution failed (OutLayer returned None)
            Ok(None) => {
                log!("❌ OutLayer execution failed for {} - received None", buyer);

                // Refund the buyer
                Promise::new(buyer.clone()).transfer(amount);

                format!(
                    "Verification error (execution failed). Refunded {} NEAR.",
                    amount.as_near()
                )
            }

            // Promise error (should never happen)
            Err(promise_error) => {
                log!("❌ Promise system error for {}: {:?}", buyer, promise_error);

                // Refund the buyer
                Promise::new(buyer.clone()).transfer(amount);

                format!(
                    "System error. Refunded {} NEAR. Error: {:?}",
                    amount.as_near(),
                    promise_error
                )
            }
        }
    }

    // ========== View methods ==========

    /// Get sale statistics
    pub fn get_stats(&self) -> (U128, U128) {
        (U128(self.tokens_sold), U128(self.total_supply))
    }

    /// Get token price
    pub fn get_price(&self) -> String {
        format!("{} tokens per 1 NEAR", TOKENS_PER_NEAR)
    }

    /// Get launchpad URL
    pub fn get_launchpad_url(&self) -> String {
        self.launchpad_url.clone()
    }

    /// Get owner
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}
