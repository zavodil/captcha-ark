use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
struct Input {
    session_id: String,
    buyer: String,
    amount: String,
    launchpad_url: String,
}

#[derive(Serialize)]
struct Output {
    verified: bool,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_type: Option<String>, // "timeout", "wrong_answer", "network_error", "system_error"
}

#[derive(Deserialize)]
struct ChallengeResponse {
    challenge_id: String,
}

#[derive(Deserialize)]
struct VerifyResponse {
    status: String,  // "pending", "solved", "timeout"
    verified: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Read input from stdin
    let mut input_string = String::new();
    io::stdin().read_to_string(&mut input_string)?;

    let input: Input = serde_json::from_str(&input_string)?;

    // Execute CAPTCHA verification flow
    let (verified, error, error_type) = match verify_captcha(&input) {
        Ok((v, et)) => (v, None, et),
        Err(e) => {
            // Return error in output
            let output = Output {
                verified: false,
                session_id: input.session_id.clone(),
                error: Some(format!("Verification failed: {}", e)),
                error_type: Some("system_error".to_string()),
            };
            print!("{}", serde_json::to_string(&output)?);
            io::stdout().flush()?;
            return Ok(());
        }
    };

    // Write JSON output to stdout
    let output = Output {
        verified,
        session_id: input.session_id,
        error,
        error_type,
    };

    print!("{}", serde_json::to_string(&output)?);
    io::stdout().flush()?;

    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn verify_captcha(input: &Input) -> Result<(bool, Option<String>), Box<dyn std::error::Error>> {
    use std::time::Duration;

    // Create HTTP client
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(35))
        .build()?;

    // Step 1: Request CAPTCHA challenge from launchpad
    let challenge_url = format!("{}/api/captcha/challenge", input.launchpad_url);

    let challenge_response = client
        .post(&challenge_url)
        .json(&serde_json::json!({
            "session_id": input.session_id,
            "buyer": input.buyer,
            "amount": input.amount
        }))
        .send()?;

    if !challenge_response.status().is_success() {
        return Err(format!("Failed to create challenge: HTTP {}", challenge_response.status()).into());
    }

    let challenge: ChallengeResponse = challenge_response.json()?;

    // Step 2: Long-polling for user's CAPTCHA solution
    // Instead of polling every 500ms, make ONE request with 60 second timeout
    // Backend will hold the connection open until user solves or timeout
    let wait_url = format!("{}/api/captcha/wait/{}?timeout=60", input.launchpad_url, challenge.challenge_id);

    eprintln!("⏳ Waiting for user to solve CAPTCHA (60s timeout)...");

    let verify_response = client
        .get(&wait_url)
        .timeout(Duration::from_secs(65)) // Slightly longer than backend timeout
        .send()?;

    if !verify_response.status().is_success() {
        return Err(format!("Failed to get verification result: HTTP {}", verify_response.status()).into());
    }

    let verify: VerifyResponse = verify_response.json()?;

    match verify.status.as_str() {
        "solved" => {
            if verify.verified {
                eprintln!("✅ CAPTCHA verified successfully!");
                return Ok((true, None));
            } else {
                eprintln!("❌ CAPTCHA verification failed (wrong answer)");
                return Ok((false, Some("wrong_answer".to_string())));
            }
        }
        "timeout" => {
            eprintln!("⏱️  CAPTCHA timeout - user didn't solve in time");
            return Ok((false, Some("timeout".to_string())));
        }
        "pending" => {
            // Long-polling timed out but challenge still pending
            // Retry once more
            eprintln!("⏳ Long-poll timeout, checking one more time...");
            std::thread::sleep(Duration::from_millis(500));

            let retry_url = format!("{}/api/captcha/verify/{}", input.launchpad_url, challenge.challenge_id);
            let retry_response = client.get(&retry_url).send()?;

            if retry_response.status().is_success() {
                let retry_verify: VerifyResponse = retry_response.json()?;
                if retry_verify.status == "solved" {
                    return Ok((retry_verify.verified, if !retry_verify.verified { Some("wrong_answer".to_string()) } else { None }));
                }
            }

            return Ok((false, Some("timeout".to_string())));
        }
        _ => {
            eprintln!("❌ Unknown status: {}", verify.status);
            return Ok((false, Some("system_error".to_string())));
        }
    }
}

// WASM stub - for compilation only
#[cfg(target_arch = "wasm32")]
fn verify_captcha(_input: &Input) -> Result<(bool, Option<String>), Box<dyn std::error::Error>> {
    Err("Not implemented for WASM target".into())
}
