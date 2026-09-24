use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Move { pub from: u8, pub to: u8, pub promotion: Option<char> }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Board { pub squares: [char; 64], pub white_to_move: bool }

impl Default for Board { fn default() -> Self { Self::start() } }

impl Board {
    pub fn start() -> Self {
        let mut s = ['.'; 64];
        let back = ['r','n','b','q','k','b','n','r'];
        for f in 0..8 { s[f]=back[f]; s[8+f]='p'; s[48+f]='P'; s[56+f]=back[f].to_ascii_uppercase(); }
        Self { squares:s, white_to_move:true }
    }
    pub fn from_fen(fen: &str) -> Result<Self,String> {
        let fields: Vec<&str> = fen.split_whitespace().collect();
        if fields.len() < 2 { return Err("invalid FEN".into()); }
        let mut s=['.';64]; let mut rank=0usize; let mut file=0usize;
        for ch in fields[0].chars() {
            match ch {
                '/' => { if file != 8 { return Err("invalid FEN rank".into()); } rank+=1; file=0; }
                '1'..='8' => file += ch.to_digit(10).unwrap() as usize,
                p if p.is_ascii_alphabetic() => { if rank>=8 || file>=8 { return Err("invalid FEN board".into()); } s[rank*8+file]=p; file+=1; }
                _ => return Err("invalid FEN".into())
            }
        }
        if rank!=7 || file!=8 { return Err("invalid FEN board".into()); }
        Ok(Self{squares:s,white_to_move:fields[1]=="w"})
    }
    pub fn pseudo_legal_moves(&self) -> Vec<Move> {
        let mut out=Vec::new();
        for from in 0..64u8 {
            let p=self.squares[from as usize];
            if p=='.' || p.is_uppercase()!=self.white_to_move { continue; }
            let r=(from/8) as i8; let f=(from%8) as i8;
            let mut add = |to:i8| {
                if (0..64).contains(&to) {
                    let q=self.squares[to as usize];
                    if q=='.' || q.is_uppercase()!=self.white_to_move { out.push(Move{from,to:to as u8,promotion:None}); }
                }
            };
            match p.to_ascii_lowercase() {
                'p' => {
                    let dir=if self.white_to_move{-1}else{1}; let nr=r+dir;
                    if (0..8).contains(&nr) {
                        let to=nr*8+f;
                        if self.squares[to as usize]=='.' {
                            let prom=(nr==0||nr==7).then_some(if self.white_to_move{'Q'}else{'q'});
                            out.push(Move{from,to:to as u8,promotion:prom});
                            let start=if self.white_to_move{6}else{1}; let to2=(r+2*dir)*8+f;
                            if r==start && self.squares[to2 as usize]=='.' { out.push(Move{from,to:to2 as u8,promotion:None}); }
                        }
                        for df in [-1,1] {
                            let nf=f+df; if !(0..8).contains(&nf){continue}
                            let to=nr*8+nf; let q=self.squares[to as usize];
                            if q!='.' && q.is_uppercase()!=self.white_to_move {
                                out.push(Move{from,to:to as u8,promotion:(nr==0||nr==7).then_some(if self.white_to_move{'Q'}else{'q'})});
                            }
                        }
                    }
                }
                'n' => for (dr,df) in [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)] {
                    let nr=r+dr;let nf=f+df;if (0..8).contains(&nr)&&(0..8).contains(&nf){add(nr*8+nf)}
                },
                'k' => for (dr,df) in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)] {
                    let nr=r+dr;let nf=f+df;if (0..8).contains(&nr)&&(0..8).contains(&nf){add(nr*8+nf)}
                },
                'b'|'r'|'q' => {
                    let dirs=match p.to_ascii_lowercase(){
                        'b'=>&[(-1,-1),(-1,1),(1,-1),(1,1)][..],
                        'r'=>&[(-1,0),(1,0),(0,-1),(0,1)][..],
                        _=>&[(-1,-1),(-1,1),(1,-1),(1,1),(-1,0),(1,0),(0,-1),(0,1)][..]
                    };
                    for (dr,df) in dirs { let mut nr=r+dr;let mut nf=f+df;
                        while (0..8).contains(&nr)&&(0..8).contains(&nf) {
                            let to=nr*8+nf;let q=self.squares[to as usize];
                            if q=='.' { out.push(Move{from,to:to as u8,promotion:None}); }
                            else { if q.is_uppercase()!=self.white_to_move { out.push(Move{from,to:to as u8,promotion:None}); } break; }
                            nr+=dr;nf+=df;
                        }
                    }
                }
                _=>{}
            }
        }
        out
    }
    pub fn make(&mut self,mv:Move)->Result<(),String>{
        let p=self.squares[mv.from as usize]; if p=='.'{return Err("empty source".into())}
        self.squares[mv.to as usize]=mv.promotion.unwrap_or(p); self.squares[mv.from as usize]='.'; self.white_to_move=!self.white_to_move; Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn starting_position_has_20_pseudo_legal_moves(){ assert_eq!(Board::start().pseudo_legal_moves().len(),20); }
    #[test] fn fen_round_trip_board_shape(){ let b=Board::from_fen("8/8/8/8/8/8/8/8 w - - 0 1").unwrap(); assert!(b.pseudo_legal_moves().is_empty()); }
}
