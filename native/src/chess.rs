use serde::{Deserialize,Serialize};

#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash,Serialize,Deserialize)]
pub struct Move{pub from:u8,pub to:u8,pub promotion:Option<char>}

#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
pub struct Board{
 pub squares:[char;64],
 pub white_to_move:bool,
 pub castling:u8,
 pub en_passant:Option<u8>,
 pub halfmove:u16,
 pub fullmove:u16,
}

impl Default for Board{fn default()->Self{Self::start()}}

impl Board{
 pub fn start()->Self{let mut s=['.';64];let back=['r','n','b','q','k','b','n','r'];for f in 0..8{s[f]=back[f];s[8+f]='p';s[48+f]='P';s[56+f]=back[f].to_ascii_uppercase();}Self{squares:s,white_to_move:true,castling:0b1111,en_passant:None,halfmove:0,fullmove:1}}
 pub fn from_fen(fen:&str)->Result<Self,String>{
  let fields:Vec<&str>=fen.split_whitespace().collect();if fields.len()<4{return Err("invalid FEN".into())}
  let mut s=['.';64];let mut rank=0usize;let mut file=0usize;
  for ch in fields[0].chars(){match ch{'/' if file==8=>{rank+=1;file=0},'1'..='8'=>file+=ch.to_digit(10).unwrap() as usize,p if p.is_ascii_alphabetic()&&rank<8&&file<8=>{s[rank*8+file]=p;file+=1},_=>return Err("invalid FEN board".into())}}
  if rank!=7||file!=8{return Err("invalid FEN board".into())}
  let castling=match fields[2]{"-"=>0,_=>{let mut c=0;for ch in fields[2].chars(){c|=match ch{'K'=>1,'Q'=>2,'k'=>4,'q'=>8,_=>return Err("invalid castling".into())}}c}};
  let ep=if fields[3]=="-"{None}else{Self::square(fields[3])};
  Ok(Self{squares:s,white_to_move:fields[1]=="w",castling, en_passant:ep,halfmove:fields.get(4).and_then(|x|x.parse().ok()).unwrap_or(0),fullmove:fields.get(5).and_then(|x|x.parse().ok()).unwrap_or(1)})
 }
 fn square(s:&str)->Option<u8>{let b=s.as_bytes();if b.len()!=2||!(b'a'..=b'h').contains(&b[0])||!(b'1'..=b'8').contains(&b[1]){return None}Some((b[1]-b'1')*8+b[0]-b'a')}
 fn color(p:char)->Option<bool>{if p=='.'{None}else{Some(p.is_uppercase())}}
 fn attacks_square(&self,from:u8,to:u8,p:char)->bool{
  let fr=from/8;let ff=from%8;let tr=to/8;let tf=to%8;let dr=tr as i8-fr as i8;let df=tf as i8-ff as i8;
  match p.to_ascii_lowercase(){'p'=>{let d=if p.is_uppercase(){-1}else{1};dr==d&&(df==1||df==-1)},'n'=>[(2,1),(2,-1),(-2,1),(-2,-1),(1,2),(1,-2),(-1,2),(-1,-2)].contains(&(dr,df)),'k'=>dr.abs()<=1&&df.abs()<=1&&(dr!=0||df!=0),'b'|'r'|'q'=>{let diagonal=dr.abs()==df.abs()&&dr!=0;let straight=(dr==0)^(df==0);if (p.to_ascii_lowercase()=='b'&&!diagonal)||(p.to_ascii_lowercase()=='r'&&!straight)||(p.to_ascii_lowercase()=='q'&&!(diagonal||straight)){return false}let sr=dr.signum();let sf=df.signum();let mut r=fr as i8+sr;let mut f=ff as i8+sf;while r!=tr as i8||f!=tf as i8{if self.squares[(r*8+f)as usize]!='.'{return false}r+=sr;f+=sf;}true},_=>false}
 }
 pub fn is_square_attacked(&self,to:u8,by_white:bool)->bool{for from in 0..64u8{let p=self.squares[from as usize];if Self::color(p)==Some(by_white)&&self.attacks_square(from,to,p){return true}}false}
 pub fn in_check(&self,white:bool)->bool{let k=self.squares.iter().position(|&p|p==if white{'K'}else{'k'});k.map(|x|self.is_square_attacked(x as u8,!white)).unwrap_or(true)}
 pub fn pseudo_legal_moves(&self)->Vec<Move>{
  let mut out=Vec::new();
  for from in 0..64u8{let p=self.squares[from as usize];if p=='.'||p.is_uppercase()!=self.white_to_move{continue}let r=(from/8)as i8;let f=(from%8)as i8;
   let mut add=|to:i8,prom:Option<char>|{if (0..64).contains(&to){let q=self.squares[to as usize];if q=='.'||q.is_uppercase()!=self.white_to_move{out.push(Move{from,to:to as u8,promotion:prom});}}};
   match p.to_ascii_lowercase(){
    'p'=>{let d=if self.white_to_move{-1}else{1};let nr=r+d;if (0..8).contains(&nr){let to=nr*8+f;if self.squares[to as usize]=='.'{let pr=if nr==0||nr==7{Some(if self.white_to_move{'Q'}else{'q'})}else{None};add(to,pr);let start=if self.white_to_move{6}else{1};let to2=(r+2*d)*8+f;if r==start&&self.squares[to2 as usize]=='.'{add(to2,None)}}for df in[-1,1]{let nf=f+df;if (0..8).contains(&nf){let to=nr*8+nf;let q=self.squares[to as usize];if q!='.'&&q.is_uppercase()!=self.white_to_move{add(to,if nr==0||nr==7{Some(if self.white_to_move{'Q'}else{'q'})}else{None})}else if self.en_passant==Some(to as u8){add(to,None)}}}}}
    'n'=>for(dr,df)in[(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]{let(nr,nf)=(r+dr,f+df);if(0..8).contains(&nr)&&(0..8).contains(&nf){add(nr*8+nf,None)}},
    'k'=>{for(dr,df)in[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]{let(nr,nf)=(r+dr,f+df);if(0..8).contains(&nr)&&(0..8).contains(&nf){add(nr*8+nf,None)}}let home=if self.white_to_move{56}else{0};if from==home+4&&!self.in_check(self.white_to_move){let rights=if self.white_to_move{[1,2]}else{[4,8]};if self.castling&rights[0]!=0&&self.squares[(home+5)as usize]=='.'&&self.squares[(home+6)as usize]=='.'&&self.squares[(home+7)as usize]==if self.white_to_move{'R'}else{'r'}&&!self.is_square_attacked(home+5,!self.white_to_move)&&!self.is_square_attacked(home+6,!self.white_to_move){add((home+6)as i8,None)}if self.castling&rights[1]!=0&&self.squares[(home+1)as usize]=='.'&&self.squares[(home+2)as usize]=='.'&&self.squares[(home+3)as usize]=='.'&&self.squares[home as usize]==if self.white_to_move{'R'}else{'r'}&&!self.is_square_attacked(home+3,!self.white_to_move)&&!self.is_square_attacked(home+2,!self.white_to_move){add((home+2)as i8,None)}}},
    'b'|'r'|'q'=>{let dirs:&[(i8,i8)]=match p.to_ascii_lowercase(){ 'b'=>&[(-1,-1),(-1,1),(1,-1),(1,1)],'r'=>&[(-1,0),(1,0),(0,-1),(0,1)],_=>&[(-1,-1),(-1,1),(1,-1),(1,1),(-1,0),(1,0),(0,-1),(0,1)]};for(dr,df)in dirs{let(mut nr,mut nf)=(r+dr,f+df);while(0..8).contains(&nr)&&(0..8).contains(&nf){let to=nr*8+nf;let q=self.squares[to as usize];if q=='.'{add(to,None)}else{if q.is_uppercase()!=self.white_to_move{add(to,None)}break}nr+=dr;nf+=df}}},
    _=>{}
   }
  }out
 }
 pub fn legal_moves(&self)->Vec<Move>{self.pseudo_legal_moves().into_iter().filter(|m|{let mut b=*self;b.make_unchecked(*m).is_ok()&&!b.in_check(!b.white_to_move)}).collect()}
 fn make_unchecked(&mut self,mv:Move)->Result<(),String>{let p=self.squares[mv.from as usize];if p=='.'||p.is_uppercase()!=self.white_to_move{return Err("invalid source".into())}let target=self.squares[mv.to as usize];let was_white=self.white_to_move;let old_ep=self.en_passant;self.en_passant=None;
  if p.to_ascii_lowercase()=='p'&&(mv.to as i16-mv.from as i16).abs()==16{self.en_passant=Some(((mv.from as u16+mv.to as u16)/2)as u8)}
  if p.to_ascii_lowercase()=='p'&&Some(mv.to)==old_ep&&target=='.'{let cap=if was_white{mv.to+8}else{mv.to-8};self.squares[cap as usize]='.'}
  self.squares[mv.from as usize]='.';self.squares[mv.to as usize]=mv.promotion.unwrap_or(p);
  if p.to_ascii_lowercase()=='k'{if was_white{self.castling&=!3}else{self.castling&=!12}if(mv.from as i16-mv.to as i16).abs()==2{let home=if was_white{56}else{0};if mv.to>mv.from{self.squares[(home+5)as usize]='.';self.squares[(home+6)as usize]=if was_white{'R'}else{'r'}}else{self.squares[home as usize]='.';self.squares[(home+3)as usize]=if was_white{'R'}else{'r'}}}}
  if mv.from==63||mv.to==63{self.castling&=!1}if mv.from==56||mv.to==56{self.castling&=!2}if mv.from==7||mv.to==7{self.castling&=!4}if mv.from==0||mv.to==0{self.castling&=!8}
  if p.to_ascii_lowercase()=='p'||target!='.'{self.halfmove=0}else{self.halfmove=self.halfmove.saturating_add(1)}if !was_white{self.fullmove+=1}self.white_to_move=!was_white;Ok(())}
 pub fn make(&mut self,mv:Move)->Result<(),String>{if !self.legal_moves().contains(&mv){return Err("illegal move".into())}self.make_unchecked(mv)}
 pub fn position_key(&self)->String{
  let mut key=String::with_capacity(80);for&p in &self.squares{key.push(p);}key.push(if self.white_to_move{'w'}else{'b'});key.push(char::from(b'0'+self.castling));if let Some(ep)=self.en_passant{key.push((b'a'+ep%8)as char);key.push((b'1'+ep/8)as char)}else{key.push('-');}key
 }
 pub fn insufficient_material(&self)->bool{
  let mut pieces=Vec::new();for&p in &self.squares{if p!='.'&&p.to_ascii_lowercase()!='k'{pieces.push(p);}}
  if pieces.is_empty(){return true}
  if pieces.iter().all(|p|matches!(p.to_ascii_lowercase(),'b'|'n'))&&pieces.len()<=2{
   if pieces.len()==1{return true}
   if pieces.iter().all(|p|p.to_ascii_lowercase()=='b'){
    let mut colors=Vec::new();for(i,&p)in self.squares.iter().enumerate(){if p.to_ascii_lowercase()=='b'{colors.push(((i/8)+(i%8))%2);}}
    return colors.len()==2&&colors[0]==colors[1];
   }
  }
  false
 }
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn starting_position_has_20_legal_moves(){assert_eq!(Board::start().legal_moves().len(),20);}
 #[test]fn pinned_piece_cannot_expose_king(){let b=Board::from_fen("4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1").unwrap();assert!(!b.legal_moves().iter().any(|m|m.from==52&&m.to==51));}
 #[test]fn castling_is_generated(){let b=Board::from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").unwrap();assert!(b.legal_moves().iter().any(|m|m.from==60&&m.to==62));}
 #[test]fn en_passant_is_generated(){let b=Board::from_fen("8/8/8/3pP3/8/8/8/8 w - d6 0 1").unwrap();assert!(b.legal_moves().iter().any(|m|m.from==28&&m.to==19));}
 #[test]fn insufficient_material_is_detected(){assert!(Board::from_fen("8/8/8/8/8/8/8/Kk6 w - - 0 1").unwrap().insufficient_material());assert!(Board::from_fen("8/8/8/8/8/8/6B1/Kk6 w - - 0 1").unwrap().insufficient_material());assert!(!Board::from_fen("8/8/8/8/8/8/6R1/Kk6 w - - 0 1").unwrap().insufficient_material());}
}
