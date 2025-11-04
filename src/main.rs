use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::time::Duration;
use wasi_http_client::Client;

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

fn verify_captcha(input: &Input) -> Result<(bool, Option<String>), Box<dyn std::error::Error>> {
    // Step 1: Request CAPTCHA challenge from launchpad
    let challenge_url = format!("{}/api/captcha/challenge", input.launchpad_url);

    let challenge_body = serde_json::json!({
        "session_id": input.session_id,
        "buyer": input.buyer,
        "amount": input.amount
    });

    eprintln!("📤 Creating CAPTCHA challenge...");
    let challenge_response = Client::new()
        .post(&challenge_url)
        .header("Content-Type", "application/json")
        .connect_timeout(Duration::from_secs(10))
        .body(serde_json::to_string(&challenge_body)?.as_bytes())
        .send()?;

    // Check response status
    let status = challenge_response.status();
    if status < 200 || status >= 300 {
        match challenge_response.body() {
            Ok(body_bytes) => {
                let error_text = String::from_utf8_lossy(&body_bytes);
                return Err(format!("Failed to create challenge. Status: {}. Details: {}", status, error_text).into());
            }
            Err(e) => {
                return Err(format!("Failed to create challenge. Status: {}. Failed to read body: {:?}", status, e).into());
            }
        }
    }

    // Parse response
    let response_body = challenge_response.body()?;
    let challenge_data: ChallengeResponse = serde_json::from_slice(&response_body)?;

    // Step 2: Long-polling for user's CAPTCHA solution
    // Backend will hold the connection open until user solves or timeout
    let wait_url = format!("{}/api/captcha/wait/{}?timeout=60", input.launchpad_url, challenge_data.challenge_id);

    eprintln!("⏳ Waiting for user to solve CAPTCHA (60s timeout)...");

    let verify_response = Client::new()
        .get(&wait_url)
        .connect_timeout(Duration::from_secs(65)) // Slightly longer than backend timeout
        .send()?;

    // Check response status
    let status = verify_response.status();
    if status < 200 || status >= 300 {
        match verify_response.body() {
            Ok(body_bytes) => {
                let error_text = String::from_utf8_lossy(&body_bytes);
                return Err(format!("Failed to verify CAPTCHA. Status: {}. Details: {}", status, error_text).into());
            }
            Err(e) => {
                return Err(format!("Failed to verify CAPTCHA. Status: {}. Failed to read body: {:?}", status, e).into());
            }
        }
    }

    // Parse response
    let verify_body = verify_response.body()?;
    let verify_data: VerifyResponse = serde_json::from_slice(&verify_body)?;

    match verify_data.status.as_str() {
        "solved" => {
            if verify_data.verified {
                eprintln!("✅ CAPTCHA verified successfully!");
                Ok((true, None))
            } else {
                eprintln!("❌ CAPTCHA verification failed (wrong answer)");
                Ok((false, Some("wrong_answer".to_string())))
            }
        }
        "timeout" => {
            eprintln!("⏱️  CAPTCHA timeout - user didn't solve in time");
            Ok((false, Some("timeout".to_string())))
        }
        "pending" => {
            // Long-polling timed out but challenge still pending
            eprintln!("⏳ Long-poll timeout, treating as timeout");
            Ok((false, Some("timeout".to_string())))
        }
        _ => {
            eprintln!("❌ Unknown status: {}", verify_data.status);
            Ok((false, Some("system_error".to_string())))
        }
    }
}
