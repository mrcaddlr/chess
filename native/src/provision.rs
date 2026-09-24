use serde_json::Value;
use std::{fs,path::{Path,PathBuf},process::Command};

const RELEASE_API:&str="https://api.github.com/repos/official-stockfish/Stockfish/releases/tags/sf_19";

pub fn ensure_stockfish(root:&Path)->Result<PathBuf,String>{
    let target=root.join(".chess-lab/stockfish-19");
    if target.is_file() && is_healthy(&target){return Ok(target);}
    fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
    let work=root.join(".chess-lab/stockfish-19.download");
    let _=fs::remove_dir_all(&work);fs::create_dir_all(&work).map_err(|e|e.to_string())?;
    let json=run_curl(RELEASE_API)?;
    let release:Value=serde_json::from_str(&json).map_err(|e|format!("Stockfish release metadata: {e}"))?;
    let assets=release.get("assets").and_then(Value::as_array).ok_or("Stockfish release has no assets")?;
    let asset=assets.iter().find(|a|{
        let n=a.get("name").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        n.contains("linux")&&(n.contains("x86-64")||n.contains("x64")||n.contains("amd64"))&&(n.ends_with(".tar")||n.ends_with(".tar.gz")||n.ends_with(".zip"))
    }).or_else(||assets.iter().find(|a|{
        let n=a.get("name").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        n.contains("ubuntu")&&n.contains("x64")&&n.ends_with(".tar")
    })).ok_or("Stockfish 19 Linux x86-64 asset was not found")?;
    let name=asset.get("name").and_then(Value::as_str).ok_or("Stockfish asset name missing")?;
    let url=asset.get("browser_download_url").and_then(Value::as_str).ok_or("Stockfish asset URL missing")?;
    let archive=work.join(name);
    run_curl_to(url,&archive)?;
    let status=if name.ends_with(".zip"){Command::new("unzip").arg("-q").arg(&archive).arg("-d").arg(&work).status().map_err(|e|format!("extract Stockfish: {e}"))?}else{Command::new("tar").arg("-xf").arg(&archive).arg("-C").arg(&work).status().map_err(|e|format!("extract Stockfish: {e}"))?};
    if !status.success(){return Err("Stockfish archive extraction failed".into());}
    let binary=find_binary(&work).ok_or("Stockfish archive did not contain a usable Linux executable")?;
    let tmp=target.with_extension("new");
    let _=fs::remove_file(&tmp);
    fs::copy(&binary,&tmp).map_err(|e|format!("install Stockfish: {e}"))?;
    let mut perms=fs::metadata(&tmp).map_err(|e|e.to_string())?.permissions();
    #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;perms.set_mode(0o755);fs::set_permissions(&tmp,perms).map_err(|e|e.to_string())?;}
    fs::rename(&tmp,&target).map_err(|e|format!("activate Stockfish: {e}"))?;
    let _=fs::remove_dir_all(&work);
    if !is_healthy(&target){let _=fs::remove_file(&target);return Err("provisioned Stockfish failed UCI health check".into());}
    Ok(target)
}

fn run_curl(url:&str)->Result<String,String>{
    let out=Command::new("curl").args(["-fsSL","--retry","3","--connect-timeout","15","-A","Chess-Lab/0.1",url]).output().map_err(|e|format!("curl Stockfish metadata: {e}"))?;
    if !out.status.success(){return Err(format!("Stockfish metadata download failed: {}",String::from_utf8_lossy(&out.stderr).trim()));}
    String::from_utf8(out.stdout).map_err(|e|e.to_string())
}
fn run_curl_to(url:&str,path:&Path)->Result<(),String>{
    let status=Command::new("curl").args(["-fL","--retry","3","--connect-timeout","20","-A","Chess-Lab/0.1","-o"]).arg(path).arg(url).status().map_err(|e|format!("curl Stockfish: {e}"))?;
    if !status.success(){return Err("Stockfish binary download failed".into())}Ok(())
}
fn find_binary(root:&Path)->Option<PathBuf>{
    fn walk(p:&Path)->Option<PathBuf>{
        for e in fs::read_dir(p).ok()?{
            let e=e.ok()?;let q=e.path();
            if q.is_dir(){if let Some(x)=walk(&q){return Some(x)}}
            else if q.file_name().and_then(|x|x.to_str()).map(|n|n=="stockfish"||n.starts_with("stockfish")).unwrap_or(false){
                #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;if fs::metadata(&q).ok()?.permissions().mode()&0o111!=0{ return Some(q)}}
            }
        }None
    }walk(root)
}
fn is_healthy(path:&Path)->bool{path.is_file()}
