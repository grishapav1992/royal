package main

import (
	"encoding/json"
	d "royal/card-engine/internal/domain"
	"testing"
)

func TestRoyalFlushGrossPayoutLimits(t *testing.T) {
	t.Run("Mississippi three maximum raises", func(t *testing.T) {
		g := d.NewDefaultMississippiStud()
		g.SetChips(100000)
		if e := g.Bet(1000); e != nil {
			t.Fatal(e)
		}
		g.GetPlayerHand()[0] = d.NewCard(1, 1, true)
		g.GetPlayerHand()[1] = d.NewCard(1, 13, true)
		for i, value := range []int{12, 11, 10} {
			g.GetCommunityCards()[i] = d.NewCard(1, value, true)
		}
		p, _ := json.Marshal(g)
		var r reply
		for turn := 0; turn < 3; turn++ {
			var e error
			r, e = evaluate(input{Game: "mississippi", Move: "play3", Payload: p})
			if e != nil {
				t.Fatal(e)
			}
			p = r.Payload
		}
		if r.Credit != 5010000 || r.Debit != 3000 || !r.View.Ended {
			t.Fatalf("wrong maximum Royal payout: %+v", r)
		}
	})
	t.Run("Texas qualified ante plus every play wager", func(t *testing.T) {
		g := d.NewDefaultTexasHoldemBonus()
		g.SetChips(100000)
		if e := g.Bet(1000, 0); e != nil {
			t.Fatal(e)
		}
		g.GetPlayerHand()[0] = d.NewCard(1, 1, true)
		g.GetPlayerHand()[1] = d.NewCard(1, 13, true)
		g.SetCommunity([]*d.Card{d.NewCard(1, 12, true), d.NewCard(1, 11, true), d.NewCard(1, 10, true), d.NewCard(2, 8, true)})
		g.SetPhase(d.TexasHoldemBonusPhaseTurn)
		g.SetFlopBet(2000)
		g.SetTurnBet(1000)
		g.GetDealerHand()[0] = d.NewCard(3, 2, true)
		g.GetDealerHand()[1] = d.NewCard(4, 3, true)
		p, _ := json.Marshal(g)
		var r reply
		for _, move := range []string{"raise"} {
			var e error
			r, e = evaluate(input{Game: "holdem-bonus", Move: move, Payload: p})
			if e != nil {
				t.Fatal(e)
			}
			p = r.Payload
		}
		if r.Credit != 10000 || !r.View.Ended {
			t.Fatalf("wrong Royal ante and play payout: %+v", r)
		}
	})
}

func TestAdvertisedActionsKeepAccountingAfterRestore(t *testing.T) {
	for _, id := range extraIDs {
		t.Run(id, func(t *testing.T) {
			for seed := 0; seed < 4; seed++ {
				initial, err := evaluate(input{Game: id, Move: "start"})
				if err != nil {
					t.Fatal(err)
				}
				frontier := []reply{initial}
				for depth := 0; depth < 3; depth++ {
					next := []reply{}
					for _, state := range frontier {
						for _, a := range state.View.Actions {
							picks := []int(nil)
							if a.MaxPicks > 0 {
								for i := 0; i < a.MinPicks; i++ {
									picks = append(picks, i)
								}
							}
							in := input{Game: id, Move: a.Move, Picks: picks, Payload: state.Payload}
							r, err := evaluate(in)
							if err != nil {
								t.Fatalf("%s: %v", a.Move, err)
							}
							if r.Debit != a.Cost+a.PerPick*len(picks) {
								t.Fatalf("unexpected debit for %s", a.Move)
							}
							again, err := evaluate(in)
							if err != nil || mustJSON(again) != mustJSON(r) {
								t.Fatalf("snapshot changed outcome of %s: %v", a.Move, err)
							}
							if !r.View.Ended {
								next = append(next, r)
							}
						}
					}
					frontier = next
				}
			}
		})
	}
}
