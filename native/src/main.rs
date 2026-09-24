mod update;

use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::{net::SocketAddr, time::Duration};
use tower_http::services::ServeDir;

#[derive(Serialize)]
struct Health {
    ok: bool,
    service: &'static str,
    version: &'static str,
    backend: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health {
        ok: true,
        service: "chess-lab",
        version: env!("CARGO_PKG_VERSION"),
        backend: "rust",
    })
}

#[tokio::main]
async fn main() {
    let after_update = std::env::args().any(|a| a == "--after-update");

    let app = Router::new()
        .route("/api/health", get(health))
        .fallback_service(ServeDir::new("."));

    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind Chess Lab");

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;

            match update::check_and_update().await {
                Ok(true) => return,
                Ok(false) => {}
                Err(err) => eprintln!("automatic update check failed: {err}"),
            }
        }
    });

    if after_update {
        eprintln!("Chess Lab restarted into the updated release.");
    }

    println!("Chess Lab Rust backend listening on http://127.0.0.1:8787/");
    axum::serve(listener, app)
        .await
        .expect("Chess Lab server stopped");
}
