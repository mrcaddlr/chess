use crate::neural::Network;
use std::{fs,path::Path};

pub fn save(path:&Path,net:&Network,generation:u64)->std::io::Result<()>{
 let mut bytes=Vec::with_capacity(16+net.w1.len()*4+net.b1.len()*4+net.policy.len()*4+net.value.len()*4);
 bytes.extend_from_slice(b"CHESSLAB");
 bytes.extend_from_slice(&generation.to_le_bytes());
 for v in net.w1.iter().chain(net.b1.iter()).chain(net.policy.iter()).chain(net.value.iter()){bytes.extend_from_slice(&v.to_le_bytes());}
 let tmp=path.with_extension("tmp"); fs::write(&tmp,bytes)?; fs::rename(tmp,path)
}
