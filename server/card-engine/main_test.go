package main

import (
 "encoding/json"
 "testing"
 d "royal/card-engine/internal/domain"
)
func TestAllGamesRecovery(t *testing.T){
 for _,name:=range []string{"three-card","caribbean","let-it-ride","ultimate","war","red-dog","pai-gow","dragon-tiger","deuces"}{t.Run(name,func(t *testing.T){
  for i:=0;i<10;i++{move:="start";if name=="dragon-tiger"{move="start-dragon"};r,err:=evaluate(input{Game:name,Move:move,Side:true});if err!=nil{t.Fatal(err)}
   for turn:=0;turn<3&&!r.View.Ended;turn++{move=r.View.Actions[0].Move;picks:=[]int{};if name=="pai-gow"{move="auto"};if name=="ultimate"{move="check";if r.View.Phase==d.UltimateTexasHoldemPhaseRiver{move="play1"}}
    next,err:=evaluate(input{Game:name,Move:move,Payload:r.Payload,Picks:picks});if err!=nil{t.Fatal(err)};if next.Debit<0||next.Credit<0{t.Fatal("invalid amounts")};r=next;
   };if !r.View.Ended{t.Fatal("did not finish")}
  }
 })}
}
func TestPairPlusFoldCredited(t *testing.T){
 g:=d.NewDefaultThreeCard();g.SetChips(100000);if err:=g.Bet(1000,1000);err!=nil{t.Fatal(err)}
 g.SetPlayerHand([]*d.Card{d.NewCard(d.CardDesignSpade,5,false),d.NewCard(d.CardDesignSpade,6,false),d.NewCard(d.CardDesignSpade,7,false)})
 payload,_:=json.Marshal(g);r,err:=evaluate(input{Game:"three-card",Move:"fold",Payload:payload});if err!=nil{t.Fatal(err)};if r.Debit!=0||r.Credit!=41000{t.Fatalf("wrong fold credit: %+v",r)}
}
func TestDeucesDealLogImmutable(t *testing.T){
 g:=d.NewDeucesWildVideoPoker();if err:=g.Bet(5);err!=nil{t.Fatal(err)};before,_:=json.Marshal(g.GetActionLog()[1].Cards);if err:=g.Hold([]int{});err!=nil{t.Fatal(err)};after,_:=json.Marshal(g.GetActionLog()[1].Cards);if string(before)!=string(after){t.Fatal("deal log mutated")}
}
func TestHiddenCardsStayOutOfView(t *testing.T){
 for _,name:=range []string{"three-card","caribbean","let-it-ride","ultimate","pai-gow"}{r,err:=evaluate(input{Game:name,Move:"start"});if err!=nil{t.Fatal(err)}
  expected:=0;if name=="caribbean"{expected=1};if len(r.View.Dealer)!=expected||len(r.View.Community)!=0{t.Fatal("hidden cards exposed",name,r.View)}
 }
}
