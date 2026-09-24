mod api;
mod chess;
mod engine;
mod hardware;
mod neural;
mod training;
mod update;

use axum::Router;
use std::{path::PathBuf,time::Duration};
use tower_http::services::ServeDir;

#[tokio::main]
async fn main(){
    let after_update=std::env::args().any(|a|a=="--after-update");
    let root=std::env::current_dir().unwrap_or_else(|_|PathBuf::from("."));
    let state=api::AppState{root:root.clone()};
    let app:Router=api::router(state).fallback_service(ServeDir::new(root));
    let listener=tokio::net::TcpListener::bind(api::bind_addr()).await.expect("bind Chess Lab");
    tokio::spawn(async move{loop{
        tokio::time::sleep(Duration::from_secs(300)).await;
        match update::check_and_update().await{Ok(true)=>return,Ok(false)=>{},Err(e)=>eprintln!("automatic update check failed: {e}")}
    }});
    if after_update{eprintln!("Chess Lab restarted into the updated release.");}
    println!("Chess Lab Rust backend listening on http://127.0.0.1:8787/");
    axum::serve(listener,app).await.expect("Chess Lab server stopped");
}
