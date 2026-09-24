use crate::{neural::Network,optimizer::Optimizer};
use std::{fs,path::Path,io::{self,Read}};

const MAGIC:&[u8]=b"CHESSLAB";
const VERSION:u32=2;

fn read_u64(bytes:&[u8],o:&mut usize)->io::Result<u64>{if *o+8>bytes.len(){return Err(io::Error::new(io::ErrorKind::UnexpectedEof,"checkpoint truncated"));}let mut a=[0;8];a.copy_from_slice(&bytes[*o..*o+8]);*o+=8;Ok(u64::from_le_bytes(a))}
fn read_u32(bytes:&[u8],o:&mut usize)->io::Result<u32>{if *o+4>bytes.len(){return Err(io::Error::new(io::ErrorKind::UnexpectedEof,"checkpoint truncated"));}let mut a=[0;4];a.copy_from_slice(&bytes[*o..*o+4]);*o+=4;Ok(u32::from_le_bytes(a))}
fn read_f32(bytes:&[u8],o:&mut usize)->io::Result<f32>{if *o+4>bytes.len(){return Err(io::Error::new(io::ErrorKind::UnexpectedEof,"checkpoint truncated"));}let mut a=[0;4];a.copy_from_slice(&bytes[*o..*o+4]);*o+=4;Ok(f32::from_le_bytes(a))}

pub fn save(path:&Path,net:&Network,generation:u64,optimizer:&Optimizer)->io::Result<()>{
 let count=net.w1.len()+net.b1.len()+net.policy.len()+net.value.len();
 let mut bytes=Vec::with_capacity(32+count*4);
 bytes.extend_from_slice(MAGIC);bytes.extend_from_slice(&VERSION.to_le_bytes());bytes.extend_from_slice(&generation.to_le_bytes());
 bytes.extend_from_slice(&optimizer.step.to_le_bytes());bytes.extend_from_slice(&optimizer.learning_rate.to_le_bytes());bytes.extend_from_slice(&(count as u64).to_le_bytes());
 for v in net.w1.iter().chain(net.b1.iter()).chain(net.policy.iter()).chain(net.value.iter()){bytes.extend_from_slice(&v.to_le_bytes());}
 let tmp=path.with_extension("tmp");fs::write(&tmp,bytes)?;fs::rename(tmp,path)
}

pub fn load(path:&Path,net:&mut Network,optimizer:&mut Optimizer)->io::Result<u64>{
 let mut bytes=Vec::new();fs::File::open(path)?.read_to_end(&mut bytes)?;
 if bytes.len()<36||&bytes[..8]!=MAGIC{return Err(io::Error::new(io::ErrorKind::InvalidData,"invalid checkpoint"));}
 let mut o=8;let version=read_u32(&bytes,&mut o)?;if version!=VERSION{return Err(io::Error::new(io::ErrorKind::InvalidData,"unsupported checkpoint version"));}
 let generation=read_u64(&bytes,&mut o)?;optimizer.step=read_u64(&bytes,&mut o)?;optimizer.learning_rate=read_f32(&bytes,&mut o)?;let count=read_u64(&bytes,&mut o)? as usize;
 let expected=net.w1.len()+net.b1.len()+net.policy.len()+net.value.len();if count!=expected{return Err(io::Error::new(io::ErrorKind::InvalidData,"checkpoint network shape mismatch"));}
 for v in net.w1.iter_mut().chain(net.b1.iter_mut()).chain(net.policy.iter_mut()).chain(net.value.iter_mut()){*v=read_f32(&bytes,&mut o)?;}
 Ok(generation)
}

#[cfg(test)]mod tests{
 use super::*;use std::time::{SystemTime,UNIX_EPOCH};
 #[test]fn checkpoint_roundtrip(){let mut n=Network::new();n.value[3]=0.25;let mut o=Optimizer::new(0.002);o.step=7;let p=std::env::temp_dir().join(format!("chess-lab-test-{}.ckpt",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));save(&p,&n,12,&o).unwrap();let mut n2=Network::new();let mut o2=Optimizer::new(0.0);let g=load(&p,&mut n2,&mut o2).unwrap();assert_eq!(g,12);assert_eq!(n2.value[3],0.25);assert_eq!(o2.step,7);std::fs::remove_file(p).unwrap();}
}
